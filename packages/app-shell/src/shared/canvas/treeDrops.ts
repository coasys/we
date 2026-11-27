/**
 * A tree drop's reading of the data, as plain rules: who hangs under whom along a spine of
 * connections, which classes a model relation joins, and the ranks a canvas's placements hold.
 *
 * The record store reads the connections, the records and the placements, and writes the move; these
 * are what it works out in between. Where a card is seated in its row is the `treeRanks` kernel.
 */
import type { FollowedRelation } from '@we/graph-expanders';
import { heldByChild } from '@we/graph-protocol';

import { isRank } from '../kernels/treeRanks';

/** A connection of the spine kind, as the store reads one back. */
export interface SpineLink {
  id: string;
  source?: string;
  target?: string;
  /** The parent's entity name, which a new connection beside this one needs and cannot derive. */
  sourceType?: string;
}

/** A spine read as a tree: each card's connection to its parent, and each parent's children in order. */
export interface SpineIndex {
  /** The connection a card hangs by, by the card's id. */
  parentOf: Map<string, SpineLink>;
  /** The cards under each parent, in the order their connections were read. */
  childrenOf: Map<string, string[]>;
  /** Each card's parent's id, for `isUnder`. */
  parents: Record<string, string>;
}

/** The spine's connections as a tree. A connection missing either end joins nothing and is left out. */
export function spineIndex(links: readonly SpineLink[]): SpineIndex {
  const parentOf = new Map<string, SpineLink>();
  const childrenOf = new Map<string, string[]>();
  for (const link of links) {
    if (typeof link.source !== 'string' || typeof link.target !== 'string') continue;
    parentOf.set(link.target, link);
    (childrenOf.get(link.source) ?? childrenOf.set(link.source, []).get(link.source)!).push(link.target);
  }
  const parents = Object.fromEntries([...parentOf].map(([child, link]) => [child, link.source!]));
  return { parentOf, childrenOf, parents };
}

/**
 * The two classes a relation joins in a tree — which may hang under which. Which end is the parent is
 * `heldByChild` from `@we/graph-protocol`, as the canvas seed's is.
 */
export const endsOf = (relation: FollowedRelation): { childType: string; parentType: string } =>
  heldByChild(relation)
    ? { childType: relation.holder, parentType: relation.target }
    : { childType: relation.target, parentType: relation.holder };

/**
 * The ranks a canvas's placements hold, by card, and which cards have a placement at all — the only
 * ones a rank can be written to.
 *
 * A model relation's children are mostly pulled in by the seed and never placed, and a rank written
 * at one of those fails with "drag this onto the canvas first" — once per sibling, on every drop. Their
 * order stays the layout's own.
 */
export function ranksOf(placements: readonly { node?: unknown; rank?: unknown }[]): {
  ranks: Record<string, number>;
  placed: Set<string>;
} {
  const ranks: Record<string, number> = {};
  const placed = new Set<string>();
  for (const row of placements) {
    if (typeof row.node !== 'string') continue;
    placed.add(row.node);
    const rank = Number(row.rank);
    if (isRank(rank)) ranks[row.node] = rank;
  }
  return { ranks, placed };
}
