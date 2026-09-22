/**
 * What one record is called — the single answer to a question eight surfaces were each guessing.
 *
 * ## Why this exists
 *
 * A name is the smallest thing every surface needs and the only one none of them can compose: a
 * graph node's caption, a drag chip, a screen-reader announcement, a pocket row, a relation chip
 * naming its target, a breadcrumb, a card heading. None of those can show a property list, so each
 * had invented its own rule — a candidate-name list in the graph expanders, "the first required
 * string" in the record display, a literal property per template, a frozen copy in the pocket.
 *
 * Eight rules that disagree are eight rules that are wrong somewhere, and they were:
 *
 * - `CodeBlock` declares `code` as its only required string, so "first required string" put the
 *   **entire code body** in the card heading and the actual title on the summary line beneath it.
 * - `LinkBlock` has a required `url`, so a link card was headed by its URL.
 * - A composed note has no `title` at all, so the graph labelled it by `textContent` (its flattened
 *   text) while its record page insisted it was "Untitled" — one record, two names, on two surfaces
 *   a click apart.
 *
 * ## Convention before structure, declaration before both
 *
 * A property *called* `name` or `title` is a far stronger signal than "the first required string",
 * which is a fact about storage that only correlates with naming. So the order is: what the model
 * declares, else what it calls things, else its shape.
 *
 * The structural pass stays as the last resort because it is the only one that can answer for a
 * model nobody declared and whose author named nothing conventionally — a community shape of
 * `species`/`count`/`notes`, or a foreign SHACL class synced in from another app. That case never
 * goes away: a foreign model arrives as structure alone and no declaration can ever reach it, which
 * is why the guess is a permanent part of this and not a stepping stone to declaring everything.
 */
import type { EntitySchema } from './manifest';

/**
 * Property names that name the thing they sit on, most deliberate first.
 *
 * `textContent` is last because it is *derived* — a projection of a composition's text kept for
 * search and preview. A collection somebody named should show that name; only one nobody named
 * should fall back to what it happens to say.
 */
export const NAME_CANDIDATES = [
  'name',
  'title',
  'label',
  'handle',
  'subgroupName',
  'text',
  'content',
  'textContent',
] as const;

/** The little a property has to say about itself for this to judge it. */
export interface NameableProperty {
  name: string;
  type: string;
  required?: boolean;
  /**
   * The value is a stored file rather than a value of its own. A file expression URL is never a
   * name, however the property is spelled.
   */
  isFile?: boolean;
}

/**
 * The naming property of a bare property list — convention, then shape.
 *
 * Separate from {@link namePropertyOf} because half the callers have no declaration to consult: a
 * foreign model read back from SHACL, or the neutral shape the graph engine is handed.
 */
export function nameFromProperties(properties: NameableProperty[]): string {
  const nameable = properties.filter((property) => property.type === 'string' && !property.isFile);
  const byName = new Set(nameable.map((property) => property.name));
  for (const candidate of NAME_CANDIDATES) if (byName.has(candidate)) return candidate;
  // Required first: of two undeclared, unconventionally named strings, the one the model insists on
  // is likelier to be the subject than one it treats as optional detail.
  return (nameable.find((property) => property.required) ?? nameable[0])?.name ?? '';
}

/**
 * The naming property of a declared model — `display.title` where it says, else the guess.
 *
 * Works the same for a core entity and for a community shape, because they are the same type: a
 * shape's stored definition validates against this very `EntitySchema`, so a community that says
 * which field names its model is honoured exactly as WE's own vocabulary is.
 *
 * A declared name that no longer matches a property is ignored rather than trusted — a rename would
 * otherwise leave every surface reading an absent field, which renders as nothing at all.
 */
export function namePropertyOf(entity: Pick<EntitySchema, 'properties' | 'display'>): string {
  const declared = entity.display?.title;
  if (declared && entity.properties[declared]) return declared;
  return nameFromProperties(
    Object.entries(entity.properties).map(([name, spec]) => ({
      name,
      type: spec.type,
      ...(spec.required ? { required: true } : {}),
      ...(spec.format === 'file' ? { isFile: true } : {}),
    })),
  );
}
