/**
 * Points close together on screen drawn as one, with a count.
 *
 * ## Nested, so zooming only ever splits
 *
 * The clusters for every zoom are worked out once, as levels, each built from the one below it: a
 * level's clusters are the finer level's clusters merged where they lie within that level's radius.
 * So a cluster at one level is always whole clusters of the next, and zooming in can only split one —
 * never re-form it differently. The camera then picks a level; it does not recompute anything.
 *
 * It used to grid the points afresh at each zoom, into cells the size of the cluster radius. A cell's
 * edges move when its size does, so two points near an edge were together at one zoom, apart a little
 * closer, and together again closer still: zooming in through a city split it into its markers and
 * closed it up again, several times over.
 *
 * ## A dead band at each step
 *
 * The level changes only once the camera is clearly past a step, not the moment it touches one, so a
 * camera easing to a stop on a boundary does not flick between the two. Below the finest level, close
 * enough that the radius covers about 55 m, every point is drawn on its own.
 *
 * Both engines use it the same way: each supplies how many metres a pixel covers, and this does the
 * rest.
 */
import type { LonLat } from './geo';

/** Metres along a degree of latitude. */
const METRES_PER_DEGREE = 111_320;

/** The coarsest level's radius, in degrees: a third of a hemisphere, which is about orbit. */
const COARSEST = 32;

/**
 * Levels of halving radius below the coarsest. The finest is about 0.0005°, some 55 m of ground: a
 * camera close enough that its cluster radius covers less than that draws every point on its own.
 */
const LEVELS = 17;

/** How far past a step, as a share of one level, the camera must go before the level changes. */
const DEAD_BAND = 0.25;

export interface Cluster<T> {
  /** Stable while its members are the same: the lowest member id. */
  id: string;
  members: T[];
  /** The members' mean position. */
  position: LonLat;
}

/** The radius, in degrees of latitude, for a radius in pixels at a scale in metres per pixel. */
export function clusterCellDegrees(radiusPixels: number, metresPerPixel: number): number {
  return Math.max(0, (radiusPixels * metresPerPixel) / METRES_PER_DEGREE);
}

/** Distance in degrees, the longitude narrowed by latitude so it is about ground distance everywhere. */
function apart(a: LonLat, b: LonLat): number {
  const latitude = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  let dLon = Math.abs(a[0] - b[0]);
  if (dLon > 180) dLon = 360 - dLon;
  return Math.hypot(dLon * Math.max(0.05, Math.cos(latitude)), a[1] - b[1]);
}

function merged<T extends { id: string }>(parts: Cluster<T>[]): Cluster<T> {
  if (parts.length === 1) return parts[0];
  const members = parts.flatMap((part) => part.members);
  let longitude = 0;
  let latitude = 0;
  let id = members[0].id;
  for (const part of parts) {
    // Weighted by size, so a cluster's centre is the mean of all its points, not of its parts.
    longitude += part.position[0] * part.members.length;
    latitude += part.position[1] * part.members.length;
  }
  for (const member of members) if (member.id < id) id = member.id;
  return { id: `cluster:${id}`, members, position: [longitude / members.length, latitude / members.length] };
}

/**
 * One level up: clusters within `radius` of each other merged. Greedy, in id order so the same data
 * always groups the same way, and indexed on a grid of `radius` so it is linear rather than
 * every pair against every other.
 */
function mergeLevel<T extends { id: string }>(below: Cluster<T>[], radius: number): Cluster<T>[] {
  const ordered = [...below].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const grid = new Map<string, Cluster<T>[]>();
  const keyOf = (position: LonLat) => [Math.floor(position[0] / radius), Math.floor(position[1] / radius)];
  for (const cluster of ordered) {
    const [x, y] = keyOf(cluster.position);
    const key = `${x}:${y}`;
    const cell = grid.get(key);
    if (cell) cell.push(cluster);
    else grid.set(key, [cluster]);
  }
  // How many grid cells either side a neighbour can be in. Longitude is narrowed near the poles, so a
  // radius of ground there spans more degrees of it.
  const taken = new Set<Cluster<T>>();
  const out: Cluster<T>[] = [];
  for (const cluster of ordered) {
    if (taken.has(cluster)) continue;
    taken.add(cluster);
    const group = [cluster];
    const [x, y] = keyOf(cluster.position);
    const reachX = Math.min(
      Math.ceil(1 / Math.max(0.05, Math.cos((cluster.position[1] * Math.PI) / 180))),
      Math.ceil(360 / radius),
    );
    for (let dx = -reachX; dx <= reachX; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of grid.get(`${x + dx}:${y + dy}`) ?? []) {
          if (taken.has(other) || apart(cluster.position, other.position) > radius) continue;
          taken.add(other);
          group.push(other);
        }
      }
    }
    out.push(merged(group));
  }
  return out;
}

/**
 * Every level's clusters for a set of points, worked out once, and the level a camera should show.
 * Build one per data change; call `at` as the camera moves.
 */
export class ClusterLevels<T extends { id: string; position: LonLat }> {
  /** Coarsest first: `levels[0]` at a radius of `COARSEST` degrees, each next one half of it. */
  private readonly levels: Cluster<T>[][];
  private readonly single: Cluster<T>[];
  private shown = -1;

  constructor(points: readonly T[]) {
    this.single = points.map((point) => ({ id: point.id, members: [point], position: point.position }));
    const levels: Cluster<T>[][] = new Array(LEVELS);
    let below = this.single;
    for (let level = LEVELS - 1; level >= 0; level--) {
      below = mergeLevel(below, COARSEST / 2 ** level);
      levels[level] = below;
    }
    this.levels = levels;
  }

  /**
   * The clusters for a radius in degrees — from `clusterCellDegrees`. A radius of 0, or one below the
   * finest level, draws every point on its own.
   */
  at(radiusDegrees: number): Cluster<T>[] {
    const level = this.levelFor(radiusDegrees);
    return level >= LEVELS ? this.single : this.levels[level];
  }

  /** The level for a radius, held where it was until the radius is clearly past a step. */
  private levelFor(radiusDegrees: number): number {
    // Fractional: 0 at the coarsest radius, one more for each halving.
    const exact = radiusDegrees > 0 ? Math.log2(COARSEST / radiusDegrees) : Infinity;
    // A level is the coarsest whose radius fits within the one asked for.
    const ideal = Math.max(0, Math.min(LEVELS, Math.ceil(exact)));
    if (this.shown < 0 || !Number.isFinite(exact)) return (this.shown = ideal);
    // Keep what is shown while the camera is within the dead band of the step between them.
    if (ideal !== this.shown && Math.abs(exact - (ideal > this.shown ? this.shown : ideal)) < DEAD_BAND) {
      return this.shown;
    }
    return (this.shown = ideal);
  }
}

/**
 * Points grouped into clusters for one radius, with no camera to remember. For a one-off answer; a
 * renderer keeps a {@link ClusterLevels} so the levels are built once and the dead band holds.
 */
export function clusterPoints<T extends { id: string; position: LonLat }>(
  points: readonly T[],
  radiusDegrees: number,
): Cluster<T>[] {
  return new ClusterLevels(points).at(radiusDegrees);
}
