/**
 * `pointsLayer`: a marker per row — a dot, or a picture — with an optional label.
 *
 * The kind is what `@we/globe-core` says it is: rows, accessors and style rules turned into
 * {@link PointFeature}s. This file is only its Cesium renderer, which draws them as primitives
 * (one collection each of points, pictures and labels) so a layer of thousands stays cheap, and on an
 * update touches only the markers whose drawing changed.
 */
import {
  type Cluster,
  clusterCellDegrees,
  ClusterLevels,
  FeatureDiffer,
  type LonLat,
  type PointFeature,
  pointFeatures,
  type PointsOptions,
} from '@we/globe-core';
import {
  Billboard,
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  HorizontalOrigin,
  Label,
  LabelCollection,
  LabelStyle,
  PointPrimitive,
  PointPrimitiveCollection,
  VerticalOrigin,
} from 'cesium';

import type { CesiumRendererContext, LayerKind, LayerRenderer } from '../../types';
import { cesiumColors, markerAltitude, metresPerPixel, pickFeatures } from '../cesium';

export type { PointsOptions };

/** How much a hovered dot grows, and a hovered picture — a picture's ring makes it read larger. */
const DOT_HOVER_SCALE = 1.4;
const PICTURE_HOVER_SCALE = 1.3;
/**
 * The share of the distance to its target a marker's size closes each frame: about four frames to
 * cover nine tenths, quick enough to follow the pointer and slow enough to read as growing.
 */
const HOVER_EASE = 0.2;
const DEFAULT_CLUSTER_RADIUS = 60;

/** A thing drawn: one feature, or a cluster standing for several. */
interface Mark {
  id: string;
  position: LonLat;
  label?: string;
  image?: string;
  color: string;
  size: number;
  opacity: number;
  borderColor: string;
  borderWidth: number;
  labelColor?: string;
  /** How many features it stands for; 1 for a feature drawn as itself. */
  count: number;
}

interface Drawn {
  mark: Mark;
  point?: PointPrimitive;
  billboard?: Billboard;
  label?: Label;
}

export const pointsLayer: LayerKind<PointsOptions> = {
  id: 'pointsLayer',
  slot: 'planet',
  description: 'A marker per row of data — a dot or a picture, with a label — styled by rules.',
  renderers: { cesium: renderPoints },
};

/** A picture with a ring, drawn once per URL, size and ring and shared by every marker using it. */
const pictures = new Map<string, Promise<HTMLCanvasElement | null>>();

