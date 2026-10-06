/**
 * The H3 grid as both engines draw it: which resolutions to show for how much of the earth is in
 * view, how many rings of cells around the centre, and how strongly each resolution shows.
 *
 * Each resolution fades in as its cells come to suit the view — about eight across it — and out as
 * they stop, so zooming passes smoothly from one size of cell to the next.
 */
import { cellToBoundary, getHexagonEdgeLengthAvg, gridDisk, latLngToCell } from 'h3-js';

import type { LonLat } from './geo';

export interface GridPlan {
  res: number;
  /** Rings of cells around the centre cell. */
  ring: number;
  /** How strongly this resolution shows, 0–1. */
  alpha: number;
}

const edges = new Map<number, number>();
/** A resolution's average cell edge, in metres. */
function edgeMetres(res: number): number {
  let edge = edges.get(res);
  if (edge === undefined) {
    edge = getHexagonEdgeLengthAvg(res, 'm');
    edges.set(res, edge);
  }
  return edge;
}

/** Half the diagonal of what the camera sees on the ground, for a height, a field of view and an aspect. */
export function viewRadiusMetres(height: number, fovRadians: number, aspect: number): number {
  const viewHeight = 2 * height * Math.tan(fovRadians / 2);
  const viewWidth = viewHeight * aspect;
  return Math.hypot(viewWidth / 2, viewHeight / 2);
}

/** Each resolution up to `maxResolution`, with its ring count and strength for a view this wide. */
export function gridPlan(radiusMetres: number, maxResolution: number, maxRings = 6): GridPlan[] {
  const desiredAcross = 8;
  const idealEdge = Math.max(1, radiusMetres / desiredAcross);
  const sigma = 0.9;
  const plan: GridPlan[] = [];
  for (let res = 0; res <= maxResolution; res++) {
    const edge = Math.max(edgeMetres(res), 1);
    const ring = Math.max(1, Math.min(maxRings, Math.ceil(radiusMetres / edge)));
    const alpha = Math.exp(-0.5 * (Math.log2(edge / idealEdge) / sigma) ** 2);
    plan.push({ res, ring, alpha });
  }
  return plan;
}

/** The resolution showing most strongly: the one a hovered or pressed cell is taken from. */
export function primaryResolution(plan: readonly GridPlan[]): number {
  return plan.reduce((best, cur) => (cur.alpha > best.alpha ? cur : best), plan[0]).res;
}

/** The cells of one resolution around a place. */
export function cellsAround(position: LonLat, res: number, ring: number): string[] {
  return gridDisk(latLngToCell(position[1], position[0], res), ring).filter(Boolean);
}

/** The cell a place is in, at a resolution. */
export function cellAt(position: LonLat, res: number): string {
  return latLngToCell(position[1], position[0], res);
}

/** A cell's closed outline as [longitude, latitude] pairs. */
export function cellOutline(cell: string): LonLat[] {
  const boundary = cellToBoundary(cell, true) as [number, number][];
  const [first] = boundary;
  const last = boundary[boundary.length - 1];
  const closed = first && last && first[0] === last[0] && first[1] === last[1];
  return closed || !first ? boundary : [...boundary, first];
}
