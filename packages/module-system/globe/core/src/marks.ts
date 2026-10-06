/**
 * Markers as both engines draw them: a point feature as itself, or a cluster standing for several.
 *
 * The features say what each row is; marks say what is on screen at this zoom. Kept here rather than
 * in a renderer so a cluster is the same size, the same colour and carries the same count on either
 * engine.
 */
import type { Cluster } from './cluster';
import type { PointFeature } from './features';
import type { LonLat } from './geo';
import type { PointsOptions } from './options';

/** A thing drawn: one feature, or a cluster standing for several. */
export interface Mark {
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

/** The cluster radius in pixels a layer's `cluster` option asks for, or 0 when it does not cluster. */
export const DEFAULT_CLUSTER_RADIUS = 60;

export function clusterRadiusOf(cluster: PointsOptions['cluster']): number {
  if (!cluster) return 0;
  return typeof cluster === 'object' ? (cluster.radius ?? DEFAULT_CLUSTER_RADIUS) : DEFAULT_CLUSTER_RADIUS;
}

export function markOf(feature: PointFeature): Mark {
  const { id, position, label, image, color, size, opacity, borderColor, borderWidth, labelColor } = feature;
  return { id, position, label, image, color, size, opacity, borderColor, borderWidth, labelColor, count: 1 };
}

/** A cluster drawn as one dot, its size growing with what it holds, labelled with the count. */
export function clusterMark(cluster: Cluster<PointFeature>, color: string): Mark {
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

/**
 * What to draw: every feature as itself when nothing is grouped, otherwise each cluster of one as its
 * feature and each larger one as a counted dot. Also the members of each counted dot, by its id, for
 * a press on one to open it.
 */
export function marksOf(
  features: readonly PointFeature[],
  grouped: readonly Cluster<PointFeature>[] | null,
  cluster: PointsOptions['cluster'],
): { marks: Mark[]; clusters: Map<string, PointFeature[]> } {
  if (!grouped) return { marks: features.map(markOf), clusters: new Map() };
  const color = typeof cluster === 'object' ? (cluster.color ?? 'accent') : 'accent';
  return {
    marks: grouped.map((c) => (c.members.length > 1 ? clusterMark(c, color) : markOf(c.members[0]))),
    clusters: new Map(grouped.filter((c) => c.members.length > 1).map((c) => [c.id, c.members])),
  };
}
