/**
 * `hexbinLayer`: rows gathered into H3 cells, one filled cell per place, shaded and raised by what
 * is in it.
 *
 * Density without placing every row: a heat of where posts come from is a few hundred cells however
 * many posts there are. The kind is `@we/globe-core`'s {@link hexFeatures}; this is its Cesium
 * renderer. Not to be confused with `h3HexagonsLayer`, which draws the empty grid.
 */
import { FeatureDiffer, type HexbinOptions, type HexFeature, hexFeatures } from '@we/globe-core';

import type { CesiumRendererContext, LayerKind, LayerRenderer } from '../../types';
import { cesiumColors, pickFeatures } from '../cesium';
import { polygonDrawer } from '../polygons';

export type { HexbinOptions };

export const hexbinLayer: LayerKind<HexbinOptions> = {
  id: 'hexbinLayer',
  slot: 'planet',
  description: 'Rows of data gathered into hexagonal cells, each shaded and raised by what is in it.',
  renderers: { cesium: renderHexbin },
};

export function renderHexbin(context: CesiumRendererContext, initial: HexbinOptions): LayerRenderer<HexbinOptions> {
  const colors = cesiumColors(context);
  const drawer = polygonDrawer(context);
  const differ = new FeatureDiffer<HexFeature>();
  let options = initial;
  let byId = new Map<string, HexFeature>();
  context.onCleanup(() => drawer.dispose());

  const update = (next: HexbinOptions) => {
    options = next;
    const features = hexFeatures(next);
    byId = new Map(features.map((f) => [f.id, f]));
    const diff = differ.diff(features);
    if (!diff.added.length && !diff.changed.length && !diff.removed.length) return;
    drawer.set(
      features.map((feature) => ({
        id: feature.id,
        polygons: [[feature.boundary]],
        fill: colors.color(feature.color, feature.opacity),
        height: feature.height,
        borderWidth: 0,
      })),
    );
  };

  pickFeatures(context, {
    select(id) {
      const feature = byId.get(id);
      if (!feature) return;
      const { rows, count, value } = feature.group;
      options.onSelect?.({ cell: feature.cell, rows, count, value });
    },
  });

  update(initial);
  return { update };
}
