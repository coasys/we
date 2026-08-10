/**
 * The layouts that compute in one pass — tree, radial, grid, manual.
 *
 * All four are deterministic: they return positions from `init` and never tick, so
 * {@link LayoutResult.running} stays unset and the engine's tick loop never starts. That is worth
 * having alongside force not only for the visual result but because a graph that has finished moving
 * is far easier to read, click and screenshot — and for a hierarchy, force layout is actively worse
 * than arithmetic.
 */
import type { Layout, LayoutInput, LayoutResult, Placement, Point } from '@we/graph-protocol';

/** Roots are nodes nothing points at; failing that, the first node, so a cycle still draws. */
function findRoots(input: LayoutInput): string[] {
  const hasParent = new Set(input.edges.map((edge) => edge.target));
  const roots = input.nodes.filter((node) => !hasParent.has(node.id)).map((node) => node.id);
  if (roots.length) return roots;
  return input.nodes.length ? [input.nodes[0].id] : [];
}

/**
 * Breadth-first levels from a set of roots.
 *
 * Breadth-first rather than depth-first because a node reachable at depth 2 and depth 5 belongs on
 * the shallower row — otherwise the traversal order decides the drawing, and the same graph lays out
 * differently depending on which edge happened to be read first.
 */
function levelise(input: LayoutInput, roots: string[]): Map<string, number> {
  const children = new Map<string, string[]>();
  for (const edge of input.edges) {
    const list = children.get(edge.source);
    if (list) list.push(edge.target);
    else children.set(edge.source, [edge.target]);
  }

  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const root of roots) {
    depth.set(root, 0);
    queue.push(root);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    const next = (depth.get(id) ?? 0) + 1;
    for (const child of children.get(id) ?? []) {
      if (depth.has(child)) continue;
      depth.set(child, next);
      queue.push(child);
    }
  }
  // Anything unreachable from a root still has to go somewhere; a trailing row beats not drawing it.
  const maxDepth = Math.max(0, ...depth.values());
  for (const node of input.nodes) if (!depth.has(node.id)) depth.set(node.id, maxDepth + 1);
  return depth;
}

function groupByLevel(depth: Map<string, number>): Map<number, string[]> {
  const levels = new Map<number, string[]>();
  for (const [id, level] of depth) {
    const row = levels.get(level);
    if (row) row.push(id);
    else levels.set(level, [id]);
  }
  return levels;
}

export interface TreeLayoutOptions {
  /** Gap between levels. */
  levelGap?: number;
  /** Gap between siblings on a level. */
  siblingGap?: number;
  direction?: 'down' | 'right';
}

/** Layered hierarchy — the right shape for containment, org charts and dependency chains. */
export function treeLayout(rawOptions?: Record<string, unknown>): Layout {
  const options = { levelGap: 120, siblingGap: 90, direction: 'down', ...(rawOptions as TreeLayoutOptions) };
  return {
    id: 'tree',
    description: 'Layered hierarchy from the graph roots, laid out downward or rightward.',
    init(input): LayoutResult {
      const levels = groupByLevel(levelise(input, findRoots(input)));
      const positions = new Map<string, Placement>();
      const widest = Math.max(1, ...[...levels.values()].map((row) => row.length));

      for (const [level, row] of levels) {
        row.forEach((id, index) => {
          // Centre each row against the widest, so the tree is symmetrical rather than left-ragged.
          const offset = (index - (row.length - 1) / 2) * options.siblingGap + (widest * options.siblingGap) / 2;
          const along = level * options.levelGap;
          positions.set(id, options.direction === 'right' ? { x: along, y: offset } : { x: offset, y: along });
        });
      }
      return { positions: keepFixed(positions, input) };
    },
  };
}

export interface RadialLayoutOptions {
  /** Distance between rings. */
  ringGap?: number;
}

