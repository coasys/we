/**
 * `areasLayer`: filled shapes, each from a row's own GeoJSON, or the countries the rows name.
 *
 * Naming is the case that matters: "members per country" is a list of members each carrying a
 * country code, grouped here into countries and shaded by how many — the rows do not have to be
 * counted first. The kind is `@we/globe-core`'s {@link areaFeatures}; this is its Cesium renderer.
 */
import {
  type AreaFeature,
  areaFeatures,
  type AreaIndex,
  type AreasOptions,
  FeatureDiffer,
  followTime,
  loadAreas,
} from '@we/globe-core';

import type {} from '../../env';
import { AREAS } from '../../meta';
import type { CesiumRendererContext, LayerKind, LayerRenderer } from '../../types';
import { cesiumColors, pickFeatures } from '../cesium';
import { countriesUrl } from '../countries';
import { polygonDrawer } from '../polygons';

export type { AreasOptions };

export const areasLayer: LayerKind<AreasOptions> = {
  ...AREAS,
  renderers: { cesium: renderAreas },
};

export async function renderAreas(
  context: CesiumRendererContext,
  initial: AreasOptions,
): Promise<LayerRenderer<AreasOptions>> {
  // A theme change redraws every shape: the batch is rebuilt anyway, and the old one stays on screen
  // until the new one is ready.
  const colors = cesiumColors(context, () => {
    differ.reset();
    void update(options);
  });
  const drawer = polygonDrawer(context);
  const differ = new FeatureDiffer<AreaFeature>();
  let options = initial;
  let byId = new Map<string, AreaFeature>();
  let countries: AreaIndex | undefined;
  let disposed = false;
  context.onCleanup(() => {
    disposed = true;
    drawer.dispose();
  });

  // Regrouping rebuilds the whole batch of shapes, so it follows the clock a few times a second
  // rather than every frame.
  const time = followTime(context, () => draw(), { minInterval: 250 });

  const draw = () => {
    const features = areaFeatures(options, countries, time.slice(options.data, options));
    byId = new Map(features.map((f) => [f.id, f]));
    const diff = differ.diff(features);
    if (!diff.added.length && !diff.changed.length && !diff.removed.length) return;
    drawer.set(
      features.map((feature) => ({
        id: feature.id,
        polygons: feature.polygons,
        fill: colors.color(feature.color, feature.opacity),
        height: feature.height,
        border: feature.borderColor ? colors.color(feature.borderColor) : undefined,
        borderWidth: feature.borderWidth,
      })),
    );
  };

  const update = async (next: AreasOptions) => {
    options = next;
    if (next.area === 'countries' && !countries) {
      try {
        countries = await loadAreas(countriesUrl());
      } catch (error) {
        console.error('[areas] The countries could not be loaded:', error);
      }
      if (disposed) return;
    }
    draw();
  };

  pickFeatures(context, {
    select(id) {
      const feature = byId.get(id);
      if (feature) options.onSelect?.(feature.selected);
    },
  });

  await update(initial);
  return { update };
}
