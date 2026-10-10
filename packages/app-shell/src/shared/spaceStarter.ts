/**
 * What a new space starts with, beyond what every space has.
 *
 * ## The split
 *
 * The **host** makes a space's structure, always: the `Space` record (identity — the create form's
 * inputs and the backend's ids) and the **space collection** (`Space.root`), the one collection
 * everything top-level hangs off. Where top-level content lives is not an opinion about a community,
 * so no layer can remove either.
 *
 * A **starter** adds what *is* an opinion: defaults for the space's settings, the records it begins
 * with, names for some of them (`roles`), and switches for the opinionated behaviours (`input`:
 * extract the loose messages typed into the space). The seed carries the deployment's starters under
 * `spaceStarters`, the first being the one a new space gets; later levels (a cartridge, a template,
 * the person in the create dialog) will carry their own in the same format.
 *
 * ## Records are records
 *
 * A starter writes records and nothing else, so it can begin a space with anything the space's
 * schema can hold, and nothing in this file knows what any of them are for. A canvas, a board and
 * its columns, the community's task states, a channel inside a category, ten welcome posts with a
 * paragraph and a picture each — all of it is `{ entity, fields, in }`, written in order:
 *
 * - **`in`** is containment: `$root` or an earlier record's `$id`. Without one, nothing contains the
 *   record — right for vocabulary, which is found by its type rather than by where it sits. Every
 *   link is written out, containment included, so a record says what it is inside or is inside
 *   nothing; `validate:seed` lists the uncontained ones, so a forgotten `in` shows.
 * - **A reference** is a string that is exactly `$<name>`: an earlier record's `$id`, `$root`, or
 *   `$space` (the `Space` record). It may be a field's value, or an element of a list, which is how
 *   a relation is written. A reference inside a JSON value — a block's `marks` — is left as text.
 * - **`{{space.name}}`** and **`{{space.description}}`** in any string are filled in from the create
 *   form, so a seeded post can greet the space by name.
 * - **`settings`** are the `Space` record's own fields. Plain values are written with the record; a
 *   setting whose value is a reference — `"taskStates": ["$todo", "$doing", "$done"]` — is a relation
 *   on the space, written once the records it names exist.
 *
 * What a record's writer derives from it, the starter does not spell out: a composition (a
 * `CollectionBlock` of `type: 'root'`) is written as the blocks inside it, and the stored document a
 * renderer draws from is derived from those afterwards — see `StarterWriter.compose`.
 *
 * ## Why a starter is separate from a template
 *
 * A template can recommend one, but must never assume its records exist, because a space can switch
 * template. Templates find what a starter made by role (`spaceStore.roles`), and handle a role being
 * absent.
 *
 * ## Writes happen on the create press
 *
 * So they are the person asking — no starter record is ever conjured by a renderer, which is the same
 * rule that kept the like reaction out of read paths.
 */

/** One record a starter writes. */
export interface SpaceStarterRecord {
  /** A name other records and `roles` refer to it by, as `$<name>` — before it has a real id. */
  $id?: string;
  /** The entity to create, by manifest name. */
  entity: string;
  /**
   * Its fields, as the entity's create takes them. A string that is exactly `$<name>` is a reference
   * to an earlier record, `$root` or `$space`, and a list of them is a to-many relation.
   */
  fields?: Record<string, unknown>;
  /** What contains it: `$root` (the space collection) or an earlier record's `$id`. Absent, nothing does. */
  in?: string;
}

export interface SpaceStarter {
  id: string;
  /** What somebody choosing between starters reads. */
  name?: string;
  description?: string;
  /**
   * The `Space` record's fields, keyed by name. Lists of plain values are stored as JSON, as the
   * fields hold them; a reference or a list of references is a relation, written after the records.
   */
  settings?: Record<string, unknown>;
  records?: SpaceStarterRecord[];
  /** Role name → `$<id>` of the record playing it. One `SpaceRole` record each. */
  roles?: Record<string, string>;
  /** Extract the space collection's loose messages — kept as the `extractLooseMessages` setting. */
  input?: boolean;
}

/** The starter a new space gets: the first the deployment lists. */
export function defaultSpaceStarter(starters: readonly SpaceStarter[] | undefined): SpaceStarter | undefined {
  return starters?.[0];
}

