/**
 * Folding a card into itself — which of the things hanging off it go away, and what stands in for
 * them while they are gone.
 *
 * This is {@link ExpansionState}'s problem asked on a **canvas** rather than in an explorer, and the
 * difference is what makes it a separate file. An explorer folds what it *opened*: it knows who
 * introduced every node, so closing a parent is a matter of releasing one claim and seeing what
 * nothing else holds. A canvas opened nothing. Every card was placed by a person, the whole graph is
 * loaded at once, and "what is under this card" is a question about the connections somebody drew —
 * so it has to be answered from the edges, every time, with no provenance to lean on.
 *
 * Two rules carry over from that file unchanged, because both were learned the hard way.
 *
 * **A fold must not take a card somebody else is holding.** The moment a card is pointed at from two
 * places — guaranteed the first afternoon anybody uses this — hiding the whole subtree under one of
 * them deletes a card that is still legitimately on screen, and leaves the *other* parent with a line
 * running to nothing. So a card goes only when every way to it from outside the fold passes through
 * the fold.
 *
 * **A fold must say what it hides.** A card that quietly loses five neighbours is a canvas telling a
 * lie: it shows an isolated thing where there were six related ones. So the count comes back with the
 * hidden set — a folded card wears it — and connections that crossed the boundary come back as
 * {@link FoldResult.bundles}, one aggregate line per surviving neighbour, which is the difference
 * between "this fold still relates to that card" and "nothing here relates to anything".
 *
 * Nothing here decides what any of that *looks* like, and nothing here holds state: it is one
 * function over the store and the set of cards a reader has folded, so the same input always answers
 * the same way. Which is what lets the fold set live in the address — a fold is then a thing you can
 * send somebody, and a reload comes back to the canvas you were reading.
 */
import type { GraphEdge } from '@we/graph-protocol';

import { GraphStore } from './store';

export interface FoldResult {
  /**
   * Node ids folded away: no card drawn, no line routed, no hit area. Absent from the positions map
   * is how the engine spells all three at once — see `GraphEngine.applyFold`.
   */
  hidden: Set<string>;
  /** Folded node → how many cards went away under it, which is the count a folded card carries. */
  counts: Map<string, number>;
  /** Hidden node → the folded card it went away under, for a bundle to attach to the right one. */
  owners: Map<string, string>;
  /** One aggregate line per surviving neighbour of the hidden set — see the note above. */
  bundles: GraphEdge[];
}

/** The prefix a bundled line's id carries, so a renderer can tell one from a real connection. */
export const FOLD_BUNDLE = 'fold-bundle';

const EMPTY: FoldResult = { hidden: new Set(), counts: new Map(), owners: new Map(), bundles: [] };

/**
 * What is hidden, and what stands in for it, given the cards a reader has folded.
 *
 * Three walks, in an order that matters:
 *
 * 1. **Downstream** of the folds, following connections outward — everything a fold *could* take.
 * 2. **Held** — what the rest of the canvas still reaches. This walk stops at a folded card rather
 *    than passing through it, because a fold is a boundary: that another card points at the fold
 *    says nothing about whether the fold's contents should be on screen. Getting this wrong makes
 *    folding do nothing at all whenever anything happens to point at the card being folded.
 * 3. Per fold, over what is left, for the counts and the bundles.
 *
 * A fold set naming a node the graph does not hold is ignored rather than refused — a canvas
 * re-reads, and an address outliving a deleted card must not break the rest of the fold.
 */
