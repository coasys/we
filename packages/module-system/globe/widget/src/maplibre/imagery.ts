/**
 * What the MapLibre globe's surface is painted with: the same imagery as Cesium's, as MapLibre sources.
 *
 * - **Natural Earth II** at the bottom, for a globe with no network. Its tiles are the ones Cesium
 *   ships and the app serves, but they are cut on latitude and longitude and MapLibre's are cut on its
 *   own projection, so they are stitched once into one world image and re-cut on the way out, by a
 *   protocol MapLibre asks for tiles through.
 * - **NASA Blue Marble** above it, as on Cesium.
 * - **Landsat** over the land from country scale in, made land-only with the same coastline mask, by
 *   a second protocol that composites each tile with its mask.
 * - **Esri** or **Mapbox** instead of NASA's, where somebody has chosen one and given its key. Cesium
 *   ion is Cesium's own service and has no MapLibre equivalent, so choosing it draws NASA's here.
 */
import { addProtocol, type RasterSourceSpecification } from 'maplibre-gl';

import type { ImageryChoice } from '../CesiumGlobe.types';
import {
  checkMapboxToken,
  GIBS_BLUE_MARBLE,
  GIBS_CREDIT,
  GIBS_LAND_MASK,
  GIBS_LANDSAT,
  LANDSAT_FROM_LEVEL,
  PROVIDER_NAMES,
} from '../imagery-sources';

const TILE = 256;

/** Where the app serves Cesium's assets, Natural Earth II among them. See `cesiumAssets()`. */
const CESIUM_BASE = import.meta.env.WE_CESIUM_BASE_URL;

const loadImage = async (url: string): Promise<ImageBitmap> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return createImageBitmap(await response.blob());
};

const encode = (canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg') =>
  new Promise<ArrayBuffer>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then(resolve, reject) : reject(new Error('no tile'))), type),
  );

const tileCanvas = () => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE;
  return canvas;
};

/** The parts of a `{z}/{x}/{y}` URL a protocol is asked for. */
const tileOf = (url: string) => {
  const [z, x, y] = url
    .replace(/^[a-z-]+:\/\//, '')
    .split('/')
    .map(Number);
  return { z, x, y };
};

// ── Natural Earth II ────────────────────────────────────────────────────────

/** Level 2 of Cesium's copy: 8 by 4 tiles of 256, the whole world at 2048 by 1024. */
const NATURAL_EARTH_LEVEL = 2;
let world: Promise<HTMLCanvasElement> | undefined;

/** The world image, stitched once from Cesium's tiles, north at the top. */
function naturalEarthWorld(): Promise<HTMLCanvasElement> {
  if (!world) {
    world = (async () => {
      const columns = 2 ** (NATURAL_EARTH_LEVEL + 1);
      const rows = 2 ** NATURAL_EARTH_LEVEL;
      const canvas = document.createElement('canvas');
      canvas.width = columns * TILE;
      canvas.height = rows * TILE;
      const context = canvas.getContext('2d')!;
      const tiles: Promise<void>[] = [];
      for (let x = 0; x < columns; x++) {
        for (let y = 0; y < rows; y++) {
          // TMS counts rows from the south.
          const url = `${CESIUM_BASE}Assets/Textures/NaturalEarthII/${NATURAL_EARTH_LEVEL}/${x}/${y}.jpg`;
          tiles.push(loadImage(url).then((image) => context.drawImage(image, x * TILE, (rows - 1 - y) * TILE)));
        }
      }
      await Promise.all(tiles);
      return canvas;
    })();
    world.catch(() => (world = undefined));
  }
  return world;
}

/**
 * A Web Mercator tile cut from the world image. Longitude maps straight across; latitude does not, so
 * the tile is drawn a row at a time, each row from the latitude it stands for.
 */
async function naturalEarthTile(url: string): Promise<{ data: ArrayBuffer }> {
  const { z, x, y } = tileOf(url);
  const source = await naturalEarthWorld();
  const canvas = tileCanvas();
  const context = canvas.getContext('2d')!;
  const span = 2 ** z;
  const sourceX = (x / span) * source.width;
  const sourceWidth = source.width / span;
  for (let row = 0; row < TILE; row++) {
    const mercator = Math.PI * (1 - (2 * (y + (row + 0.5) / TILE)) / span);
    const latitude = (Math.atan(Math.sinh(mercator)) * 180) / Math.PI;
    const sourceY = ((90 - latitude) / 180) * source.height;
    context.drawImage(source, sourceX, sourceY, sourceWidth, 1, 0, row, TILE, 1);
  }
  return { data: await encode(canvas, 'image/jpeg') };
}

// ── Landsat, land only ──────────────────────────────────────────────────────

/** The mask is served to level 9; a deeper tile takes its part of a level-9 one. */
const MASK_LEVEL = 9;

const fill = (template: string, z: number, x: number, y: number) =>
  template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

async function landsatTile(url: string): Promise<{ data: ArrayBuffer }> {
  const { z, x, y } = tileOf(url);
  const shift = Math.max(0, z - MASK_LEVEL);
  const maskX = x >> shift;
  const maskY = y >> shift;
  const [tile, mask] = await Promise.all([
    loadImage(fill(GIBS_LANDSAT, z, x, y)),
    loadImage(fill(GIBS_LAND_MASK, z - shift, maskX, maskY)).catch(() => undefined),
  ]);
  const canvas = tileCanvas();
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(tile, 0, 0, TILE, TILE);
  if (mask) {
    // Keep only what the mask covers: land. The mask tile spans 2^shift tiles a side.
    context.globalCompositeOperation = 'destination-in';
    const cell = mask.width / (1 << shift);
    context.drawImage(mask, (x - (maskX << shift)) * cell, (y - (maskY << shift)) * cell, cell, cell, 0, 0, TILE, TILE);
    context.globalCompositeOperation = 'source-over';
  }
  // Black is no data: transparent, so Blue Marble shows there, as Cesium's colour-to-alpha does.
  const pixels = context.getImageData(0, 0, TILE, TILE);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 13 && data[i + 1] < 13 && data[i + 2] < 13) data[i + 3] = 0;
  }
  context.putImageData(pixels, 0, 0);
  return { data: await encode(canvas, 'image/png') };
}