/** Concentric rings by distance from the roots — reads as "how far from the centre of this topic". */
export function radialLayout(rawOptions?: Record<string, unknown>): Layout {
  const options = { ringGap: 140, ...(rawOptions as RadialLayoutOptions) };
  return {
    id: 'radial',
    description: 'Concentric rings by hop distance from the graph roots.',
    init(input): LayoutResult {
      const levels = groupByLevel(levelise(input, findRoots(input)));
      const positions = new Map<string, Placement>();

      for (const [level, row] of levels) {
        if (level === 0 && row.length === 1) {
          positions.set(row[0], { x: 0, y: 0 });
          continue;
        }
        const radius = Math.max(level, 1) * options.ringGap;
        row.forEach((id, index) => {
          const angle = (index / row.length) * Math.PI * 2;
          positions.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
        });
      }
      return { positions: keepFixed(positions, input) };
    },
  };
}

export interface GridLayoutOptions {
  columns?: number;
  gap?: number;
  /** Sort key from the node's data bag, so the grid has a meaningful reading order. */
  sortBy?: string;
}

/** A plain grid — the honest default for a set of things with no relationships worth drawing. */
export function gridLayout(rawOptions?: Record<string, unknown>): Layout {
  const options = { gap: 140, ...(rawOptions as GridLayoutOptions) };
  return {
    id: 'grid',
    description: 'Uniform grid, optionally ordered by a node data field.',
    init(input): LayoutResult {
      const nodes = [...input.nodes];
      if (options.sortBy) {
        const key = options.sortBy;
        nodes.sort((a, b) => String(a.data?.[key] ?? '').localeCompare(String(b.data?.[key] ?? '')));
      }
      const columns = options.columns ?? Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
      const positions = new Map<string, Placement>();
      nodes.forEach((node, index) => {
        positions.set(node.id, {
          x: (index % columns) * options.gap,
          y: Math.floor(index / columns) * options.gap,
        });
      });
      return { positions: keepFixed(positions, input) };
    },
  };
}

export interface ManualLayoutOptions {
  /**
   * Where to read a node's stored position from — `data.<key>`.
   * A board's positions are *data*, not something computed, which is the whole inversion that makes a
   * freeform canvas a mode of this engine rather than a different engine.
   */
  xField?: string;
  yField?: string;
  /** Spacing used to place a node that has no stored position yet. */
  gap?: number;
}

/**
 * Positions come from the nodes themselves.
 *
 * The board case. Everything else here derives position from structure; this one treats position as
 * the data being edited, and only invents one for a node that has never been placed — arranged in a
 * grid off to one side rather than stacked at the origin, so a batch of new nodes is separable.
 */
export function manualLayout(rawOptions?: Record<string, unknown>): Layout {
  const options = { xField: 'x', yField: 'y', gap: 160, ...(rawOptions as ManualLayoutOptions) };
  const pinned = new Map<string, Point>();

  return {
    id: 'manual',
    description: 'Reads each node position from its own data; new nodes are parked in a grid.',
    init(input): LayoutResult {
      const positions = new Map<string, Placement>();
      let unplaced = 0;

      for (const node of input.nodes) {
        const override = pinned.get(node.id);
        if (override) {
          positions.set(node.id, { ...override, fixed: true });
          continue;
        }
        const x = Number(node.data?.[options.xField]);
        const y = Number(node.data?.[options.yField]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          positions.set(node.id, { x, y, fixed: true });
          continue;
        }
        const previous = input.previous?.get(node.id);
        if (previous) {
          positions.set(node.id, previous);
          continue;
        }
        positions.set(node.id, {
          x: (unplaced % 5) * options.gap,
          y: Math.floor(unplaced / 5) * options.gap,
          fixed: true,
        });
        unplaced += 1;
      }
      return { positions };
    },

    fix(id, at) {
      // Held in the layout rather than written back: persisting a position is a data mutation, and
      // the template decides whether a drag is worth writing (a board saves it, an explorer does not).
      if (at) pinned.set(id, at);
      else pinned.delete(id);
    },
  };
}

/** A user-pinned node stays where it was put, whatever the layout would prefer. */
function keepFixed(positions: Map<string, Placement>, input: LayoutInput): Map<string, Placement> {
  if (!input.previous) return positions;
  for (const [id, previous] of input.previous) {
    if (previous.fixed && positions.has(id)) positions.set(id, previous);
  }
  return positions;
}