export function foldGraph(folded: Iterable<string>, store: GraphStore): FoldResult {
  const roots = new Set([...folded].filter((id) => store.hasNode(id)));
  if (!roots.size) return EMPTY;

  /*
    One walk per fold rather than one from all of them, because a fold must never hide itself.

    A cycle makes that a real case and not a pedantic one: two cards pointing at each other is an
    ordinary thing to draw, and a single multi-source walk reports the folded card as reachable from
    its own contents — so folding it hid the card that had just been folded, along with everything
    else, leaving nothing on screen and nothing to press to get it back. A card is never in its own
    downstream; it can still be in another fold's, which is what hides a fold inside a fold.
  */
  const downstreamOf = new Map<string, Set<string>>();
  const downstream = new Set<string>();
  for (const root of roots) {
    const under = reach([root], store, { skipSeeds: true, exclude: root });
    downstreamOf.set(root, under);
    for (const id of under) downstream.add(id);
  }

  /*
    Cards no fold can be holding: neither folded themselves nor anywhere under one. What they reach
    is what survives, which is the reference count written as a reachability question — cheaper than
    counting claims per card, and it cannot drift out of step with the edges the way a count can.
  */
  const anchors: string[] = [];
  for (const node of store.nodes()) if (!roots.has(node.id) && !downstream.has(node.id)) anchors.push(node.id);
  const held = reach(anchors, store, { stopAt: roots });

  const hidden = new Set<string>();
  for (const id of downstream) if (!held.has(id)) hidden.add(id);

  const { counts, owners } = countsFor(downstreamOf, hidden);
  return { hidden, counts, owners, bundles: bundlesFor(hidden, owners, store) };
}

/**
 * How many cards folding this one would take away — the question a fold control is offered on.
 *
 * Asked by recomputing the whole fold with this card added, rather than by counting its neighbours:
 * a child held by a second, unfolded parent is not hidden by this fold, and a control that promised
 * to fold a card and then took nothing away is worse than no control. Nested folds are already
 * counted in, since the recomputation sees them too.
 */
export function wouldFold(id: string, folded: Iterable<string>, store: GraphStore): number {
  const current = foldGraph(folded, store).hidden.size;
  return foldGraph([...folded, id], store).hidden.size - current;
}

/**
 * Which cards it is worth offering a fold on at all.
 *
 * Every card with an outgoing connection is a candidate, and each is answered exactly, by the
 * recomputation above. That is O(candidates × graph) and it is computed once per change to the fold
 * set rather than per frame — on a canvas, where a few dozen cards carry lines and the rest are
 * leaves, it costs less than the memo that would avoid it. A graph large enough for that to matter
 * has no business offering per-card furniture in the first place.
 */
export function foldableIn(folded: Iterable<string>, store: GraphStore): Set<string> {
  const already = new Set(folded);
  const { hidden } = foldGraph(already, store);
  const foldable = new Set<string>();
  for (const node of store.nodes()) {
    // A folded card is foldable by definition — the control is what unfolds it.
    if (already.has(node.id)) {
      foldable.add(node.id);
      continue;
    }
    if (hidden.has(node.id)) continue;
    if (!store.edgeIds(node.id, 'out').length) continue;
    if (wouldFold(node.id, already, store) > 0) foldable.add(node.id);
  }
  return foldable;
}

/**
 * Everything hanging off one card, following connections outward — what a fold is *about*, whether
 * or not it would be allowed to take all of it.
 *
 * The denominator to {@link wouldFold}'s numerator, and the difference between the two is what a
 * fold has to leave because something else is holding it. Exported so an interface can say so: a
 * control that takes two of the four cards under a card, silently, is a control that looks broken.
 */
export function downstreamOf(id: string, store: GraphStore): Set<string> {
  return store.hasNode(id) ? reach([id], store, { skipSeeds: true, exclude: id }) : new Set();
}

/**
 * Everything reachable from a set of nodes, following connections outward.
 *
 * `skipSeeds` leaves the starting nodes out of the answer unless something else reaches them, which
 * is what makes a fold inside a fold count as hidden while the outermost one stays on screen.
 * `stopAt` refuses to walk *through* a node — the fold boundary of walk two.
 */
