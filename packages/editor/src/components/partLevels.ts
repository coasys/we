/**
 * The levels between a placed part and a node somebody reached inside it, and how to select one.
 *
 * A node inside a part is selected with the placements it sits in, outermost first: the template's
 * own `$part`, then each part placed inside the one before. The levels above it are those placements.
 * The outermost is a node of the template and is selected as one; every other is the module's, and
 * is selected the way the node itself was — as somebody else's, with the chain down to it.
 *
 * One place for this because two things walk it: the path in the inspector's heading, and Escape,
 * which goes up a level. Two copies of "what is a level up" would disagree the first time either
 * changed.
 */
import type { OwnerRef, VisualEditorContextValue } from '@we/schema-solid';

import { lastOf } from '../utils';

export interface PartLevel {
  /** The placement's id: the template's node for the first, a derived id for the rest. */
  id: string;
  /** The `$part` id it places. */
  part: string;
}

/** The placements above a node reached inside a part, outermost first — never the node itself. */
export function levelsAbove(owner: OwnerRef): PartLevel[] {
  const chain = owner.chain ?? [];
  const parts = owner.parts ?? [];
  const levels = chain.map((id, i) => ({ id, part: parts[i] ?? '' }));
  // A part pressed inside another is its own last link, and is not above itself.
  return lastOf(levels)?.id === owner.id ? levels.slice(0, -1) : levels;
}

/** Select one of the levels above a node inside a part, by its position in `levelsAbove`. */
export function selectLevel(
  visualEditor: VisualEditorContextValue,
  owner: OwnerRef,
  index: number,
  nameOf: (part: string) => string,
): void {
  const levels = levelsAbove(owner);
  const level = levels[index];
  if (!level) return;
  if (index === 0) {
    visualEditor.onSelect(level.id);
    return;
  }
  visualEditor.onSelectOwner({
    kind: 'part-node',
    id: level.id,
    name: nameOf(level.part),
    chain: (owner.chain ?? []).slice(0, index + 1),
    parts: (owner.parts ?? []).slice(0, index + 1),
  });
}