let registered = false;

/** Registers the two protocols, once per page. */
export function registerImageryProtocols(): void {
  if (registered) return;
  registered = true;
  addProtocol('we-natural-earth', (params) => naturalEarthTile(params.url));
  addProtocol('we-landsat', (params) => landsatTile(params.url));
}

// ── Sources ─────────────────────────────────────────────────────────────────

/** The bottom source, which never changes: Natural Earth II, or nothing in a host that does not serve it. */
export function baseSource(): RasterSourceSpecification | undefined {
  if (!CESIUM_BASE) return undefined;
  return { type: 'raster', tiles: ['we-natural-earth://{z}/{x}/{y}'], tileSize: TILE, maxzoom: 3 };
}

/**
 * The sources above the base, bottom first: the chosen provider's imagery, or NASA's. Resolves to
 * NASA's when the provider refuses the key, after `onRefused` is told, as on Cesium.
 */
export async function detailSources(
  choice: ImageryChoice | undefined,
  onRefused: () => void,
): Promise<{ id: string; source: RasterSourceSpecification; minzoom?: number }[]> {
  if (choice?.provider === 'esri') {
    return [
      {
        id: 'imagery-esri',
        source: {
          type: 'raster',
          tiles: [
            `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(choice.key)}`,
          ],
          tileSize: TILE,
          maxzoom: 19,
          attribution: 'Imagery © Esri and its data providers',
        },
      },
    ];
  }
  if (choice?.provider === 'mapbox') {
    try {
      await checkMapboxToken(choice.key);
      return [
        {
          id: 'imagery-mapbox',
          source: {
            type: 'raster',
            tiles: [
              `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90?access_token=${encodeURIComponent(choice.key)}`,
            ],
            tileSize: TILE,
            maxzoom: 19,
            attribution: '© Mapbox © Maxar',
          },
        },
      ];
    } catch (error) {
      if (navigator.onLine)
        console.warn(`[globe] ${PROVIDER_NAMES.mapbox} refused the key; showing NASA's imagery instead.`, error);
      onRefused();
    }
  }
  if (choice?.provider === 'ion') {
    console.info(`[globe] ${PROVIDER_NAMES.ion} draws on Cesium only; the MapLibre globe shows NASA's imagery.`);
  }
  return [
    {
      id: 'imagery-blue-marble',
      source: { type: 'raster', tiles: [GIBS_BLUE_MARBLE], tileSize: TILE, maxzoom: 8, attribution: GIBS_CREDIT },
    },
    {
      id: 'imagery-landsat',
      source: { type: 'raster', tiles: ['we-landsat://{z}/{x}/{y}'], tileSize: TILE, maxzoom: 12 },
      // A map zoom counts 512-pixel tiles and these are 256, so the map is a level behind the tiles.
      minzoom: LANDSAT_FROM_LEVEL - 1,
    },
  ];
}
