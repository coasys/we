/**
 * The forest — separate tidy trees, side by side, ordered by data.
 *
 * ## Why this is not `tree`
 *
 * `tree` is a **layered** layout: it puts every node on the rank its hop distance names and then sorts
 * each rank to minimise edge crossings. That is the right answer for a schema map or a dependency
 * graph, where nodes are shared between many parents and the tangle of lines is the thing to reduce.
 *
 * It is the wrong answer for a map somebody is *reading an order off*, and the conflict is exact:
 * crossing reduction decides a node's position within its rank, and in a ranked map that position **is
 * the content** — leftmost means strongest. The two cannot both have it. So here the order is
 * authoritative and crossings are a cost, drawn honestly rather than optimised away.
 *
 * Two consequences follow from that, and they are why this is a separate layout rather than a flag:
 *
 * - **Children sit under their own parent.** `tree` centres each *rank* against the widest rank and
 *   only keeps siblings adjacent, which reads as layers rather than as trees. A parent centred over
 *   its own children is the shape people mean by a tree, and getting it needs a subtree to own a
 *   horizontal span — which is a different algorithm, not a different constant.
 * - **A component is a tree of its own.** `tree` puts every root on rank 0 and lets the crossing
 *   heuristic interleave their subtrees, so two trees in one graph come out as one wide tangle.
 *
 * `tree` stays. They answer different questions and both belong in the catalog.
 *
 * ## The spine
 *
 * A canvas's connections are a general graph: a card may be related to several others in several ways,
 * and nothing in the data says which of those relations makes a *parent*. So a forest is always
 * "follow this one relation", and {@link ForestLayoutOptions.spine} is what names it. Every other edge
 * is still drawn — it simply does not decide where a card goes.
 *
 * ## One placement per card, and what that costs
 *
 * A card reachable from two parents is placed under **one** of them: the shallowest, and among equals
 * the one whose id sorts first, so the same data always draws the same way. The second relation is
 * still an edge and is still drawn, so nothing is hidden — what is lost is the *other* possible
 * position.
 *
 * That is a deliberate limit rather than an oversight. Drawing a card under every parent means two
 * nodes standing for one record, and a position in this engine belongs to a node address: two of them
 * would then disagree about which card a placement, a selection, a drag and a fold are about — and the
 * whole point of this mode is that it is the *same data* as the freeform canvas, which has exactly one
 * position per card. Showing the second parent belongs to the renderer, on hover, where it costs
 * nothing and says the true thing.
 */
import type {
  Bounds,
  GraphEdge,
  GraphValue,
  Layout,
  LayoutInput,
  LayoutRegion,
  LayoutResult,
  Placement,
} from '@we/graph-protocol';

/** Where cards that are on no tree go. */
export type UnattachedPlacement = 'right' | 'bottom';

export interface ForestLayoutOptions {
  /**
   * Which edges make a parent a parent — one field of an edge and the value it must hold.
   *
   * `{ field: 'data.relationshipTypeId', value: '<id>' }` follows one kind of connection a community
   * named; `{ field: 'type', value: 'contains' }` follows containment. Absent means **every** edge,
   * which is right for a canvas whose connections are all one kind and wrong the moment they are not.
   *
   * One object rather than two options because neither half is usable alone: a field with no value
   * selects nothing, and a value with no field has nothing to compare. The conventions call that one
   * field, not two.
   */
  spine?: { field: string; value: GraphValue };
  /**
   * Node data field that decides the order of siblings, left to right.
   *
   * Absent leaves them in the order the graph holds them, which is stable but says nothing. `weight`
   * for "strongest first", `createdAt` for "oldest first", `rank` for an order somebody dragged.
   */
  sortBy?: string;
  /** `desc` puts the largest first. Default `asc`, which is what a date wants. */
  sortDirection?: 'asc' | 'desc';
  /**
   * The second key, used only where the first ties.
   *
   * Not decoration. Two cards with the same number of votes have no order under `sortBy` alone, so
   * whichever the graph happened to hold first wins — and a subscription hands the graph fresh objects
   * every time anything changes, so the pair swap places at random while somebody is reading them.
   * That reads as the map being unstable rather than as a missing tiebreak. Defaults to `createdAt`,
   * and falls through to the node's address, which cannot tie.
   */
  tiebreakBy?: string;
  /**
   * The box every card is given. Uniform, deliberately: a tree's meaning is in its shape, and cards
   * at the sizes somebody chose on a freeform canvas make a rank read as significance it does not
   * carry. What a card is *drawn* as is a style rule's business; this is the room it is allotted.
   */
  card?: { width: number; height: number };
  /** Clear space between two cards side by side. */
  siblingGap?: number;
  /** Clear space between the bottom of one rank and the top of the next. */
  levelGap?: number;
  /** Clear space between one tree and the next. Defaults to three sibling gaps. */
  treeGap?: number;
  /** Where cards on no tree go. Default `right`; `bottom` suits a narrow screen. */
  unattached?: UnattachedPlacement;
  /** How many cards wide the unconnected zone is. Default 3, so it reads as a column rather than a field. */
  unattachedColumns?: number;
  /**
   * What the unconnected zone is called. The count is appended by the layout, since only it knows one.
   * Empty leaves the zone unlabelled; absent uses "Unconnected".
   */
  unattachedLabel?: string;
}

