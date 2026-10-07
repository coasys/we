/**
 * `satelliteOverlayLayer` on Cesium: one day of NASA's imagery as an imagery layer over the surface.
 *
 * The product and the day come from `@we/globe-core` (`./overlay`), which both engines share. Here
 * the day's tiles become a Cesium imagery layer, and a new day is a new layer laid over the old one,
 * which goes once the new tiles are in, so moving through days never shows the bare earth between
 * them.
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
import { Color, Credit, ImageryLayer, UrlTemplateImageryProvider, WebMercatorTilingScheme } from 'cesium';

import { SATELLITE_OVERLAY } from '../../meta';
import type { CesiumRendererContext, LayerKind, LayerRenderer } from '../../types';

export type { SatelliteOverlayOptions };

export const satelliteOverlayLayer: LayerKind<SatelliteOverlayOptions> = {
  ...SATELLITE_OVERLAY,
  renderers: { cesium: renderSatelliteOverlay },
};

/** How long an outgoing day stays under the incoming one if its tiles never report themselves done. */
const SWAP_TIMEOUT = 4000;

export function renderSatelliteOverlay(
  context: CesiumRendererContext,
  initial: SatelliteOverlayOptions,
): LayerRenderer<SatelliteOverlayOptions> {
  const { viewer } = context;
  const layers = viewer.imageryLayers;
  let options = initial;
  let shown: ImageryLayer | null = null;
  let drawnKey = '';
  let lastSwap = -Infinity;
  let waiting: ReturnType<typeof setTimeout> | null = null;
  const outgoing = new Set<ImageryLayer>();

  const retire = () => {
    for (const layer of outgoing) layers.remove(layer, true);
    outgoing.clear();
    viewer.scene.requestRender();
  };
  // The outgoing day goes once the globe has every tile it asked for.
  const removeProgress = viewer.scene.globe.tileLoadProgressEvent.addEventListener((queued: number) => {
    if (queued === 0 && outgoing.size) retire();
  });

  /** What is to be drawn now: the product and its day. */
  const keyNow = () => `${overlayProduct(options).id}:${overlayDay(options, context.clock.at())}`;

  const draw = () => {
    const product = overlayProduct(options);
    const day = overlayDay(options, context.clock.at());
    const key = keyNow();
    if (key === drawnKey) {
      if (shown) shown.alpha = overlayOpacity(options);
      viewer.scene.requestRender();
      return;
    }
    drawnKey = key;
    lastSwap = performance.now();
    const provider = new UrlTemplateImageryProvider({
      url: overlayUrl(options, day, 'cesium'),
      tilingScheme: new WebMercatorTilingScheme(),
      maximumLevel: product.maxLevel,
      credit: new Credit(OVERLAY_CREDIT),
    });
    const layer = new ImageryLayer(provider, {
      alpha: overlayOpacity(options),
      ...(product.keyBlack ? { colorToAlpha: Color.BLACK, colorToAlphaThreshold: 0.12 } : {}),
    });
    // A new day takes the old day's place in the stack, directly above it, rather than going on top:
    // with the photograph and the fires both shown, the photograph's next day added on top would
    // cover the fires the moment the clock moved.
    if (shown && layers.contains(shown)) layers.add(layer, layers.indexOf(shown) + 1);
    else layers.add(layer);
    if (shown) {
      outgoing.add(shown);
      setTimeout(() => (outgoing.size ? retire() : undefined), SWAP_TIMEOUT);
    }
    shown = layer;
    viewer.scene.requestRender();
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
    removeProgress();
    if (waiting !== null) clearTimeout(waiting);
    retire();
    if (shown) layers.remove(shown, true);
    shown = null;
  });

  const update = (next: SatelliteOverlayOptions) => {
    options = next;
    draw();
  };

  draw();
  return { update };
}
