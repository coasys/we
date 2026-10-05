/**
 * What the planet is painted with.
 *
 * The globe used to take Cesium's default base layer, which is Bing aerial reached through Cesium
 * ion with the demo token baked into the installed `cesium` package. Every release's demo token
 * expires about two months after it ships (1.144's says "Delete on October 1, 2026"), so the globe
 * went blank on a date nobody chose, and upgrading Cesium would only have restarted the clock.
 *
 * So the default needs no account and no key:
 *
 * - **Natural Earth II** at the bottom. It ships inside Cesium's own assets (42 tiles, about 600 KB,
 *   zoom levels 0–2), which the app serves itself, so it draws with no network at all.
 *   Sharp at whole-globe scale and soft from country scale in. It also covers the poles, which the
 *   Web Mercator layer above it cannot.
 * - **NASA GIBS Blue Marble** above it: about 500 m per pixel, to zoom level 8, public NASA imagery
 *   with no key. A land-cover composite, right for a continent and a blur at a city.
 * - **Landsat WELD** above that, from country scale in: a 30 m true-colour composite for the year
 *   2000, also through GIBS, to zoom level 12. Old imagery, but a city is a city in it.
 *
 * Without a network the GIBS tiles fail and the layer below shows through. The browser caches what
 * it has fetched (GIBS sends three days of `max-age`), so an offline globe draws whatever was seen
 * recently at full detail and Natural Earth II everywhere else.
 *
 * A deployment or a person with an account at a commercial imagery provider (Cesium ion's Bing
 * aerial, Esri World Imagery, Mapbox Satellite) can choose it instead, with their own key, and see
 * street-level detail. The key is theirs, so the terms they accepted with that provider are theirs as
 * well; WE never ships one. A key that is refused, or a provider chosen with no key, draws NASA's.
 */
import {
  ArcGisBaseMapType,
  ArcGisMapServerImageryProvider,
  buildModuleUrl,
  Color,
  ImageryLayer,
  IonImageryProvider,
  MapboxImageryProvider,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
} from 'cesium';

import type { ImageryChoice } from './CesiumGlobe.types';
import { LandOnlyImageryProvider } from './landOnly';

/**
 * Blue Marble with shaded relief and bathymetry: cloud-free and undated, so it needs no `{Time}`
 * and never shows a swath seam. GIBS serves it to level 8 and answers 400 above that, which is
 * what `maximumLevel` tells Cesium so it stretches level 8 instead of asking.
 */
const GIBS_BLUE_MARBLE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';

/**
 * Landsat WELD's true-colour annual composite. 2000 is the newest year GIBS serves globally (its
 * years run 1983–1985, 1988–1990 and 1998–2000), and the tiles go to level 12, about 30 m.
 *
 * Its sea is a patchwork of black and dark coastal scenes, so it is drawn land-only, through
 * {@link LandOnlyImageryProvider} with OpenStreetMap's land mask (also on GIBS, to level 9), and
 * Blue Marble's ocean shows through. Black is also made transparent, for any tile whose mask
 * could not be fetched.
 */
const GIBS_LANDSAT =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/default/2000-12-01/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpeg';

/** Land opaque, water transparent: OpenStreetMap's coastline, rasterised by GIBS. */
const GIBS_LAND_MASK =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/OSM_Land_Mask/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png';

/**
 * Below this terrain level Landsat is not drawn. Coastal tiles are a patchwork of scenes, which
 * reads as noise at whole-globe scale where Blue Marble is the better picture anyway.
 */
const LANDSAT_FROM_LEVEL = 5;

/** NASA asks for this acknowledgement wherever GIBS imagery is shown. */
const GIBS_CREDIT = 'Imagery: NASA Blue Marble and Landsat WELD, via NASA GIBS. Coastline © OpenStreetMap contributors';

/** Ion's world imagery asset (Bing Maps Aerial). */
const ION_WORLD_IMAGERY = 2;

/**
 * The bottom layer, which never changes: added once, when the viewer is built.
 *
 * Kept apart from {@link detailImagery} because replacing a layer leaves its area blank until the
 * new one's tiles arrive. With this one left in place, replacing the layer above it only drops the
 * surface to Natural Earth II for a moment, and never to the bare blue of an empty globe.
 */
export function baseImagery(): ImageryLayer {
  return ImageryLayer.fromProviderAsync(
    TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII')),
  );
}