const DEFAULTS = {
  card: { width: 160, height: 120 },
  siblingGap: 28,
  levelGap: 56,
  unattached: 'right' as UnattachedPlacement,
  unattachedColumns: 3,
  unattachedLabel: 'Unconnected',
  tiebreakBy: 'createdAt',
};

/**
 * One field of an edge, by the same `data.<key>` spelling the style rules use.
 *
 * A local three-liner rather than the core's `readField`, because this package depends on the protocol
 * and nothing else — and the protocol is types only. Kept to the two cases a spine can name so the
 * two implementations cannot drift in any way that matters.
 */
function edgeField(edge: GraphEdge, field: string): GraphValue | undefined {
  if (field.startsWith('data.')) return edge.data?.[field.slice(5)];
  const value = (edge as unknown as Record<string, unknown>)[field];
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
}

/**
 * Compare two sort values, with **absent always last**.
 *
 * Whichever direction is asked for: a card nobody has voted on belongs at the end of a list ordered by
 * votes, and a card with no date belongs at the end of one ordered by date. Sending it to the front
 * when the direction flips would make "least first" mean "the ones with no answer first", which is not
 * a reading of the data anybody wants.
 */
function compareValues(a: GraphValue | undefined, b: GraphValue | undefined, descending: boolean): number {
  const aMissing = a === undefined || a === null || a === '';
  const bMissing = b === undefined || b === null || b === '';
  if (aMissing || bMissing) return aMissing && bMissing ? 0 : aMissing ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return descending ? b - a : a - b;
  const order = String(a).localeCompare(String(b));
  return descending ? -order : order;
}

