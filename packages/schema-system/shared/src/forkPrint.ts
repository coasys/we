/**
 * What a copied part was, so the copy can be given back — and told whether it has changed since.
 *
 * Copying a module's part writes its tree into a template. Each level copied (the part placed, and
 * every part inside it that the copy opened) carries a {@link PartFork} on its top node: the props of
 * the placement it replaced, so giving it back restores exactly that placement — its `subject`, its
 * `inputs` — and a fingerprint of the level as it was copied.
 *
 * The fingerprint answers "has this changed since it was copied?" and nothing else. Comparing a copy
 * with what its module draws today would answer a different question: a module updated since would
 * read as somebody's edits. Each level answers only for itself, so a change to the avatar inside the
 * lines marks the lines changed and leaves the feed holding them unchanged.
 */
import { derivedNodeId } from './nodeIdentity';
import type { SchemaNode } from './types';

export interface PartFork {
  /** The props of the `$part` placement the copy replaced — its `id`, and any `subject` or `inputs`. */
  placement: Record<string, unknown>;
  /** {@link partForkPrint} of the level when it was copied. */
  print: string;
}

/**
 * A level of a copy as one string: keys sorted, ids and provenance left out, and every copied level
 * inside it reduced to which part it is, so it answers only for its own nodes.
 *
 * Ids are left out because they say where a node is rather than what it is, and nothing about a
 * level's content changes when they do.
 */
function canonical(value: unknown, top: boolean): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry, false)).join(',')}]`;
  const record = value as Record<string, unknown>;
  if (!top && record.forkedPart && typeof record.forkedFrom === 'string') {
    return `{"$fork":${JSON.stringify(record.forkedFrom)}}`;
  }
  return `{${Object.entries(record)
    .filter(([k, v]) => v !== undefined && k !== 'id' && k !== 'forkedPart' && k !== 'forkedFrom')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v, false)}`)
    .join(',')}}`;
}

/** The fingerprint of one copied level, as {@link PartFork.print} records it. */
export function partForkPrint(node: SchemaNode): string {
  return derivedNodeId(canonical(node, true));
}

/** Whether a copied level has changed since it was copied. A node that is not one has not. */
export function partForkChanged(node: SchemaNode): boolean {
  return !!node.forkedPart && partForkPrint(node) !== node.forkedPart.print;
}
