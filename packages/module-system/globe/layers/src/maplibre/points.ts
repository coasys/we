/**
 * `pointsLayer` on MapLibre: dots as circles, pictures and names as images in the map's sprite.
 *
 * Everything that is not drawing — which rows, which style, which clusters at this zoom — is
 * `@we/globe-core`'s, shared with the Cesium renderer, so a marker is the same size, colour and count
 * on either engine.
 */
import {
  type Cluster,
  clusterCellDegrees,
  ClusterLevels,
  clusterRadiusOf,
  type Mark,
  marksOf,
  PICTURE_OVERSAMPLE,
  type PointFeature,
  pointFeatures,
  type PointsOptions,
  ringedPicture,
} from '@we/globe-core';
import type { ExpressionSpecification, GeoJSONSource, LayerSpecification } from 'maplibre-gl';

import type { LayerRenderer, MapLibreRendererContext } from '../types';
import {
  addSource,
  cameraAltitude,
  LABEL_RATIO,
  labelPicture,
  maplibreColors,
  metresPerPixel,
  mountImages,
  pickFeatures,
} from './shared';

/** As on Cesium: a dot grows a little more than a picture, whose ring already makes it read larger. */
const DOT_HOVER_SCALE = 1.4;
const PICTURE_HOVER_SCALE = 1.3;
const HOVER_EASE = 0.2;

/** Space between a marker and the name below it, in pixels. */
const LABEL_GAP = 8;

