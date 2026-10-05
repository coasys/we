/**
 * Points close together on screen drawn as one, with a count.
 *
 * Grouped on a grid in degrees whose cell is the cluster radius at the camera's current scale, so it
 * is the same computation in either engine: each supplies how many metres a pixel covers, and this
 * does the rest. A grid rather than a true distance clustering because it is linear, stable as the
 * camera moves (a point does not hop between clusters from one frame to the next unless the scale
 * changes), and readable from orbit, which is the case it exists for.
 */
import type { LonLat } from './geo';

/** Metres along a degree of latitude. */
const METRES_PER_DEGREE = 111_320;

export interface Cluster<T> {
  /** Stable while its members are the same: the lowest member id. */
  id: string;
  members: T[];
  /** The members' mean position. */
  position: LonLat;
}

/** The grid cell, in degrees of latitude, for a radius in pixels at a scale in metres per pixel. */
export function clusterCellDegrees(radiusPixels: number, metresPerPixel: number): number {
  return Math.max(0, (radiusPixels * metresPerPixel) / METRES_PER_DEGREE);
}

/**
 * Points grouped into clusters. A cell holding one point is a cluster of one, which the renderer draws
 * as the point itself. A cell of 0 degrees (the camera close in) leaves every point on its own.
 */
export function clusterPoints<T extends { id: string; position: LonLat }>(
  points: readonly T[],
  cellDegrees: number,
): Cluster<T>[] {
  if (!(cellDegrees > 0)) return points.map((point) => ({ id: point.id, members: [point], position: point.position }));
  const cells = new Map<string, T[]>();
  for (const point of points) {
    const [longitude, latitude] = point.position;
    const row = Math.floor(latitude / cellDegrees);
    // Narrower in longitude towards the poles, so a cell covers about the same ground everywhere.
    const width = cellDegrees / Math.max(0.05, Math.cos(((row + 0.5) * cellDegrees * Math.PI) / 180));
    const key = `${row}:${Math.floor(longitude / width)}`;
    const cell = cells.get(key);
    if (cell) cell.push(point);
    else cells.set(key, [point]);
  }
  return [...cells.values()].map((members) => {
    let longitude = 0;
    let latitude = 0;
    let id = members[0].id;
    for (const member of members) {
      longitude += member.position[0];
      latitude += member.position[1];
      if (member.id < id) id = member.id;
    }
    return {
      id: members.length > 1 ? `cluster:${id}` : id,
      members,
      position: [longitude / members.length, latitude / members.length],
    };
  });
}