/**
 * A GIBS provider that fails quietly. Offline, every tile fails, and Cesium logs each failure unless
 * the provider's errorEvent has a listener; so it gets one that does nothing. Nothing is lost: a
 * tile it could not fetch is drawn from the layer below.
 */
function gibsProvider(url: string, maximumLevel: number): UrlTemplateImageryProvider {
  const provider = new UrlTemplateImageryProvider({ url, maximumLevel, credit: GIBS_CREDIT });
  provider.errorEvent.addEventListener(() => {});
  return provider;
}

/** Landsat, land only. See {@link GIBS_LANDSAT}. */
function landsat(): LandOnlyImageryProvider {
  const provider = new LandOnlyImageryProvider({
    url: GIBS_LANDSAT,
    maximumLevel: 12,
    credit: GIBS_CREDIT,
    mask: gibsProvider(GIBS_LAND_MASK, 9),
    maskMaximumLevel: 9,
  });
  provider.errorEvent.addEventListener(() => {});
  return provider;
}

/**
 * The layers above the base, bottom first: the chosen provider's imagery, or NASA's when none is
 * chosen.
 *
 * New layers every call. Cesium never asks again for a tile that failed, so a globe that started
 * offline keeps Natural Earth II after the network comes back unless these are replaced.
 *
 * `onRefused` is called when the provider will not serve this key: wrong, revoked, expired or over
 * quota. The caller then asks again without a choice, and gets NASA's imagery rather than nothing.
 */
export function detailImagery(choice?: ImageryChoice, onRefused?: () => void): ImageryLayer[] {
  if (!choice) return nasaImagery();

  const refused = (error: unknown) => {
    if (navigator.onLine)
      console.warn(
        `[globe] ${PROVIDER_NAMES[choice.provider]} refused the key; showing NASA's imagery instead.`,
        error,
      );
    onRefused?.();
  };

  switch (choice.provider) {
    case 'ion': {
      const layer = ImageryLayer.fromProviderAsync(
        IonImageryProvider.fromAssetId(ION_WORLD_IMAGERY, { accessToken: choice.key }),
      );
      // Ion checks the token when the provider is made, so a bad one fails here, once.
      layer.errorEvent.addEventListener(refused);
      return [layer];
    }
    case 'esri': {
      // `token` is read by Cesium and missing from its typings; see `ArcGisMapServerImageryProvider.fromBasemapType`.
      const options = { token: choice.key } as ArcGisMapServerImageryProvider.ConstructorOptions;
      const layer = ImageryLayer.fromProviderAsync(
        ArcGisMapServerImageryProvider.fromBasemapType(ArcGisBaseMapType.SATELLITE, options),
      );
      layer.errorEvent.addEventListener(refused);
      return [layer];
    }
    case 'mapbox': {
      // Mapbox's provider is made synchronously and its tile host sends no CORS headers on a refusal,
      // so a bad token would look like a tile that failed for no reason and leave the globe bare. The
      // token is checked first, against Mapbox's own endpoint for that, and a token it does not call
      // valid fails the layer once, like ion's and Esri's.
      const layer = ImageryLayer.fromProviderAsync(
        checkMapboxToken(choice.key).then(
          () => new MapboxImageryProvider({ mapId: 'mapbox.satellite', accessToken: choice.key }),
        ),
      );
      layer.errorEvent.addEventListener(refused);
      return [layer];
    }
  }
}

/** Resolves when Mapbox says the token is valid; rejects with what it said otherwise. */
async function checkMapboxToken(token: string): Promise<void> {
  const response = await fetch(`https://api.mapbox.com/tokens/v2?access_token=${encodeURIComponent(token)}`);
  const { code } = (await response.json()) as { code?: string };
  if (code !== 'TokenValid') throw new Error(`Mapbox says the token is ${code ?? `refused (${response.status})`}.`);
}

/** How each provider is named in a warning. */
const PROVIDER_NAMES: Record<ImageryChoice['provider'], string> = {
  ion: 'Cesium ion',
  esri: 'Esri World Imagery',
  mapbox: 'Mapbox Satellite',
};

/** NASA's imagery: Blue Marble, and Landsat over the land from country scale in. */
function nasaImagery(): ImageryLayer[] {
  return [
    new ImageryLayer(gibsProvider(GIBS_BLUE_MARBLE, 8)),
    new ImageryLayer(landsat(), {
      minimumTerrainLevel: LANDSAT_FROM_LEVEL,
      colorToAlpha: Color.BLACK,
      colorToAlphaThreshold: 0.05,
    }),
  ];
}
