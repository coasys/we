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
 * A **starter** adds what *is* an opinion: defaults for the space's settings, a few records to begin
 * with (a reaction, a canvas), names for some of them (`roles`), and switches for the opinionated
 * behaviours (`input`: extract the loose messages typed into the space). The seed carries the
 * deployment's starter under `spaceStarter`; later levels (a cartridge, a template, the person in the
 * create dialog) will carry their own in the same format.
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
  /** Its fields, as the entity's create takes them. */
  fields?: Record<string, unknown>;
  /** What contains it: `$root` (the space collection, also the default) or `$<id>` of an earlier record. */
  in?: string;
}

export interface SpaceStarter {
  id: string;
  /** Defaults for the `Space` record's settings, keyed by field. Arrays are stored as JSON, as the fields hold them. */
  settings?: Record<string, unknown>;
  records?: SpaceStarterRecord[];
  /** Role name → `$<id>` of the record playing it. One `SpaceRole` record each. */
  roles?: Record<string, string>;
  /** Extract the space collection's loose messages — kept as the `extractLooseMessages` setting. */
  input?: boolean;
}

/** The `kind` the host gives the space collection — see `Space.root`. */
export const SPACE_COLLECTION_KIND = 'space';

/** The space collection, in a starter's references. Always defined. */
export const ROOT_REF = '$root';

/**
 * `Space` fields a starter may not set: the space's identity, which is the create form's and the
 * backend's to decide. Everything else on `Space` is a setting.
 */
const IDENTITY_FIELDS = new Set(['uuid', 'url', 'name', 'description', 'discovery', 'avatar', 'coverImage']);

/** The `Space` fields a starter sets, ready to be written with the record. */
export function starterSettings(starter: SpaceStarter | undefined): Record<string, unknown> {
  if (!starter) return {};
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(starter.settings ?? {})) {
    if (IDENTITY_FIELDS.has(key)) continue;
    // `enabledModules`, `enabledViews` and `extractionTargets` hold their list as one JSON string.
    fields[key] = Array.isArray(value) ? JSON.stringify(value) : value;
  }
  if (starter.input !== undefined) fields.extractLooseMessages = starter.input;
  return fields;
}

/** How a starter's records reach the dataset — injected, so this file names no store and no backend. */
export interface StarterWriter {
  /** Create one record contained by `parentId`, and answer its id. */
  create(entity: string, fields: Record<string, unknown>, parentId: string): Promise<string>;
  /** Record that `nodeId` plays `name` in this space. */
  role(name: string, nodeId: string): Promise<void>;
}

const refName = (ref: string) => (ref.startsWith('$') ? ref.slice(1) : null);

/**
 * Write a starter's records and roles under the space collection, in the order listed.
 *
 * In order, so a record can only be contained by one written before it — which is also what makes a
 * cycle impossible to express. A record that fails is reported and skipped, and so is anything that
 * refers to it: the space already exists, and a starter that half-applied is better than a create
 * that threw away what somebody typed.
 *
 * Answers the roles written, by name.
 */
export async function applyStarterRecords(
  starter: SpaceStarter | undefined,
  rootId: string,
  writer: StarterWriter,
  report: (message: string, error?: unknown) => void = (message, error) => console.error(message, error),
): Promise<Record<string, string>> {
  const ids = new Map<string, string>([[refName(ROOT_REF)!, rootId]]);
  for (const record of starter?.records ?? []) {
    const container = refName(record.in ?? ROOT_REF);
    const parentId = container ? ids.get(container) : undefined;
    if (!parentId) {
      report(`space starter: ${record.entity} names a container that was not written (${record.in})`);
      continue;
    }
    try {
      const id = await writer.create(record.entity, { ...(record.fields ?? {}) }, parentId);
      if (record.$id) ids.set(record.$id, id);
    } catch (error) {
      report(`space starter: could not write ${record.entity}`, error);
    }
  }

  const roles: Record<string, string> = {};
  for (const [name, ref] of Object.entries(starter?.roles ?? {})) {
    const target = refName(ref);
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

/** What a starter may name, for checking one before it ships. */
export interface StarterVocabulary {
  /** Entity names the space's schema declares. */
  entities: ReadonlySet<string>;
  /** `Space` field names. */
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

  const defined = new Set<string>([refName(ROOT_REF)!]);
  (starter.records ?? []).forEach((record, index) => {
    const at = `records[${index}]`;
    if (!vocabulary.entities.has(record.entity)) problems.push(`${at}.entity is not in the manifest: ${record.entity}`);
    if (record.in !== undefined) {
      const container = refName(record.in);
      if (!container || !defined.has(container)) {
        problems.push(`${at}.in must name ${ROOT_REF} or an earlier record's $id: ${record.in}`);
      }
    }
    if (record.$id !== undefined) {
      if (defined.has(record.$id)) problems.push(`${at}.$id is used twice: ${record.$id}`);
      defined.add(record.$id);
    }
  });

  for (const [name, ref] of Object.entries(starter.roles ?? {})) {
    const target = refName(ref);
    if (!target || target === refName(ROOT_REF) || !defined.has(target)) {
      problems.push(`roles.${name} must name a record's $id: ${ref}`);
    }
  }
  return problems;
}
