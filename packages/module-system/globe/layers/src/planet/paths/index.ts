/**
 * `pathsLayer`: a line per row — between two places, or along a list of them — that can arc.
 *
 * The kind is `@we/globe-core`'s {@link pathFeatures}; this is its Cesium renderer, one polyline per
 * feature in a single collection, updated by diff. Lines follow the earth's curve rather than cutting
 * through it, and an arc rises by a share of its own length, so longer routes arc higher.
 */
import {
  arcPositions,
  FeatureDiffer,
  type LonLat,
  type PathFeature,
  pathFeatures,
  type PathsOptions,
} from '@we/globe-core';
import { Cartesian3, Material, type Polyline, PolylineCollection } from 'cesium';

import type { CesiumRendererContext, LayerKind, LayerRenderer } from '../../types';
import { cesiumColors, markerAltitude, pickFeatures } from '../cesium';

export type { PathsOptions };

export const pathsLayer: LayerKind<PathsOptions> = {
  id: 'pathsLayer',
  slot: 'planet',
  description: 'A line per row of data, between two places or along several, flat or arcing.',
  renderers: { cesium: renderPaths },
};

/** Points along the line, each segment following the great circle, raised by `lift` and the arc. */
function sampled(feature: PathFeature, lift: number): Cartesian3[] {
  const { positions, arcHeight } = feature;
  // Only a line between two places arcs: a route through several is drawn along them.
  const share = positions.length === 2 ? arcHeight : 0;
  const out: Cartesian3[] = [];
  for (let i = 1; i < positions.length; i++) {
    const segment = arcPositions(positions[i - 1] as LonLat, positions[i] as LonLat, share, share > 0 ? 64 : 24);
    for (const [index, [lon, lat, height]] of segment.entries()) {
      if (i > 1 && index === 0) continue;
      out.push(Cartesian3.fromDegrees(lon, lat, height + lift));
    }
  }
  return out;
}

export async function renderPaths(
  context: CesiumRendererContext,
  initial: PathsOptions,
): Promise<LayerRenderer<PathsOptions>> {
  const { viewer, id: layer } = context;
  const colors = cesiumColors(context);
  const lines = viewer.scene.primitives.add(new PolylineCollection()) as PolylineCollection;
  const differ = new FeatureDiffer<PathFeature>();
  const drawn = new Map<string, { feature: PathFeature; polyline: Polyline }>();
  let options = initial;
  let byId = new Map<string, PathFeature>();

  // Lines float a little under the markers' height, for the same reason: clear of what is draped on
  // the ground, and close to it at every zoom.
  const liftNow = () => markerAltitude(viewer, (context.zIndex ?? 1) * 0.5);
  let lift = liftNow();

  const material = (feature: PathFeature) => {
    const color = colors.color(feature.color, feature.opacity);
    return feature.dashed
      ? Material.fromType('PolylineDash', { color, dashLength: 16 })
      : Material.fromType('Color', { color });
  };

  const rebuild = (next: PathsOptions) => {
    options = next;
    const features = pathFeatures(next);
    byId = new Map(features.map((f) => [f.id, f]));
    const diff = differ.diff(features);
    for (const id of [...diff.removed, ...diff.changed.map((f) => f.id)]) {
      const entry = drawn.get(id);
      if (entry) lines.remove(entry.polyline);
      drawn.delete(id);
    }
    for (const feature of [...diff.added, ...diff.changed]) {
      const polyline = lines.add({
        id: { layer, feature: feature.id },
        positions: sampled(feature, lift),
        width: feature.width,
        material: material(feature),
      });
      drawn.set(feature.id, { feature, polyline });
    }
    viewer.scene.requestRender();
  };

  const removeFollow = viewer.scene.preRender.addEventListener(() => {
    const next = liftNow();
    if (Math.abs(next - lift) <= lift * 0.1) return;
    lift = next;
    for (const { feature, polyline } of drawn.values()) polyline.positions = sampled(feature, lift);
  });

  pickFeatures(context, {
    select(id) {
      const feature = byId.get(id);
      if (feature) options.onSelect?.(feature.row);
    },
  });

  context.onCleanup(() => {
    removeFollow();
    viewer.scene.primitives.remove(lines);
    drawn.clear();
  });

  rebuild(initial);
  return { update: rebuild };
}