function reach(
  from: Iterable<string>,
  store: GraphStore,
  options: { skipSeeds?: boolean; stopAt?: ReadonlySet<string>; exclude?: string } = {},
): Set<string> {
  const seen = new Set<string>();
  const worklist: string[] = [];
  for (const id of from) {
    for (const edge of store.edgeIds(id, 'out')) {
      const target = store.edge(edge)?.target;
      if (target) worklist.push(target);
    }
    if (!options.skipSeeds) seen.add(id);
  }
  while (worklist.length) {
    const id = worklist.pop()!;
    if (seen.has(id)) continue;
    // Walked through but never reported — a card is not under itself, however the lines come back
    // around to it.
    if (id === options.exclude) {
      for (const edge of store.edgeIds(id, 'out')) {
        const target = store.edge(edge)?.target;
        if (target && !seen.has(target)) worklist.push(target);
      }
      continue;
    }
    seen.add(id);
    // A boundary is reached but not passed through: it is in the answer, and what is under it is not.
    if (options.stopAt?.has(id)) continue;
    for (const edge of store.edgeIds(id, 'out')) {
      const target = store.edge(edge)?.target;
      if (target && !seen.has(target)) worklist.push(target);
    }
  }
  return seen;
}

/**
 * Per fold: how much went away under it, and which fold each hidden card belongs to.
 *
 * A card under two folds is attributed to the first that reaches it, so a bundle has one end to
 * attach to. Which of the two is arbitrary and saying so is the point — the alternative is a
 * bundled line drawn twice for one hidden connection.
 */
function countsFor(
  downstreamOf: ReadonlyMap<string, ReadonlySet<string>>,
  hidden: ReadonlySet<string>,
): { counts: Map<string, number>; owners: Map<string, string> } {
  const counts = new Map<string, number>();
  const owners = new Map<string, string>();
  for (const [root, under] of downstreamOf) {
    let count = 0;
    for (const id of under) {
      // Only what actually went away. A card under this fold that a second parent is still holding
      // is on screen, and counting it would promise the reader something the fold does not have.
      if (!hidden.has(id)) continue;
      count += 1;
      if (!owners.has(id)) owners.set(id, root);
    }
    counts.set(root, count);
  }
  return { counts, owners };
}

/**
 * One line per surviving neighbour of the hidden set, attached to the fold that hid it.
 *
 * Skipped where the fold and that neighbour are *already* joined by a line somebody drew: the reader
 * can see they relate, and a second parallel line fanned out beside the first says nothing they
 * cannot already read. Weight carries how many hidden connections it stands for, which is what a
 * renderer thickens and labels.
 *
 * Deliberately not `reifiedAs` anything. A bundle is a summary of several claims and standing for one
 * of them would be a lie a click could act on — so it carries no record, and an interface that opens
 * what a line means finds nothing behind this one, which is the honest answer.
 */
function bundlesFor(hidden: ReadonlySet<string>, owners: ReadonlyMap<string, string>, store: GraphStore): GraphEdge[] {
  /** Pairs already joined on screen, unordered, so a bundle is not drawn beside a real line. */
  const drawn = new Set<string>();
  for (const edge of store.edges()) {
    if (hidden.has(edge.source) || hidden.has(edge.target)) continue;
    drawn.add(pairKey(edge.source, edge.target));
  }

  const counts = new Map<string, { root: string; other: string; weight: number; outward: boolean }>();
  for (const id of hidden) {
    const root = owners.get(id);
    if (!root) continue;
    for (const edgeId of store.edgeIds(id)) {
      const edge = store.edge(edgeId);
      if (!edge) continue;
      const other = edge.source === id ? edge.target : edge.source;
      // Inside the fold, or the line into the fold itself: neither is information the folded card
      // is missing — one is gone with its contents, the other is the fold.
      if (hidden.has(other) || other === root) continue;
      if (drawn.has(pairKey(root, other))) continue;
      const key = pairKey(root, other);
      const existing = counts.get(key);
      if (existing) existing.weight += 1;
      else counts.set(key, { root, other, weight: 1, outward: edge.source === id });
    }
  }

  return [...counts.values()].map(({ root, other, weight, outward }) => ({
    id: `${FOLD_BUNDLE}|${root}|${other}`,
    source: outward ? root : other,
    target: outward ? other : root,
    type: FOLD_BUNDLE,
    weight,
    label: String(weight),
  }));
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}
