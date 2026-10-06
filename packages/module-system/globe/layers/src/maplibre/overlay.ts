/**
 * `satelliteOverlayLayer` on MapLibre: one day of NASA's imagery as a raster layer.
 *
 * Laid beneath every data layer, over the globe's own imagery, so markers and shapes stay on top of
 * the weather. A new day is a new source laid over the old, which goes once its tiles are in, as on
 * Cesium.
 *
 * Night lights are a picture of light on black, with no transparency of their own. Cesium can make
 * black transparent as it draws; MapLibre cannot, so their tiles come through a protocol that does it
 * to each tile on the way in: a pixel is as opaque as it is bright.
 */
import {
  OVERLAY_CREDIT,
  OVERLAY_DAY_INTERVAL,
  overlayDay,
  overlayOpacity,
  overlayProduct,
  overlayUrl,
  type SatelliteOverlayOptions,
} from '@we/globe-core';
import { addProtocol } from 'maplibre-gl';

import type { LayerRenderer, MapLibreRendererContext } from '../types';

const KEYED = 'we-keyed-black';
let keyedRegistered = false;

/** Tiles with black made transparent: fetched over https, each pixel's alpha its brightness. */
function registerKeyedProtocol(): void {
  if (keyedRegistered) return;
  keyedRegistered = true;
  addProtocol(KEYED, async ({ url }) => {
    const response = await fetch(url.replace(`${KEYED}://`, 'https://'));
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const image = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) data[i + 3] = Math.max(data[i], data[i + 1], data[i + 2]);
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('the tile could not be encoded');
    return { data: await blob.arrayBuffer() };
  });
}

/** How long an outgoing day stays under the incoming one if its tiles never report themselves done. */
const SWAP_TIMEOUT = 4000;

export function renderSatelliteOverlay(
  context: MapLibreRendererContext,
  initial: SatelliteOverlayOptions,
): LayerRenderer<SatelliteOverlayOptions> {
  const { map, id } = context;
  let options = initial;
  let shown: string | null = null;
  let drawnKey = '';
  let generation = 0;
  let lastSwap = -Infinity;
  let waiting: ReturnType<typeof setTimeout> | null = null;

  const remove = (name: string) => {
    if (map.getLayer(name)) map.removeLayer(name);
    if (map.getSource(name)) map.removeSource(name);
  };

  /** Beneath every data layer: directly above the globe's own imagery and any overlay already there. */
  const beneath = () =>
    map
      .getStyle()
      .layers.find(
        (layer) => layer.id !== 'space' && !layer.id.startsWith('imagery-') && !layer.id.startsWith('overlay:'),
      )?.id;

  const keyNow = () => `${overlayProduct(options).id}:${overlayDay(options, context.clock.at())}`;

  const draw = () => {
    const product = overlayProduct(options);
    const key = keyNow();
    if (key === drawnKey) {
      if (shown && map.getLayer(shown)) map.setPaintProperty(shown, 'raster-opacity', overlayOpacity(options));
      return;
    }
    drawnKey = key;
    lastSwap = performance.now();
    if (product.keyBlack) registerKeyedProtocol();
    let url = overlayUrl(options, overlayDay(options, context.clock.at()), 'maplibre');
    if (product.keyBlack) url = url.replace('https://', `${KEYED}://`);
    const name = `overlay:${id}:${++generation}`;
    map.addSource(name, {
      type: 'raster',
      tiles: [url],
      tileSize: 256,
      maxzoom: product.maxLevel,
      attribution: OVERLAY_CREDIT,
    });
    map.addLayer(
      { id: name, type: 'raster', source: name, paint: { 'raster-opacity': overlayOpacity(options) } },
      beneath(),
    );
    const previous = shown;
    shown = name;
    if (!previous) return;
    // The outgoing day goes once the incoming one has its tiles, or after a while regardless.
    let done = false;
    const retire = () => {
      if (done) return;
      done = true;
      map.off('sourcedata', onData);
      remove(previous);
    };
    const onData = (event: { sourceId?: string }) => {
      if (event.sourceId === name && map.isSourceLoaded(name)) retire();
    };
    map.on('sourcedata', onData);
    setTimeout(retire, SWAP_TIMEOUT);
  };

  // A new day at most every so often while the clock plays, and the last one asked for always lands.
  const unsubscribe = context.clock.subscribe(() => {
    if (options.date || waiting !== null || keyNow() === drawnKey) return;
    const wait = OVERLAY_DAY_INTERVAL - (performance.now() - lastSwap);
    if (wait <= 0) draw();
    else
      waiting = setTimeout(() => {
        waiting = null;
        draw();
      }, wait);
  });

  context.onCleanup(() => {
    unsubscribe();
    if (waiting !== null) clearTimeout(waiting);
    for (const layer of map.getStyle()?.layers ?? []) if (layer.id.startsWith(`overlay:${id}:`)) remove(layer.id);
    shown = null;
  });

  const update = (next: SatelliteOverlayOptions) => {
    options = next;
    draw();
  };

  draw();
  return { update };
}