export async function renderPoints(
  context: MapLibreRendererContext,
  initial: PointsOptions,
): Promise<LayerRenderer<PointsOptions>> {
  const { map, id } = context;
  const layers = {
    dots: `${id}:dots`,
    pictures: `${id}:pictures`,
    names: `${id}:names`,
    counts: `${id}:counts`,
  };
  const scale: ExpressionSpecification = ['coalesce', ['feature-state', 'scale'], 1];
  const specs: LayerSpecification[] = [
    {
      id: layers.dots,
      type: 'circle',
      source: id,
      filter: ['!', ['has', 'icon']],
      paint: {
        'circle-radius': ['*', ['get', 'size'], 0.5, scale],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': ['get', 'borderColor'],
        'circle-stroke-width': ['get', 'borderWidth'],
        'circle-pitch-alignment': 'viewport',
      },
    },
    {
      id: layers.pictures,
      type: 'symbol',
      source: id,
      filter: ['has', 'icon'],
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['get', 'opacity'] },
    },
    {
      id: layers.names,
      type: 'symbol',
      source: id,
      filter: ['all', ['has', 'name'], ['!', ['get', 'cluster']]],
      layout: {
        'icon-image': ['get', 'name'],
        'icon-anchor': 'top',
        'icon-offset': ['get', 'nameOffset'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    {
      id: layers.counts,
      type: 'symbol',
      source: id,
      filter: ['all', ['has', 'name'], ['get', 'cluster']],
      layout: {
        'icon-image': ['get', 'name'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
  ];
  const source = addSource(context, specs);

  /*
    A hovered picture, drawn again above itself at its eased size. MapLibre sizes a dot from each
    feature's hover state, but not a picture — an icon's size is a layout property, which hover state
    cannot reach — so the picture being hovered, and only it, is a one-feature source of its own,
    redrawn each frame of the easing. Cheap however many markers the layer holds.
  */
  const grownId = `${id}:grown`;
  map.addSource(grownId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: grownId,
    type: 'symbol',
    source: grownId,
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-size': ['get', 'scale'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  context.onCleanup(() => {
    if (map.getLayer(grownId)) map.removeLayer(grownId);
    if (map.getSource(grownId)) map.removeSource(grownId);
  });
  const drawGrown = () => {
    const grown = [...easing].flatMap(([feature, state]) => {
      const mark = state.scale === 1 ? undefined : marks.find((m) => m.id === feature);
      const icon = mark ? pictureFor(mark) : undefined;
      if (!mark || !icon) return [];
      return [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [mark.position[0], mark.position[1]] },
          properties: { icon, scale: state.scale },
        },
      ];
    });
    (map.getSource(grownId) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: grown });
  };
  const images = mountImages(context);
  const colors = maplibreColors(context, () => draw());

  let options = initial;
  let features: PointFeature[] = [];
  let byId = new Map<string, PointFeature>();
  let clusters = new Map<string, PointFeature[]>();
  let marks: Mark[] = [];
  let levels: ClusterLevels<PointFeature> | null = null;
  let grouped: Cluster<PointFeature>[] | null = null;
  let disposed = false;
  context.onCleanup(() => (disposed = true));
  const easing = new Map<string, { scale: number; target: number }>();
  let frame: number | null = null;

  const currentClusters = () =>
    levels ? levels.at(clusterCellDegrees(clusterRadiusOf(options.cluster), metresPerPixel(map))) : null;

  /** A picture not loaded yet is drawn as a dot, and the layer drawn again once it has arrived. */
  const pictureFor = (mark: Mark): string | undefined => {
    if (!mark.image) return undefined;
    const diameter = mark.size + mark.borderWidth * 2;
    const ring = colors.color(mark.borderColor);
    const name = `${id}:picture:${mark.image}|${diameter}|${mark.borderWidth}|${ring}`;
    if (images.has(name)) return name;
    void ringedPicture(mark.image, diameter, mark.borderWidth, ring).then((canvas) => {
      if (disposed || !canvas) return;
      images.add(name, canvas, PICTURE_OVERSAMPLE);
      drawSoon();
    });
    return undefined;
  };

  const nameFor = (mark: Mark): string | undefined => {
    if (!mark.label) return undefined;
    const clustered = mark.count > 1;
    const color = mark.labelColor ? colors.color(mark.labelColor) : '#ffffff';
    const name = `${id}:name:${clustered ? 'b' : 'n'}|${color}|${mark.label}`;
    if (!images.has(name)) images.add(name, labelPicture(mark.label, color, clustered), LABEL_RATIO);
    return name;
  };

  /** Pictures arrive one by one; the layer is drawn again once per frame, not once per picture. */
  let pendingDraw = 0;
  const drawSoon = () => {
    if (!pendingDraw) {
      pendingDraw = requestAnimationFrame(() => {
        pendingDraw = 0;
        draw();
      });
    }
  };
  context.onCleanup(() => {
    if (pendingDraw) cancelAnimationFrame(pendingDraw);
  });

  const draw = () => {
    if (disposed) return;
    source.set(
      marks.map((mark) => {
        const icon = pictureFor(mark);
        const name = nameFor(mark);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [mark.position[0], mark.position[1]] },
          properties: {
            id: mark.id,
            size: mark.size,
            color: colors.color(mark.color, mark.opacity),
            borderColor: colors.color(mark.borderColor, mark.opacity),
            borderWidth: mark.borderWidth,
            opacity: mark.opacity,
            cluster: mark.count > 1,
            nameOffset: [0, mark.size / 2 + mark.borderWidth + LABEL_GAP],
            ...(icon ? { icon } : {}),
            ...(name ? { name } : {}),
          },
        };
      }),
    );
    showNames(true);
  };

  const remark = () => {
    const next = marksOf(features, grouped, options.cluster);
    marks = next.marks;
    clusters = next.clusters;
    draw();
  };

  /** Names hidden above `labelMaxAltitude`; a cluster's count always shows. */
  let namesShown = true;
  const showNames = (force = false) => {
    const limit = options.labelMaxAltitude;
    const shown = limit === undefined || cameraAltitude(map) <= limit;
    if ((!force && shown === namesShown) || !map.getLayer(layers.names)) return;
    namesShown = shown;
    map.setLayoutProperty(layers.names, 'visibility', shown ? 'visible' : 'none');
  };

  const followCamera = () => {
    showNames();
    if (!levels) return;
    const next = currentClusters();
    if (next !== grouped) {
      grouped = next;
      remark();
    }
  };
  map.on('move', followCamera);
  context.onCleanup(() => map.off('move', followCamera));

  // Hovered markers ease larger and back: a dot through its feature's `scale` state, a picture
  // through the overlay above.
  const tick = () => {
    for (const [feature, state] of easing) {
      state.scale += (state.target - state.scale) * HOVER_EASE;
      if (Math.abs(state.target - state.scale) < 0.005) state.scale = state.target;
      if (map.getSource(id)) map.setFeatureState({ source: id, id: feature }, { scale: state.scale });
      if (state.scale === state.target && state.target === 1) easing.delete(feature);
    }
    drawGrown();
    const moving = [...easing.values()].some((state) => state.scale !== state.target);
    frame = moving ? requestAnimationFrame(tick) : null;
  };
  context.onCleanup(() => {
    if (frame !== null) cancelAnimationFrame(frame);
  });
  let hovered: string | null = null;

  pickFeatures(
    context,
    { shapes: [layers.dots, layers.pictures, layers.counts], labels: [layers.names] },
    {
      select(feature) {
        const members = clusters.get(feature);
        if (members) {
          // A cluster opens by coming closer, to where its members are.
          const mark = marks.find((m) => m.id === feature);
          if (mark)
            map.flyTo({ center: [mark.position[0], mark.position[1]], zoom: map.getZoom() + 1.6, duration: 800 });
          return;
        }
        const row = byId.get(feature)?.row;
        if (row) {
          context.events.emit('point-selected', row);
          options.onSelect?.(row);
        }
      },
      hover(feature) {
        if (hovered) {
          const state = easing.get(hovered);
          if (state) state.target = 1;
        }
        const mark = feature ? marks.find((m) => m.id === feature) : undefined;
        if (feature && mark) {
          const target = mark.image ? PICTURE_HOVER_SCALE : DOT_HOVER_SCALE;
          const state = easing.get(feature);
          if (state) state.target = target;
          else easing.set(feature, { scale: 1, target });
        }
        hovered = feature;
        if (frame === null) frame = requestAnimationFrame(tick);
      },
    },
  );

  const rebuild = (next: PointsOptions) => {
    options = next;
    features = pointFeatures(next);
    byId = new Map(features.map((f) => [f.id, f]));
    levels = clusterRadiusOf(next.cluster) ? new ClusterLevels(features) : null;
    grouped = currentClusters();
    remark();
  };

  rebuild(initial);
  return { update: rebuild };
}