function ringedPicture(
  url: string,
  diameter: number,
  ring: number,
  ringCss: string,
): Promise<HTMLCanvasElement | null> {
  const key = `${url}|${diameter}|${ring}|${ringCss}`;
  let pending = pictures.get(key);
  if (!pending) {
    pending = new Promise((resolve) => {
      // Four times over, for a sharp ring on a high-density screen.
      const scale = 4;
      const size = Math.ceil(diameter * scale);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) return resolve(null);
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        const radius = size / 2;
        const border = ring * scale;
        if (border > 0) {
          context.beginPath();
          context.arc(radius, radius, radius, 0, Math.PI * 2);
          context.fillStyle = ringCss;
          context.fill();
        }
        context.save();
        context.beginPath();
        context.arc(radius, radius, radius - border, 0, Math.PI * 2);
        context.clip();
        context.drawImage(image, border, border, size - border * 2, size - border * 2);
        context.restore();
        resolve(canvas);
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
    pictures.set(key, pending);
  }
  return pending;
}

function markOf(feature: PointFeature): Mark {
  const { id, position, label, image, color, size, opacity, borderColor, borderWidth, labelColor } = feature;
  return { id, position, label, image, color, size, opacity, borderColor, borderWidth, labelColor, count: 1 };
}

/** A cluster drawn as one dot, its size growing with what it holds, labelled with the count. */
function clusterMark(cluster: Cluster<PointFeature>, color: string): Mark {
  const first = cluster.members[0];
  const count = cluster.members.length;
  return {
    id: cluster.id,
    position: cluster.position,
    label: String(count),
    color,
    size: Math.min(40, 14 + 4 * Math.log2(count)),
    opacity: 1,
    borderColor: first.borderColor,
    borderWidth: first.borderWidth,
    count,
  };
}

/** The Cesium renderer. Its state lives for one mount; the layer set calls `update` when its options change. */
export async function renderPoints(
  context: CesiumRendererContext,
  initial: PointsOptions,
): Promise<LayerRenderer<PointsOptions>> {
  const { viewer, id: layer } = context;
  const colors = cesiumColors(context, () => repaint());
  const points = viewer.scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
  const billboards = viewer.scene.primitives.add(
    new BillboardCollection({ scene: viewer.scene }),
  ) as BillboardCollection;
  const labels = viewer.scene.primitives.add(new LabelCollection({ scene: viewer.scene })) as LabelCollection;

  let options = initial;
  let features: PointFeature[] = [];
  let byId = new Map<string, PointFeature>();
  let clusters = new Map<string, PointFeature[]>();
  const differ = new FeatureDiffer<Mark>();
  const drawn = new Map<string, Drawn>();
  let altitude = markerAltitude(viewer, context.zIndex);
  /** Every zoom's clusters for the features on screen, built once per update. Null without `cluster`. */
  let levels: ClusterLevels<PointFeature> | null = null;
  /** The level drawn now, compared by identity: the same level is the same array. */
  let grouped: Cluster<PointFeature>[] | null = null;
  let hovered: string | null = null;

  const cartesian = (position: LonLat) => Cartesian3.fromDegrees(position[0], position[1], altitude);

  const clusterRadius = () => {
    const cluster = options.cluster;
    if (!cluster) return 0;
    return typeof cluster === 'object' ? (cluster.radius ?? DEFAULT_CLUSTER_RADIUS) : DEFAULT_CLUSTER_RADIUS;
  };

  /** The clusters for this camera, or null when clustering is off. */
  const currentClusters = () =>
    levels ? levels.at(clusterCellDegrees(clusterRadius(), metresPerPixel(viewer))) : null;

  const marks = (): Mark[] => {
    if (!grouped) {
      clusters = new Map();
      return features.map(markOf);
    }
    const clusterColor = typeof options.cluster === 'object' ? (options.cluster.color ?? 'accent') : 'accent';
    clusters = new Map(grouped.filter((c) => c.members.length > 1).map((c) => [c.id, c.members]));
    return grouped.map((c) => (c.members.length > 1 ? clusterMark(c, clusterColor) : markOf(c.members[0])));
  };

  const remove = (id: string) => {
    const entry = drawn.get(id);
    if (!entry) return;
    if (entry.point) points.remove(entry.point);
    if (entry.billboard) billboards.remove(entry.billboard);
    if (entry.label) labels.remove(entry.label);
    drawn.delete(id);
  };

  const labelOf = (mark: Mark): Label | undefined => {
    if (!mark.label) return undefined;
    const clustered = mark.count > 1;
    return labels.add({
      id: { layer, feature: mark.id, label: true },
      position: cartesian(mark.position),
      text: mark.label,
      font: clustered ? 'bold 12px sans-serif' : '14px sans-serif',
      fillColor: mark.labelColor ? colors.color(mark.labelColor) : Color.WHITE,
      outlineColor: Color.BLACK,
      outlineWidth: 2,
      style: LabelStyle.FILL_AND_OUTLINE,
      // A cluster's count sits on its dot; a marker's name hangs below it.
      pixelOffset: clustered ? Cartesian2.ZERO : new Cartesian2(0, mark.size / 2 + mark.borderWidth + 8),
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: clustered ? VerticalOrigin.CENTER : VerticalOrigin.TOP,
      distanceDisplayCondition:
        !clustered && options.labelMaxAltitude !== undefined
          ? new DistanceDisplayCondition(0, Math.max(0, options.labelMaxAltitude))
          : undefined,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
  };

  const add = async (mark: Mark) => {
    const id = { layer, feature: mark.id };
    const entry: Drawn = { mark };
    drawn.set(mark.id, entry);
    const diameter = mark.size + mark.borderWidth * 2;
    if (mark.image) {
      const picture = await ringedPicture(mark.image, diameter, mark.borderWidth, colors.css(mark.borderColor));
      // Removed while the picture loaded — by a newer update, or the layer going.
      if (drawn.get(mark.id) !== entry) return;
      if (picture) {
        entry.billboard = billboards.add({
          id,
          position: cartesian(mark.position),
          image: picture,
          width: diameter,
          height: diameter,
          color: new Color(1, 1, 1, mark.opacity),
          verticalOrigin: VerticalOrigin.CENTER,
          horizontalOrigin: HorizontalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
    }
    if (!entry.billboard) {
      entry.point = points.add({
        id,
        position: cartesian(mark.position),
        pixelSize: mark.size,
        color: colors.color(mark.color, mark.opacity),
        outlineColor: colors.color(mark.borderColor, mark.opacity),
        outlineWidth: mark.borderWidth,
      });
    }
    entry.label = labelOf(mark);
  };

  const draw = async () => {
    const diff = differ.diff(marks());
    for (const id of diff.removed) remove(id);
    // A changed mark is drawn again rather than edited: a dot can have become a picture, and a
    // label can have appeared, and the cost is only the marks that changed.
    for (const mark of diff.changed) remove(mark.id);
    await Promise.all([...diff.added, ...diff.changed].map((mark) => add(mark)));
    if (hovered && !drawn.has(hovered)) hovered = null;
    // A redrawn marker starts at its own size; one still hovered picks up where its easing is.
    for (const [id, state] of easing) {
      if (!drawn.has(id)) easing.delete(id);
      else applyScale(id, state.scale);
    }
    viewer.scene.requestRender();
  };

  /** Everything drawn again, in the theme's new colours. */
  const repaint = () => {
    for (const id of [...drawn.keys()]) remove(id);
    differ.reset();
    void draw();
  };

  const rebuild = (next: PointsOptions) => {
    options = next;
    features = pointFeatures(next);
    byId = new Map(features.map((f) => [f.id, f]));
    levels = clusterRadius() ? new ClusterLevels(features) : null;
    grouped = currentClusters();
    return draw();
  };

  /** Moves every marker when the altitude they float at has changed by more than a tenth. */
  const followCamera = () => {
    const next = markerAltitude(viewer, context.zIndex);
    if (Math.abs(next - altitude) > altitude * 0.1) {
      altitude = next;
      for (const entry of drawn.values()) {
        const position = cartesian(entry.mark.position);
        if (entry.point) entry.point.position = position;
        if (entry.billboard) entry.billboard.position = position;
        if (entry.label) entry.label.position = position;
      }
    }
    if (levels) {
      const next = currentClusters();
      if (next !== grouped) {
        grouped = next;
        void draw();
      }
    }
  };
  const removeFollow = viewer.scene.preRender.addEventListener(followCamera);

  /**
   * Hovered markers grow and settle back by easing. Only markers that are moving are held here — the
   * one entered and the one left — so the frame loop runs while something moves and stops after.
   */
  const easing = new Map<string, { scale: number; target: number }>();
  let frame: number | null = null;

  const applyScale = (id: string, scale: number) => {
    const entry = drawn.get(id);
    if (!entry) return;
    if (entry.point) entry.point.pixelSize = entry.mark.size * scale;
    if (entry.billboard) entry.billboard.scale = scale;
  };

  const tick = () => {
    for (const [id, state] of easing) {
      state.scale += (state.target - state.scale) * HOVER_EASE;
      if (Math.abs(state.target - state.scale) < 0.005) state.scale = state.target;
      applyScale(id, state.scale);
      if (state.scale === state.target && state.target === 1) easing.delete(id);
    }
    viewer.scene.requestRender();
    const moving = [...easing.values()].some((state) => state.scale !== state.target);
    frame = moving ? requestAnimationFrame(tick) : null;
  };

  const setHover = (feature: string | null) => {
    if (hovered) {
      const state = easing.get(hovered);
      if (state) state.target = 1;
    }
    const entry = feature ? drawn.get(feature) : undefined;
    if (feature && entry) {
      const target = entry.billboard ? PICTURE_HOVER_SCALE : DOT_HOVER_SCALE;
      const state = easing.get(feature);
      if (state) state.target = target;
      else easing.set(feature, { scale: 1, target });
    }
    hovered = feature;
    if (frame === null) frame = requestAnimationFrame(tick);
  };

  pickFeatures(context, {
    select(id) {
      const members = clusters.get(id);
      if (members) {
        // A cluster opens by coming closer: to where its members are, at a third of the height.
        const mark = drawn.get(id)?.mark;
        if (!mark) return;
        const height = viewer.camera.positionCartographic.height / 3;
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(mark.position[0], mark.position[1], height),
          duration: 0.8,
        });
        return;
      }
      const feature = byId.get(id);
      if (feature) {
        context.events.emit('point-selected', feature.row);
        options.onSelect?.(feature.row);
      }
    },
    hover: setHover,
  });

  context.onCleanup(() => {
    if (frame !== null) cancelAnimationFrame(frame);
    removeFollow();
    viewer.scene.primitives.remove(points);
    viewer.scene.primitives.remove(billboards);
    viewer.scene.primitives.remove(labels);
    drawn.clear();
  });

  await rebuild(initial);
  return { update: rebuild };
}