/** The `kind` the host gives the space collection — see `Space.root`. */
export const SPACE_COLLECTION_KIND = 'space';

/** The space collection, in a starter's references. Always defined. */
export const ROOT_REF = '$root';

/** The `Space` record itself, in a starter's references. Always defined. */
export const SPACE_REF = '$space';

/** What the create form fills in, by placeholder. */
export interface StarterContext {
  space: { name: string; description: string };
}

/**
 * `Space` fields a starter may not set: the space's identity, which is the create form's and the
 * backend's to decide. Everything else on `Space` is a setting.
 */
const IDENTITY_FIELDS = new Set(['uuid', 'url', 'name', 'description', 'discovery', 'avatar', 'coverImage']);

/** A string that is a reference, and the name it refers to. */
const REFERENCE = /^\$([A-Za-z_][\w-]*)$/;
const referenceName = (value: unknown): string | null =>
  typeof value === 'string' ? (REFERENCE.exec(value)?.[1] ?? null) : null;

/** A value that is a reference, or a non-empty list of nothing but references. */
const isReferenceValue = (value: unknown): boolean =>
  referenceName(value) !== null || (Array.isArray(value) && value.length > 0 && value.every((v) => referenceName(v)));

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;
const PLACEHOLDERS = new Set(['space.name', 'space.description']);

/** `{{space.name}}` and the like filled in, in every string inside `value`. */
function fillPlaceholders(value: unknown, context: StarterContext): unknown {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER, (whole, key: string) => {
      if (key === 'space.name') return context.space.name;
      if (key === 'space.description') return context.space.description;
      return whole;
    });
  }
  if (Array.isArray(value)) return value.map((v) => fillPlaceholders(v, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillPlaceholders(v, context)]));
  }
  return value;
}

/** The `Space` fields a starter sets with the record: every setting that is not a relation. */
export function starterSettings(starter: SpaceStarter | undefined): Record<string, unknown> {
  if (!starter) return {};
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(starter.settings ?? {})) {
    if (IDENTITY_FIELDS.has(key) || isReferenceValue(value)) continue;
    // `enabledModules`, `enabledViews` and `extractionTargets` hold their list as one JSON string.
    fields[key] = Array.isArray(value) ? JSON.stringify(value) : value;
  }
  if (starter.input !== undefined) fields.extractLooseMessages = starter.input;
  return fields;
}

/** How a starter's records reach the dataset — injected, so this file names no store and no backend. */
export interface StarterWriter {
  /** Create one record, contained by `parentId` when there is one, and answer its id. */
  create(entity: string, fields: Record<string, unknown>, parentId: string | null): Promise<string>;
  /** Record that `nodeId` plays `name` in this space. */
  role(name: string, nodeId: string): Promise<void>;
  /** Write relations on the `Space` record: each value one id, or a list of them in order. */
  linkSpace(relations: Record<string, string | string[]>): Promise<void>;
  /**
   * Finish one record once everything is written — what the writer derives from a record rather
   * than what the starter says. A composition's stored document is the case: it is derived from the
   * blocks inside it, so it can only be written once they are. Called deepest first; a writer that
   * has nothing to derive for a record does nothing.
   */
  compose(id: string, entity: string, fields: Record<string, unknown>): Promise<void>;
}

/** Where a starter writes: the space it is starting, and what the create form said about it. */
export interface StarterTarget extends StarterContext {
  rootId: string;
  spaceId: string;
}

/**
 * Write a starter's records, the space's relations and the roles, in that order.
 *
 * Records are written in the order listed, so a record can only be contained by, or refer to, one
 * written before it — which is also what makes a cycle impossible to express. A record that fails is
 * reported and skipped, and so is anything that refers to it: the space already exists, and a
 * starter that half-applied is better than a create that threw away what somebody typed.
 *
 * Answers the roles written, by name.
 */
