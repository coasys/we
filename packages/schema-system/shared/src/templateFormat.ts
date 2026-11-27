/**
 * A template's format version: which edition of the template format it is written in.
 *
 * Every template says it, as `schemaVersion` on the root, and a reader checks it before anything
 * else — the same bargain a bundle's `formatVersion` makes. A template is data that another host,
 * written in another language, may be asked to render; without the number, a host meeting a template
 * written for a newer format can only guess which parts it understands, and a guess renders a
 * template that looks fine and is quietly missing whatever the newer format added. With it, a host
 * refuses what it cannot read and says why.
 *
 * Templates stored before the field was required carry no number, and are format 1: the reader
 * supplies it (`readTemplate`), so nothing stored has to be rewritten. A template the repo authors
 * writes it out.
 *
 * Not to be confused with a theme's own `schemaVersion`, which numbers the theme's parameters, or a
 * template's `templateVersion`, which counts its author's edits.
 */

/** The template format this build writes. */
export const TEMPLATE_SCHEMA_VERSION = 1;

/** Every template format this build reads. */
export const TEMPLATE_SCHEMA_VERSIONS: readonly number[] = [1];

/**
 * Why a template's format cannot be read here, or null when it can. An absent version is format 1.
 * Checked first, before the template's shape, because a newer format is free to change that shape.
 */
export function templateVersionProblem(template: unknown): string | null {
  if (typeof template !== 'object' || template === null) return null;
  const version = (template as { schemaVersion?: unknown }).schemaVersion;
  if (version === undefined) return null;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    return `schemaVersion must be a whole number from 1, the template format it is written in; it is ${JSON.stringify(version)}`;
  if (!TEMPLATE_SCHEMA_VERSIONS.includes(version))
    return `Written for template format ${version}; this build reads format${TEMPLATE_SCHEMA_VERSIONS.length > 1 ? 's' : ''} ${TEMPLATE_SCHEMA_VERSIONS.join(', ')}. Update WE to use it.`;
  return null;
}

/** A template as read: its format version supplied where it was stored without one. */
export function readTemplate<T extends object>(template: T): T & { schemaVersion: number } {
  const version = (template as { schemaVersion?: unknown }).schemaVersion;
  return version === undefined
    ? { ...template, schemaVersion: TEMPLATE_SCHEMA_VERSION }
    : (template as T & { schemaVersion: number });
}
