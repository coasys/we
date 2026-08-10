/**
 * Spatial index and hit-testing — owned by the core, deliberately.
 *
 * With DOM nodes the browser will happily tell you what was clicked, and writing the drag, select and
 * connect behaviours against DOM events is the obvious thing to do. It is also the one-way door in
 * this system: a canvas renderer has no elements to hit, so every behaviour written that way has to
 * be rewritten to support dense mode. Behaviours here receive world coordinates and ask the core what
 * is there, so they never learn what a DOM node is and dense mode is additive.
 *
 * The index is a uniform grid rather than a quadtree. For this workload — points of broadly similar
 * size, rebuilt whenever the layout moves — a grid is faster to build, allocation-free to query, and
 * about thirty lines; a quadtree's advantage shows up with wildly non-uniform densities that a graph
 * layout does not produce.
 */
import type { Point } from '@we/graph-protocol';

import type { Bounds } from './viewport';

export interface IndexedNode {
  id: string;
  x: number;
  y: number;
  /** Hit radius in world units. */
  radius: number;
}

const DEFAULT_CELL = 120;

export class SpatialIndex {
  private cells = new Map<string, IndexedNode[]>();
  private cellSize = DEFAULT_CELL;
  private items: IndexedNode[] = [];

  /** Rebuild from scratch. Called when positions change, which is once per layout tick. */
  rebuild(nodes: IndexedNode[]): void {
    this.items = nodes;
    this.cells = new Map();
    if (!nodes.length) return;

    // Size cells to the largest node, so a node never spans more than the four cells its corners
    // fall in and the query below can stay a fixed 3×3 sweep.
    let maxRadius = 0;
    for (const node of nodes) if (node.radius > maxRadius) maxRadius = node.radius;
    this.cellSize = Math.max(DEFAULT_CELL, maxRadius * 2);

    for (const node of nodes) {
      const key = this.key(node.x, node.y);
      const cell = this.cells.get(key);
      if (cell) cell.push(node);
      else this.cells.set(key, [node]);
    }
  }

  /**
   * Nodes under a world point, nearest first.
   *
   * Ordered because overlapping nodes are normal in a force layout and "whichever the iteration
   * happened to reach first" makes clicks feel random.
   */
  hitTest(at: Point): string[] {
    const hits: { id: string; distance: number }[] = [];
    const cx = Math.floor(at.x / this.cellSize);
    const cy = Math.floor(at.y / this.cellSize);

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const cell = this.cells.get(`${cx + dx},${cy + dy}`);
        if (!cell) continue;
        for (const node of cell) {
          const distance = Math.hypot(node.x - at.x, node.y - at.y);
          if (distance <= node.radius) hits.push({ id: node.id, distance });
        }
      }
    }

    return hits.sort((a, b) => a.distance - b.distance).map((h) => h.id);
  }

  /** Ids intersecting a world rectangle — marquee selection, and viewport culling. */
  within(bounds: Bounds): string[] {
    const result: string[] = [];
    for (const node of this.items) {
      if (
        node.x + node.radius >= bounds.minX &&
        node.x - node.radius <= bounds.maxX &&
        node.y + node.radius >= bounds.minY &&
        node.y - node.radius <= bounds.maxY
      ) {
        result.push(node.id);
      }
    }
    return result;
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }
}