export async function applyStarterRecords(
  starter: SpaceStarter | undefined,
  target: StarterTarget,
  writer: StarterWriter,
  report: (message: string, error?: unknown) => void = (message, error) => console.error(message, error),
): Promise<Record<string, string>> {
  const ids = new Map<string, string>([
    [referenceName(ROOT_REF)!, target.rootId],
    [referenceName(SPACE_REF)!, target.spaceId],
  ]);
  /** A value with its references resolved, or null when one of them names a record that was not written. */
  const resolve = (value: unknown): { value: unknown } | null => {
    const one = referenceName(value);
    if (one !== null) return ids.has(one) ? { value: ids.get(one) } : null;
    if (Array.isArray(value) && value.some((v) => referenceName(v) !== null)) {
      const out: unknown[] = [];
      for (const v of value) {
        const name = referenceName(v);
        if (name === null) out.push(v);
        else if (ids.has(name)) out.push(ids.get(name));
        else return null;
      }
      return { value: out };
    }
    return { value };
  };

  const written: { id: string; entity: string; fields: Record<string, unknown> }[] = [];
  records: for (const record of starter?.records ?? []) {
    let parentId: string | null = null;
    if (record.in !== undefined) {
      const container = referenceName(record.in);
      parentId = container ? (ids.get(container) ?? null) : null;
      if (!parentId) {
        report(`space starter: ${record.entity} names a container that was not written (${record.in})`);
        continue;
      }
    }
    const fields: Record<string, unknown> = {};
    for (const [name, raw] of Object.entries(record.fields ?? {})) {
      const resolved = resolve(raw);
      if (!resolved) {
        report(`space starter: ${record.entity}.${name} refers to a record that was not written`);
        continue records;
      }
      fields[name] = fillPlaceholders(resolved.value, target);
    }
    try {
      const id = await writer.create(record.entity, fields, parentId);
      if (record.$id) ids.set(record.$id, id);
      written.push({ id, entity: record.entity, fields });
    } catch (error) {
      report(`space starter: could not write ${record.entity}`, error);
    }
  }

  const relations: Record<string, string | string[]> = {};
  for (const [name, raw] of Object.entries(starter?.settings ?? {})) {
    if (IDENTITY_FIELDS.has(name) || !isReferenceValue(raw)) continue;
    const resolved = resolve(raw);
    if (!resolved) report(`space starter: settings.${name} refers to a record that was not written`);
    else relations[name] = resolved.value as string | string[];
  }
  if (Object.keys(relations).length) {
    try {
      await writer.linkSpace(relations);
    } catch (error) {
      report('space starter: could not write the space’s relations', error);
    }
  }

  // Deepest first: a composition inside a composition is derived before the one holding it.
  for (const record of [...written].reverse()) {
    try {
      await writer.compose(record.id, record.entity, record.fields);
    } catch (error) {
      report(`space starter: could not finish ${record.entity}`, error);
    }
  }

  const roles: Record<string, string> = {};
  for (const [name, ref] of Object.entries(starter?.roles ?? {})) {
    const target = referenceName(ref);
    const nodeId = target ? ids.get(target) : undefined;
    if (!nodeId) {
      report(`space starter: role ${name} names a record that was not written (${ref})`);
      continue;
    }
    try {
      await writer.role(name, nodeId);
      roles[name] = nodeId;
    } catch (error) {
      report(`space starter: could not record role ${name}`, error);
    }
  }
  return roles;
}

/**
 * The `$id`s nothing in the starter refers to — no record's `in`, no field, no setting, no role.
 *
 * An `$id` exists so something can refer to a record before it has a real id; one nothing refers
 * to suggests a connection that is not there. Not a problem a create press would hit, so
 * `validate:seed` warns about these rather than failing.
 */
export function unreferencedIds(starter: SpaceStarter): string[] {
  const referred = new Set<string>();
  const collect = (value: unknown) => {
    for (const v of Array.isArray(value) ? value : [value]) {
      const name = referenceName(v);
      if (name !== null) referred.add(name);
    }
  };
  for (const record of starter.records ?? []) {
    collect(record.in);
    for (const value of Object.values(record.fields ?? {})) collect(value);
  }
  for (const value of Object.values(starter.settings ?? {})) collect(value);
  for (const ref of Object.values(starter.roles ?? {})) collect(ref);
  return (starter.records ?? []).map((record) => record.$id).filter((id): id is string => !!id && !referred.has(id));
}

/** What a starter may name, for checking one before it ships. */
export interface StarterVocabulary {
  /** Entity names the space's schema declares. */
  entities: ReadonlySet<string>;
  /** `Space` field names: its properties, and its relations (which a setting can reference records into). */
  spaceFields: ReadonlySet<string>;
  /** Template ids the deployment bundles. */
  templates?: ReadonlySet<string>;
  /** Module ids the deployment ships. */
  modules?: ReadonlySet<string>;
}

