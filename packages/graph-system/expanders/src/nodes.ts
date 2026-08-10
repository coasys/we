/**
 * Turning a backend row into a graph node.
 *
 * Shared by every expander here, because the interesting judgement — *what do you call a thing nobody
 * wrote code for?* — has one right answer and it should not be re-guessed per expander.
 */
import type { EntityShape, GraphNode, GraphValue } from '@we/graph-protocol';
import { entityAddress } from '@we/graph-protocol';

/** Property names worth trying as a label, in descending order of how likely they are to be one. */
const LABEL_CANDIDATES = ['name', 'title', 'label', 'handle', 'subgroupName', 'text', 'content'];

/**
 * The property that best names an instance of a shape.
 *
 * Prefers what the backend *declares* — AD4M's interpretation classes mark one property as the
 * identity used for dedup, which is by construction the title-like field. Only when nothing is
 * declared does it fall back to guessing, and the guess is ordered so a `name` beats a `text` that
 * happens to sort first.
 */
export function labelProperty(shape: EntityShape | undefined): string | undefined {
  if (!shape) return undefined;
  if (shape.identityProperty) return shape.identityProperty;
  const names = new Set(shape.properties.map((p) => p.name));
  for (const candidate of LABEL_CANDIDATES) if (names.has(candidate)) return candidate;
  return shape.properties.find((p) => p.type === 'string' && p.required)?.name;
}

/** Truncate a label to something that fits beside a node rather than across the whole graph. */
function trim(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** Only scalars travel into `data` — anything else belongs behind a node template. */
function scalars(row: Record<string, unknown>, shape?: EntityShape): Record<string, GraphValue> {
  const result: Record<string, GraphValue> = {};
  const allowed = shape ? new Set(shape.properties.map((p) => p.name)) : undefined;
  for (const [key, value] of Object.entries(row)) {
    if (allowed && !allowed.has(key)) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      result[key] = value as GraphValue;
    }
  }
  return result;
}

export function rowToNode(
  row: Record<string, unknown>,
  entity: string,
  dataset: string,
  shape: EntityShape | undefined,
  source: string,
): GraphNode | null {
  const id = typeof row.id === 'string' ? row.id : undefined;
  if (!id) return null;
  const labelKey = labelProperty(shape);
  return {
    id: entityAddress(dataset, entity, id),
    kind: 'entity',
    type: entity,
    label: (labelKey ? trim(row[labelKey]) : undefined) ?? trim(row.name) ?? entity,
    data: scalars(row, shape),
    source,
  };
}

/**
 * A node standing in for something referenced but not read.
 *
 * The normal case in a peer-to-peer system, not an error: a relation target that has not synced, a
 * space nobody has joined. Rendering it as a placeholder is the difference between "not here yet" and
 * "nothing here", and without it every expander would invent its own version of the same thing.
 */
export function placeholder(dataset: string, entity: string, id: string, source: string): GraphNode {
  return {
    id: entityAddress(dataset, entity, id),
    kind: 'entity',
    type: entity,
    label: entity,
    unresolved: true,
    source,
  };
}

/** Deterministic edge id, so re-expanding the same relation never doubles an edge. */
export function edgeId(source: string, type: string, target: string): string {
  return `${source}|${type}|${target}`;
}
