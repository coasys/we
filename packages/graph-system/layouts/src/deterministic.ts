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

/**
 * Order each row so its edges cross as little as possible.
 *
 * Without this a layered graph is only *layered* — rows are correct and the lines between them are a
 * tangle, because a node's position in its row is whatever order the traversal happened to reach it.
 * The barycentre heuristic is the standard fix and most of what a full layered engine buys you: sort
 * each row by the mean position of its neighbours in the row above, sweep down, then up, repeat.
 *
 * A few sweeps get most of the benefit; this is not Sugiyama, and when `tree` visibly fails on real
 * data the answer is to adapt dagre or ELK rather than to grow this function.
 */
function reduceCrossings(levels: Map<number, string[]>, input: LayoutInput, sweeps = 4): Map<number, string[]> {
  const above = new Map<string, string[]>();
  const below = new Map<string, string[]>();
  for (const edge of input.edges) {
    (above.get(edge.target) ?? above.set(edge.target, []).get(edge.target)!).push(edge.source);
    (below.get(edge.source) ?? below.set(edge.source, []).get(edge.source)!).push(edge.target);
  }

  const ordered = new Map(levels);
  const indexIn = (row: string[]) => new Map(row.map((id, i) => [id, i]));

  const sortRow = (row: string[], neighbourRow: string[], neighbours: Map<string, string[]>) => {
    const position = indexIn(neighbourRow);
    const barycentre = (id: string): number => {
      const linked = (neighbours.get(id) ?? []).map((other) => position.get(other)).filter((p) => p !== undefined);
      // A node with no neighbour in the adjacent row has no opinion; leaving it where it is keeps the
      // sort stable rather than dragging it to one end.
      if (!linked.length) return row.indexOf(id);
      return (linked as number[]).reduce((sum, p) => sum + p, 0) / linked.length;
    };
    return [...row].sort((a, b) => barycentre(a) - barycentre(b) || a.localeCompare(b));
  };

  const depths = [...ordered.keys()].sort((a, b) => a - b);
  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    // Down: each row settles against the one above it.
    for (let i = 1; i < depths.length; i += 1) {
      const row = ordered.get(depths[i])!;
      ordered.set(depths[i], sortRow(row, ordered.get(depths[i - 1])!, above));
    }
    // Up: and then against the one below, which is what resolves the rows the downward pass fixed early.
    for (let i = depths.length - 2; i >= 0; i -= 1) {
      const row = ordered.get(depths[i])!;
      ordered.set(depths[i], sortRow(row, ordered.get(depths[i + 1])!, below));
    }
  }
  return ordered;
}

/**
 * Keep a parent's children next to each other.
 *
 * The protocol passes a containment tree and this used to ignore it, so an expanded collection's
 * children scattered across their row wherever crossing-reduction put them. Grouping by parent first
 * means a group reads as a group; ordering *within* each group is still the barycentre's job.
 */
function groupByParent(row: string[], containment: ReadonlyMap<string, string[]> | undefined): string[] {
  if (!containment?.size) return row;
  const parentOf = new Map<string, string>();
  for (const [parent, children] of containment) {
    for (const child of children) parentOf.set(child, parent);
  }
  if (!row.some((id) => parentOf.has(id))) return row;

  const groups = new Map<string, string[]>();
  for (const id of row) {
    const key = parentOf.get(id) ?? `\u0000${id}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(id);
  }
  return [...groups.values()].flat();
}

/** Layered hierarchy — the right shape for containment, org charts and dependency chains. */
export function treeLayout(rawOptions?: Record<string, unknown>): Layout {
  const options = { levelGap: 120, siblingGap: 90, direction: 'down', ...(rawOptions as TreeLayoutOptions) };
  return {
    id: 'tree',
    description: 'Layered hierarchy with barycentre crossing reduction; groups children under their parent.',
    init(input): LayoutResult {
      const levels = reduceCrossings(groupByLevel(levelise(input, findRoots(input))), input);
      const positions = new Map<string, Placement>();
      const widest = Math.max(1, ...[...levels.values()].map((row) => row.length));

      for (const [level, unordered] of levels) {
        const row = groupByParent(unordered, input.containment);
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
/**
 * Where a node with no stored position goes.
 *
 * A row along the top of whatever is currently on screen — a tray of things that are on the board
 * and nowhere in particular, waiting to be put somewhere.
 *
 * In *view* rather than at the origin, which is the whole point. The origin is the one place
 * guaranteed to be wrong: it is wherever the reader is not, so a card created while panned
 * elsewhere appeared to vanish. Grouped in a row rather than scattered, so "I have not placed
 * these" reads as a state rather than as clutter — and a template can style them apart, since a
 * node the layout parked is one whose data carries no coordinate.
 *
 * Falls back to the origin before a surface has been measured, which is the one moment there is no
 * better answer.
 */
function trayPosition(input: LayoutInput, index: number, gap: number): Point {
  const visible = input.visible;
  const perRow = Math.max(1, Math.floor((visible?.width ?? gap * 5) / gap));
  const column = index % perRow;
  const row = Math.floor(index / perRow);
  // Inset by half a gap so the first card is not flush against the edge of the view.
  return {
    x: (visible?.x ?? 0) + gap / 2 + column * gap,
    y: (visible?.y ?? 0) + gap / 2 + row * gap,
  };
}

export function manualLayout(rawOptions?: Record<string, unknown>): Layout {
  const options = { xField: 'x', yField: 'y', gap: 160, ...(rawOptions as ManualLayoutOptions) };
  const pinned = new Map<string, Point>();

  return {
    id: 'manual',
    description: 'Reads each node position from its own data; new nodes are parked in a grid.',
    // Position is the data here, so every node is placed and none is held *against* anything. Saying
    // so keeps a renderer from marking all of them as pinned, which marks the rule rather than the
    // exception and reads as every card being in some special state.
    derivesPositions: false,
    init(input): LayoutResult {
      const positions = new Map<string, Placement>();
      let unplaced = 0;
      let fromData = 0;
      let reused = 0;

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
          fromData += 1;
          continue;
        }
        const previous = input.previous?.get(node.id);
        if (previous) {
          positions.set(node.id, previous);
          reused += 1;
          continue;
        }
        positions.set(node.id, { ...trayPosition(input, unplaced, options.gap), fixed: true });
        unplaced += 1;
      }

      /*
        Say so only when this layout genuinely did nothing.

        The failure worth reporting is choosing `manual` for a graph that has no stored positions:
        every node keeps exactly where the previous layout left it, so on screen it is
        indistinguishable from a layout that ran and decided nothing needed moving — and "it silently
        does nothing" is the conclusion people reach.

        "No node carries x/y" is *not* that failure, and warning on it was wrong. A board whose cards
        have never been dragged carries no positions and is working perfectly: the nodes get parked
        into a grid, which is a visible arrangement and the whole reason `unplaced` exists. Reported
        anyway, it fired as a matter of course on every fresh board and then stayed on screen after
        the first drag made it untrue — a permanent warning about a state that had passed.

        So the test is what *happened*, not what was read: nothing from data, nothing parked, and
        something reused means every node stayed put and the layout was a no-op.
      */
      const warnings: string[] = [];
      if (fromData === 0 && unplaced === 0 && reused > 0) {
        warnings.push(
          `manual layout: no node carries "${options.xField}" and "${options.yField}", so every node was left exactly where it already was. ` +
            `It suits a board, where position is the data being edited — a graph without stored positions wants a layout that derives them.`,
        );
      }
      return { positions, warnings };
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