/**
 * Everything wrong with a starter, as sentences — empty when it is fine.
 *
 * The same checks `validate:seed` makes, so a starter that would half-apply at a create press fails
 * at build time instead.
 */
export function starterProblems(starter: SpaceStarter, vocabulary: StarterVocabulary): string[] {
  const problems: string[] = [];
  if (!starter.id) problems.push('a starter needs an id');

  for (const key of Object.keys(starter.settings ?? {})) {
    if (IDENTITY_FIELDS.has(key)) problems.push(`settings.${key} is the space's identity, not a setting`);
    else if (!vocabulary.spaceFields.has(key)) problems.push(`settings.${key} is not a Space field`);
  }
  const template = starter.settings?.defaultTemplateId;
  if (typeof template === 'string' && vocabulary.templates && !vocabulary.templates.has(template)) {
    problems.push(`settings.defaultTemplateId names a template this deployment does not bundle: ${template}`);
  }
  const modules = starter.settings?.enabledModules;
  if (Array.isArray(modules) && vocabulary.modules) {
    for (const id of modules) {
      if (!vocabulary.modules.has(String(id))) problems.push(`settings.enabledModules names an unknown module: ${id}`);
    }
  }

  const defined = new Set<string>([referenceName(ROOT_REF)!, referenceName(SPACE_REF)!]);
  const references = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [value]).map(referenceName).filter((name): name is string => name !== null);
  const placeholders = (value: unknown): string[] => {
    if (typeof value === 'string') return [...value.matchAll(PLACEHOLDER)].map((m) => m[1]);
    if (Array.isArray(value)) return value.flatMap(placeholders);
    if (value && typeof value === 'object') return Object.values(value).flatMap(placeholders);
    return [];
  };

  const taskStateSlugs = new Set(
    (starter.records ?? []).filter((r) => r.entity === 'TaskState').map((r) => String(r.fields?.slug ?? '')),
  );
  (starter.records ?? []).forEach((record, index) => {
    const at = `records[${index}]`;
    if (!vocabulary.entities.has(record.entity)) problems.push(`${at}.entity is not in the manifest: ${record.entity}`);
    if (record.in === null) {
      problems.push(`${at}.in is null — leave it out for a record nothing contains`);
    } else if (record.in !== undefined) {
      const container = referenceName(record.in);
      if (!container || container === referenceName(SPACE_REF) || !defined.has(container)) {
        problems.push(`${at}.in must name ${ROOT_REF} or an earlier record's $id: ${record.in}`);
      }
    }
    for (const [name, value] of Object.entries(record.fields ?? {})) {
      for (const ref of references(value)) {
        if (!defined.has(ref)) problems.push(`${at}.fields.${name} refers to $${ref}, which no earlier record defines`);
      }
      for (const key of placeholders(value)) {
        if (!PLACEHOLDERS.has(key)) problems.push(`${at}.fields.${name} has an unknown placeholder: {{${key}}}`);
      }
    }
    /*
      A column is bound to a state by slug, and shows the work in it. A slug no state defines is a
      column nothing ever arrives in — and nothing on screen says why.
    */
    const slug = record.fields?.slug;
    if (record.entity === 'CollectionBlock' && record.fields?.kind === 'column' && typeof slug === 'string' && slug) {
      if (!taskStateSlugs.has(slug))
        problems.push(`${at} is a column for a task state the starter does not define: ${slug}`);
    }
    if (record.$id !== undefined) {
      if (defined.has(record.$id)) problems.push(`${at}.$id is used twice: ${record.$id}`);
      defined.add(record.$id);
    }
  });

  for (const [name, value] of Object.entries(starter.settings ?? {})) {
    if (!isReferenceValue(value)) continue;
    for (const ref of references(value)) {
      if (!defined.has(ref)) problems.push(`settings.${name} refers to $${ref}, which no record defines`);
    }
  }

  for (const [name, ref] of Object.entries(starter.roles ?? {})) {
    const target = referenceName(ref);
    if (!target || target === referenceName(ROOT_REF) || target === referenceName(SPACE_REF) || !defined.has(target)) {
      problems.push(`roles.${name} must name a record's $id: ${ref}`);
    }
  }
  return problems;
}