export function forestLayout(rawOptions?: Record<string, unknown>): Layout {
  const options = { ...DEFAULTS, ...(rawOptions as ForestLayoutOptions) };
  const card = options.card ?? DEFAULTS.card;
  const siblingGap = options.siblingGap ?? DEFAULTS.siblingGap;
  const levelGap = options.levelGap ?? DEFAULTS.levelGap;
  const treeGap = options.treeGap ?? siblingGap * 3;
  const descending = options.sortDirection === 'desc';
  /** One rank to the next, centre to centre — the card plus the clear space under it. */
  const rankPitch = card.height + levelGap;

  return {
    id: 'forest',
    description:
      'Separate tidy trees side by side along one named relation, siblings ordered by a data field, with whatever is on no tree in a zone of its own.',
    init(input): LayoutResult {
      const warnings: string[] = [];
      const present = new Set(input.nodes.map((node) => node.id));
      const nodeById = new Map(input.nodes.map((node) => [node.id, node]));

      // ─── The spine ─────────────────────────────────────────────────────────

      /*
        A selector with no value names nothing, which is never what anybody means by one.

        `{ field: 'data.relationshipTypeId', value: '' }` is what a template produces the moment its
        spine picker is on "any kind" — and read literally it matches only lines whose kind is the empty
        string, so *every* card came out unconnected. Treated as absent instead, which is the house rule
        for an empty value everywhere else in WE and the only reading of it that is any use.
      */
      const spine = options.spine?.field && options.spine.value !== '' ? options.spine : undefined;
      /** Parent → children and child → parents, from the matching edges only. */
      const childrenOf = new Map<string, string[]>();
      const parentsOf = new Map<string, string[]>();
      let spineEdges = 0;

      for (const edge of input.edges) {
        // A line to something that is not on the graph cannot make a parent of anything. Filtered
        // here rather than trusted, because a seed drops hidden cards and keeps the edges they were on.
        if (!present.has(edge.source) || !present.has(edge.target) || edge.source === edge.target) continue;
        if (spine && edgeField(edge, spine.field) !== spine.value) continue;
        spineEdges += 1;
        (childrenOf.get(edge.source) ?? childrenOf.set(edge.source, []).get(edge.source)!).push(edge.target);
        (parentsOf.get(edge.target) ?? parentsOf.set(edge.target, []).get(edge.target)!).push(edge.source);
      }

      // ─── Roots, depth and the one parent each card is placed under ──────────

      /** Cards the spine touches at all. Everything else is unattached by definition. */
      const onSpine = new Set<string>([...childrenOf.keys(), ...parentsOf.keys()]);

      /*
        Breadth-first from the roots, so a card reachable at two depths sits at the shallower one and
        the traversal order cannot decide the drawing. Roots and children are walked in id order for
        the same reason: the same data has to lay out the same way every time, and a `Map`'s insertion
        order is whatever the query happened to return.
      */
      const sortedRoots = [...onSpine].filter((id) => !parentsOf.has(id)).sort();
      const depthOf = new Map<string, number>();
      const primaryParent = new Map<string, string>();
      /** Which root's tree each card belongs to — what groups the forest into components. */
      const treeOf = new Map<string, string>();
      let brokeLoop = false;

      const walk = (roots: string[]) => {
        const queue = [...roots];
        for (const root of roots) {
          depthOf.set(root, 0);
          treeOf.set(root, root);
        }
        for (let head = 0; head < queue.length; head += 1) {
          const id = queue[head];
          const depth = (depthOf.get(id) ?? 0) + 1;
          for (const child of [...(childrenOf.get(id) ?? [])].sort()) {
            if (depthOf.has(child)) continue;
            depthOf.set(child, depth);
            primaryParent.set(child, id);
            treeOf.set(child, treeOf.get(id)!);
            queue.push(child);
          }
        }
      };

      walk(sortedRoots);

      /*
        A loop along the spine has no root, so a component made entirely of one would be walked by
        nothing and every card in it would land in the unconnected zone — which is a lie: they are
        connected, just circularly. Opening the loop at its lowest id is arbitrary and deterministic,
        which is the best available answer, and it is reported rather than done quietly.
      */
      for (const id of [...onSpine].sort()) {
        if (depthOf.has(id)) continue;
        brokeLoop = true;
        walk([id]);
      }
      if (brokeLoop) {
        warnings.push(
          'forest layout: some cards are connected in a loop along the spine, so no card in that group is above the others. The loop was opened at one of them to draw it as a tree.',
        );
      }
      if (!spineEdges && input.nodes.length) {
        warnings.push(
          spine
            ? `forest layout: no connection matched the spine (${spine.field} = ${String(spine.value)}), so every card is in the unconnected zone. Pick a different kind of connection, or draw some.`
            : 'forest layout: there are no connections between these cards, so every one of them is in the unconnected zone.',
        );
      }

      // ─── Sibling order ──────────────────────────────────────────────────────

      const sortKey = (id: string): GraphValue | undefined =>
        options.sortBy ? nodeById.get(id)?.data?.[options.sortBy] : undefined;
      const tiebreakKey = (id: string): GraphValue | undefined =>
        options.tiebreakBy ? nodeById.get(id)?.data?.[options.tiebreakBy] : undefined;

      /*
        Three keys, in order, and the third cannot tie. Without the last one two cards equal on both
        of the first two are ordered by whatever `sort` does with equal elements over an array a
        subscription just rebuilt — so a reordering nobody asked for arrives with every unrelated
        change to the space.
      */
      const inOrder = (ids: string[]): string[] =>
        [...new Set(ids)].sort(
          (a, b) =>
            compareValues(sortKey(a), sortKey(b), descending) ||
            // The tiebreak is always ascending: it is there to be stable, not to be read.
            compareValues(tiebreakKey(a), tiebreakKey(b), false) ||
            a.localeCompare(b),
        );

      /** A card's children, in reading order, and only the ones it is the primary parent of. */
      const orderedChildren = (id: string): string[] =>
        inOrder((childrenOf.get(id) ?? []).filter((child) => primaryParent.get(child) === id));

      // ─── One tidy tree ──────────────────────────────────────────────────────

      /**
       * How wide each subtree is, bottom-up.
       *
       * A parent is at least as wide as its own card, so a node with one narrow child is not squeezed
       * to nothing, and at least as wide as its children laid side by side, so two subtrees can never
       * overlap however deep either goes. That pair of rules is the whole of what makes a tidy tree
       * tidy, and it is why this cannot be done with a constant per rank.
       */
      const span = new Map<string, number>();
      const measure = (id: string): number => {
        const kids = orderedChildren(id);
        if (!kids.length) {
          span.set(id, card.width);
          return card.width;
        }
        let total = 0;
        for (const kid of kids) total += measure(kid) + siblingGap;
        total -= siblingGap;
        const width = Math.max(card.width, total);
        span.set(id, width);
        return width;
      };

      const centreX = new Map<string, number>();
      /** Top-down: hand each subtree its left edge, and read the parent's centre back off its children. */
      const assign = (id: string, left: number): void => {
        const kids = orderedChildren(id);
        if (!kids.length) {
          centreX.set(id, left + card.width / 2);
          return;
        }
        let kidsTotal = 0;
        for (const kid of kids) kidsTotal += (span.get(kid) ?? card.width) + siblingGap;
        kidsTotal -= siblingGap;
        // Centred within the subtree's own span, which matters only when the parent's card is the
        // wider of the two — a single child otherwise hangs off one side of its parent.
        let cursor = left + ((span.get(id) ?? card.width) - kidsTotal) / 2;
        for (const kid of kids) {
          assign(kid, cursor);
          cursor += (span.get(kid) ?? card.width) + siblingGap;
        }
        const first = centreX.get(kids[0])!;
        const last = centreX.get(kids[kids.length - 1])!;
        centreX.set(id, (first + last) / 2);
      };

      // ─── The forest ─────────────────────────────────────────────────────────

      // Trees read left to right in the same order siblings do, by their own root — so "the strongest
      // proposal" is the top-left card whether it is a sibling or a tree of its own.
      const roots = inOrder([...treeOf.entries()].filter(([id, root]) => id === root).map(([id]) => id));
      const positions = new Map<string, Placement>();
      let cursorX = 0;

      for (const root of roots) {
        measure(root);
        assign(root, cursorX);
        cursorX += (span.get(root) ?? card.width) + treeGap;
      }
      // One trailing gap was added by the last tree; take it back so the zone beside it is not doubly far.
      const forestRight = roots.length ? cursorX - treeGap : 0;

      for (const [id, depth] of depthOf) {
        const x = centreX.get(id);
        if (x === undefined) continue;
        positions.set(id, { x, y: depth * rankPitch });
      }

      // ─── Whatever is on no tree ─────────────────────────────────────────────

      const loose = inOrder(input.nodes.map((node) => node.id).filter((id) => !depthOf.has(id)));
      const regions: LayoutRegion[] = [];

      if (loose.length) {
        const columns = Math.max(1, Math.floor(options.unattachedColumns ?? DEFAULTS.unattachedColumns));
        const pitchX = card.width + siblingGap;
        const forestBottom = depthOf.size ? (Math.max(...depthOf.values()) + 1) * rankPitch - levelGap : 0;

        // A clear run between the trees and the zone, so the divider is read as a boundary rather than
        // as one more gap between siblings.
        const gutter = treeGap * 2;
        const wide = options.unattached === 'bottom';
        const perRow = wide ? Math.max(columns, Math.floor(Math.max(forestRight, pitchX) / pitchX)) : columns;
        const originX = wide ? 0 : forestRight + gutter;
        const originY = wide ? forestBottom + gutter : 0;

        loose.forEach((id, index) => {
          positions.set(id, {
            x: originX + (index % perRow) * pitchX + card.width / 2,
            y: originY + Math.floor(index / perRow) * rankPitch,
          });
        });

        const rows = Math.ceil(loose.length / perRow);
        const widthOf = Math.min(loose.length, perRow) * pitchX - siblingGap;
        const bounds: Bounds = {
          minX: originX - siblingGap / 2,
          minY: originY - card.height / 2 - siblingGap / 2,
          maxX: originX + widthOf + siblingGap / 2,
          maxY: originY + (rows - 1) * rankPitch + card.height / 2 + siblingGap / 2,
        };
        const label = options.unattachedLabel ?? DEFAULTS.unattachedLabel;
        regions.push({
          id: 'forest:unattached',
          // The count is here rather than in the caller's label because only the layout knows one, and
          // "Unconnected" over a zone whose size the reader has to estimate says less than it could.
          ...(label ? { label: `${label} · ${loose.length}` } : {}),
          bounds,
        });
      }

      return {
        positions: keepFixed(positions, input),
        ...(regions.length ? { regions } : {}),
        ...(warnings.length ? { warnings } : {}),
      };
    },
  };
}

/**
 * A user-pinned node stays where it was put, whatever the layout would prefer.
 *
 * The same rule `deterministic.ts` applies, and duplicated rather than shared for now because it is
 * three lines and exporting it would put a helper in this package's public surface. If a third layout
 * needs it, it moves.
 */
function keepFixed(positions: Map<string, Placement>, input: LayoutInput): Map<string, Placement> {
  if (!input.previous) return positions;
  for (const [id, previous] of input.previous) {
    if (previous.fixed && positions.has(id)) positions.set(id, previous);
  }
  return positions;
}
