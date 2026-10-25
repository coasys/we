/**
 * A space's own model as AD4M keeps it — its SHACL, and nothing beside it — and back.
 *
 * Writing a model compiles its manifest into a class whose SHACL the executor stores (the same path a
 * module's entities take); this file adds the rest. SHACL holds a model's structure: its fields and
 * their paths, datatypes, counts, relations and their kinds, ordering, interpretation hints, identity.
 * What a manifest says beyond that — a default, closed options, the control a form uses, the field a
 * card is titled by, the model's parent, the record's own metadata — is written as **annotation links**
 * on the same nodes the SHACL lives on: the shape's node, and each field's property shape. Standard
 * predicates where one exists (SHACL's non-validating properties, DASH for forms, RDFS, OWL, PROV,
 * Dublin Core), `we://` only for what has none. The executor ignores them; they are ordinary links, so
 * they sync and are governed like the rest of the shape.
 *
 * Reading is the reverse: structure from the SHACL, everything else from the annotations, into the
 * manifest that was saved. Every function here is pure over links, so the round trip is tested
 * without an executor (`tests/shapeCodec.test.ts`).
 *
 * ## What reading cannot get back, and how it says so
 *
 * A shape somebody else wrote — or wrote to — can hold more than a manifest can say. `editable`
 * answers that the way a stored workflow's does: compile what was read back, annotate it again, and
 * compare link for link with what is stored. Anything left over is something saving from WE would
 * drop.
 */
import { Literal, SHACLShape } from '@coasys/ad4m';
import { CONTAINMENT_PREDICATE, type EntityManifest, type EntitySchema, type ShapeInput } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';

import { toAd4mPredicate } from './containment';

/** A link as the codec reads and writes one: what the SDK's `toLinks()` and a perspective both give. */
export interface LinkLike {
  source: string;
  predicate?: string;
  target: string;
}

const SH = 'http://www.w3.org/ns/shacl#';
const DASH = 'http://datashapes.org/dash#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const PROV = 'http://www.w3.org/ns/prov#';
const DCT = 'http://purl.org/dc/terms/';

/** The predicates this file writes, and therefore the only ones it ever replaces or removes. */
export const ANNOTATION = {
  // On the shape's node: the record.
  shapeId: `${DCT}identifier`,
  recordDescription: `${DCT}description`,
  icon: 'we://icon',
  version: `${OWL}versionInfo`,
  forkedFrom: `${PROV}wasDerivedFrom`,
  // On the shape's node: the entity.
  manifestVersion: 'we://manifest_version',
  description: `${RDFS}comment`,
  extends: `${RDFS}subClassOf`,
  abstract: `${DASH}abstract`,
  extractable: 'we://extractable',
  blockable: 'we://blockable',
  composed: 'we://composed',
  authoring: 'we://authoring',
  /** A card's display, where the roles below cannot say it — see `displayByRoles`. */
  display: 'we://display',
  // On a field's property shape.
  default: `${SH}defaultValue`,
  type: 'we://type',
  options: 'we://options',
  vocabulary: 'we://vocabulary',
  editor: `${DASH}editor`,
  control: 'we://control',
  role: `${DASH}propertyRole`,
  /** Where a field or relation was declared among the rest — SHACL's own meaning for it. */
  order: `${SH}order`,
  /** Where one of a card's key fields sits among the others. Apart from `order`, which a field already has. */
  displayOrder: 'we://display_order',
  target: 'we://target',
  reverseOf: 'we://reverse_of',
  polymorphic: 'we://polymorphic',
  composite: `${DASH}composite`,
  /** The predicate a containment relation spelled out, where it did — containment's own name otherwise. */
  containmentPredicate: 'we://containment_predicate',
} as const;

const ANNOTATION_PREDICATES: ReadonlySet<string> = new Set(Object.values(ANNOTATION));

/** Whether a link is one this file owns. */
export const isAnnotation = (link: LinkLike): boolean => ANNOTATION_PREDICATES.has(link.predicate ?? '');

/** A form control with a DASH editor of its own; the others are minted. */
const EDITORS: Record<string, string> = {
  textarea: `${DASH}TextAreaEditor`,
  date: `${DASH}DatePickerEditor`,
  datetime: `${DASH}DateTimePickerEditor`,
  url: `${DASH}URIEditor`,
};
const CONTROL_OF_EDITOR = Object.fromEntries(Object.entries(EDITORS).map(([control, editor]) => [editor, control]));

/** Which DASH property role each of a card's display slots is. */
const ROLES = {
  title: `${DASH}LabelRole`,
  summary: `${DASH}DescriptionRole`,
  media: `${DASH}DepictionRole`,
  fields: `${DASH}KeyInfoRole`,
} as const;

const encode = (value: unknown): string => Literal.from(JSON.stringify(value)).toUrl();
const decode = (target: string): unknown => {
  try {
    const raw = Literal.fromUrl(target).get();
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return undefined;
  }
};

/** The entity a model's manifest declares — one per space shape. */
function entityOf(manifest: EntityManifest): [string, EntitySchema] {
  const entries = Object.entries(manifest.entities);
  if (entries.length !== 1) throw new Error('shapes: a space shape declares exactly one entity');
  return entries[0];
}

/** The shape's node and each field's property shape, by field name, as the SHACL links name them. */
function nodesOf(links: readonly LinkLike[]): { shapeUri: string; fields: Map<string, string> } {
  const shapeUri = links.find((l) => l.predicate === 'rdf://type' && l.target === 'sh://NodeShape')?.source;
  if (!shapeUri) throw new Error('shapes: no node shape among these links');
  const fields = new Map<string, string>();
  for (const link of links) {
    if (link.source !== shapeUri || link.predicate !== 'sh://property') continue;
    // A property shape is named `<class>.<field>` — the field is everything after the last dot.
    const name = link.target.slice(link.target.lastIndexOf('.') + 1);
    fields.set(name, link.target);
  }
  return { shapeUri, fields };
}

/**
 * The display, as property roles on its fields — or `null` when roles cannot say it. A field takes
 * one role, so a field that is both a card's title and one of its key fields, say, cannot; the whole
 * display is then kept as one annotation on the shape instead.
 */
function displayByRoles(
  display: NonNullable<EntitySchema['display']>,
): Map<string, { role: string; order?: number }> | null {
  const byField = new Map<string, { role: string; order?: number }>();
  const claim = (field: string | undefined, role: string, order?: number) => {
    if (!field) return true;
    if (byField.has(field)) return false;
    byField.set(field, { role, ...(order !== undefined ? { order } : {}) });
    return true;
  };
  const ok =
    claim(display.title, ROLES.title) &&
    claim(display.summary, ROLES.summary) &&
    claim(display.media, ROLES.media) &&
    (display.fields ?? []).every((field, i) => claim(field, ROLES.fields, i));
  return ok ? byField : null;
}

/**
 * The annotation links for a model, on the nodes its compiled SHACL (`shapeLinks`) names.
 *
 * Only what the SHACL cannot already say, and only what the manifest says: a field with no default
 * gets no default link, so reading back cannot invent one.
 */
export function annotationLinks(shape: ShapeInput, shapeLinks: readonly LinkLike[]): LinkLike[] {
  const [, entity] = entityOf(shape.manifest);
  const { shapeUri, fields } = nodesOf(shapeLinks);
  const out: LinkLike[] = [];
  const on = (source: string | undefined, predicate: string, target: string) => {
    if (source) out.push({ source, predicate, target });
  };

  on(shapeUri, ANNOTATION.shapeId, encode(shape.shapeId));
  on(shapeUri, ANNOTATION.recordDescription, encode(shape.description));
  on(shapeUri, ANNOTATION.icon, encode(shape.icon));
  on(shapeUri, ANNOTATION.version, encode(shape.version));
  if (shape.forkedFrom) on(shapeUri, ANNOTATION.forkedFrom, encode(shape.forkedFrom));
  on(shapeUri, ANNOTATION.manifestVersion, encode(shape.manifest.version));
  if (entity.description !== undefined) on(shapeUri, ANNOTATION.description, encode(entity.description));
  if (entity.extends) on(shapeUri, ANNOTATION.extends, encode(entity.extends));
  if (entity.abstract !== undefined) on(shapeUri, ANNOTATION.abstract, encode(entity.abstract));
  if (entity.extractable !== undefined) on(shapeUri, ANNOTATION.extractable, encode(entity.extractable));
  if (entity.blockable !== undefined) on(shapeUri, ANNOTATION.blockable, encode(entity.blockable));
  if (entity.composed !== undefined) on(shapeUri, ANNOTATION.composed, encode(entity.composed));
  if (entity.authoring !== undefined) on(shapeUri, ANNOTATION.authoring, encode(entity.authoring));

  if (entity.display !== undefined) {
    const roles = displayByRoles(entity.display);
    if (roles && [...roles.keys()].every((field) => fields.has(field))) {
      for (const [field, { role, order }] of roles) {
        on(fields.get(field), ANNOTATION.role, role);
        if (order !== undefined) on(fields.get(field), ANNOTATION.displayOrder, encode(order));
      }
    } else {
      on(shapeUri, ANNOTATION.display, encode(entity.display));
    }
  }

  /*
    The order the fields were declared in. Nothing else holds it: an executor lists a shape's
    property shapes in its own order, and a model read back in another one changed what it guesses
    names a record (the first text field) and the order every form asks in.
  */
  [...Object.keys(entity.properties), ...Object.keys(entity.relations)].forEach((name, i) =>
    on(fields.get(name), ANNOTATION.order, encode(i)),
  );

  for (const [name, spec] of Object.entries(entity.properties)) {
    const node = fields.get(name);
    if ('default' in spec) on(node, ANNOTATION.default, encode(spec.default));
    // The compiler stores only string, number and boolean; anything else (a date-time, JSON) is
    // stored as a string and named here.
    if (!SHACL_TYPES.has(spec.type)) on(node, ANNOTATION.type, encode(spec.type));
    if (spec.options !== undefined) on(node, ANNOTATION.options, encode(spec.options));
    if (spec.vocabulary !== undefined) on(node, ANNOTATION.vocabulary, encode(spec.vocabulary));
    if (spec.control !== undefined) {
      if (EDITORS[spec.control]) on(node, ANNOTATION.editor, EDITORS[spec.control]);
      else on(node, ANNOTATION.control, encode(spec.control));
    }
  }
  for (const [name, spec] of Object.entries(entity.relations)) {
    const node = fields.get(name);
    on(node, ANNOTATION.target, encode(spec.target));
    if (spec.reverseOf !== undefined) on(node, ANNOTATION.reverseOf, encode(spec.reverseOf));
    if (spec.polymorphic !== undefined) on(node, ANNOTATION.polymorphic, encode(spec.polymorphic));
    if (spec.containment !== undefined) on(node, ANNOTATION.composite, encode(spec.containment));
    if (spec.containment && spec.predicate !== undefined)
      on(node, ANNOTATION.containmentPredicate, encode(spec.predicate));
  }
  return out;
}

/** The field types SHACL carries itself; any other is annotated. */
const SHACL_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'boolean']);

/** Where this backend stores containment, whatever the manifest calls it. */
const CONTAINMENT_PATH = toAd4mPredicate(CONTAINMENT_PREDICATE);

/** A field's type as SHACL alone says it, before any `we://type` annotation corrects it. */
function inferredType(datatype: string | undefined): 'string' | 'number' | 'boolean' {
  if (datatype === 'xsd://decimal' || datatype === 'xsd://integer' || datatype === 'xsd://double') return 'number';
  if (datatype === 'xsd://boolean') return 'boolean';
  return 'string';
}

/** Every field `parent` declares, its own parents' included — what an entity extending it inherits. */
function inheritedFields(parent: string | undefined): Set<string> {
  const names = new Set<string>();
  for (let name = parent; name;) {
    const schema = CORE_MANIFEST.entities[name];
    if (!schema) break;
    for (const field of [...Object.keys(schema.properties), ...Object.keys(schema.relations)]) names.add(field);
    name = schema.extends;
  }
  return names;
}

/** Fields the SDK adds to every shape of its own accord: the type flag, and an ordered collection's index. */
const SDK_FIELDS = new Set(['flag', '_collectionOrder']);

interface RawProperty {
  name?: string;
  path: string;
  datatype?: string;
  min_count?: number;
  max_count?: number;
  has_value?: string;
  node_kind?: string;
  relation_kind?: string;
  collection?: boolean;
  ordering?: string;
  resolve_language?: string;
  transform?: unknown;
  interpretation_hint?: string;
  identity?: boolean;
  target_class_name?: string;
}

/** What a stored shape reads back as, before `editable` is judged. */
export interface ReadShape {
  shapeUri: string;
  name: string;
  description: string;
  icon: string;
  shapeId: string;
  version: number;
  forkedFrom: string;
  manifest: EntityManifest;
}

/**
 * A stored shape read back: its structure from the SHACL, the rest from its annotations. `links` are
 * every link sourced at the shape's node and at its property shapes. `null` when they hold no shape
 * WE wrote — one without a `shapeId` is somebody else's.
 */
export function readShape(links: readonly LinkLike[]): ReadShape | null {
  const { shapeUri, fields } = nodesOf(links);
  const at = (source: string | undefined, predicate: string) =>
    source ? links.find((l) => l.source === source && l.predicate === predicate)?.target : undefined;
  const value = (source: string | undefined, predicate: string) => {
    const target = at(source, predicate);
    return target === undefined ? undefined : decode(target);
  };

  const shapeId = value(shapeUri, ANNOTATION.shapeId);
  if (typeof shapeId !== 'string' || !shapeId) return null;

  const json = SHACLShape.fromLinks(links as never, shapeUri).toJSON() as {
    target_class?: string;
    interpretation_hint?: string;
    properties: RawProperty[];
  };
  const name = (json.target_class ?? '').replace(/^we:\/\//, '');
  const parent = value(shapeUri, ANNOTATION.extends) as string | undefined;
  const inherited = inheritedFields(parent);

  const entity: EntitySchema = { properties: {}, relations: {} };
  if (parent) entity.extends = parent;
  const flag = json.properties.find((p) => p.name === 'flag' && p.has_value);
  if (flag?.has_value) entity.flag = { predicate: flag.path, value: flag.has_value };
  if (json.interpretation_hint !== undefined) entity.interpretationHint = json.interpretation_hint;
  const set = <K extends keyof EntitySchema>(key: K, predicate: string) => {
    const v = value(shapeUri, predicate);
    if (v !== undefined) entity[key] = v as EntitySchema[K];
  };
  set('description', ANNOTATION.description);
  set('abstract', ANNOTATION.abstract);
  set('extractable', ANNOTATION.extractable);
  set('blockable', ANNOTATION.blockable);
  set('composed', ANNOTATION.composed);
  set('authoring', ANNOTATION.authoring);

  // A card's display: kept whole on the shape, or spread over its fields as roles.
  const whole = value(shapeUri, ANNOTATION.display);
  const display: NonNullable<EntitySchema['display']> = {};
  const keyFields: { field: string; order: number }[] = [];

  // In the order they were declared; one with no position (a field another tool added) after those.
  const position = (raw: RawProperty) => {
    const at = Number(value(fields.get(raw.name ?? ''), ANNOTATION.order));
    return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
  };
  const declared = json.properties
    .map((raw, i) => ({ raw, i }))
    .sort((a, b) => position(a.raw) - position(b.raw) || a.i - b.i);

  for (const { raw } of declared) {
    const field = raw.name ?? '';
    if (!field || SDK_FIELDS.has(field) || inherited.has(field)) continue;
    const node = fields.get(field);
    const role = at(node, ANNOTATION.role);
    if (role === ROLES.title) display.title = field;
    else if (role === ROLES.summary) display.summary = field;
    else if (role === ROLES.media) display.media = field;
    else if (role === ROLES.fields) keyFields.push({ field, order: Number(value(node, ANNOTATION.displayOrder) ?? 0) });

    const isRelation = raw.node_kind === 'IRI' || Boolean(raw.relation_kind) || Boolean(raw.collection);
    if (isRelation) {
      const containment = value(node, ANNOTATION.composite);
      const target = value(node, ANNOTATION.target);
      entity.relations[field] = {
        target: typeof target === 'string' ? target : (raw.target_class_name ?? ''),
        cardinality: raw.collection ? 'many' : 'one',
        // Containment has one name on every backend, which a manifest does not spell out — see
        // `RelationSchema.containment`. Stored, it is this backend's containment predicate.
        ...(containment === true
          ? {
              containment: true,
              ...(value(node, ANNOTATION.containmentPredicate) !== undefined
                ? { predicate: value(node, ANNOTATION.containmentPredicate) as string }
                : {}),
            }
          : { predicate: raw.path === CONTAINMENT_PATH ? CONTAINMENT_PREDICATE : raw.path }),
        ...(raw.ordering ? { ordered: true } : {}),
        ...(value(node, ANNOTATION.reverseOf) !== undefined
          ? { reverseOf: value(node, ANNOTATION.reverseOf) as string }
          : {}),
        ...(value(node, ANNOTATION.polymorphic) !== undefined
          ? { polymorphic: value(node, ANNOTATION.polymorphic) as boolean }
          : {}),
        ...(raw.interpretation_hint !== undefined ? { interpretationHint: raw.interpretation_hint } : {}),
      };
      continue;
    }
    const type =
      (value(node, ANNOTATION.type) as EntitySchema['properties'][string]['type'] | undefined) ??
      inferredType(raw.datatype);
    const editor = at(node, ANNOTATION.editor);
    const control = editor ? CONTROL_OF_EDITOR[editor] : (value(node, ANNOTATION.control) as string | undefined);
    const defaultLink = at(node, ANNOTATION.default);
    entity.properties[field] = {
      type,
      predicate: raw.path,
      ...((raw.min_count ?? 0) >= 1 ? { required: true } : {}),
      ...(raw.resolve_language ? { format: 'file' as const } : {}),
      ...(raw.transform ? { readAs: 'dataUri' as const } : {}),
      ...(defaultLink !== undefined ? { default: decode(defaultLink) as string | number | boolean | null } : {}),
      ...(raw.interpretation_hint !== undefined ? { interpretationHint: raw.interpretation_hint } : {}),
      ...(raw.identity ? { identity: true } : {}),
      ...(value(node, ANNOTATION.options) !== undefined
        ? { options: value(node, ANNOTATION.options) as (string | number)[] }
        : {}),
      ...(value(node, ANNOTATION.vocabulary) !== undefined
        ? { vocabulary: value(node, ANNOTATION.vocabulary) as string }
        : {}),
      ...(control ? { control: control as never } : {}),
    } as EntitySchema['properties'][string];
  }

  if (whole !== undefined) entity.display = whole as EntitySchema['display'];
  else if (display.title || display.summary || display.media || keyFields.length) {
    if (keyFields.length) display.fields = keyFields.sort((a, b) => a.order - b.order).map((k) => k.field);
    entity.display = display;
  }

  const manifestVersion = value(shapeUri, ANNOTATION.manifestVersion);
  return {
    shapeUri,
    name,
    description: String(value(shapeUri, ANNOTATION.recordDescription) ?? ''),
    icon: String(value(shapeUri, ANNOTATION.icon) ?? ''),
    shapeId,
    version: Number(value(shapeUri, ANNOTATION.version) ?? 1),
    forkedFrom: String(value(shapeUri, ANNOTATION.forkedFrom) ?? ''),
    manifest: {
      version: typeof manifestVersion === 'string' ? manifestVersion : '1',
      entities: { [name]: entity },
    } as EntityManifest,
  };
}

/** A link's identity for comparison, literal targets decoded — see `keyOf` in the workflow port. */
export function linkKey(link: LinkLike): string {
  let target = link.target;
  if (target.startsWith('literal:')) {
    try {
      target = decodeURIComponent(target);
    } catch {
      // Not percent-encoded after all; compare as stored.
    }
  }
  return `${link.source}\u0000${link.predicate ?? ''}\u0000${target}`;
}

/**
 * Whether a stored shape says exactly what its manifest can hold: rebuilt from the manifest read back
 * — compiled, and annotated again — it reads the same as what is stored.
 *
 * Compared as the SDK reads a shape (`fromLinks`) rather than link for link, because the executor
 * writes a shape's links itself from its JSON, and how it spells them is its own business; plus the
 * annotations, link for link, since those are this file's. A field, a constraint or an annotation
 * nothing here writes makes the two differ.
 */
export function sameShape(stored: readonly LinkLike[], rebuilt: readonly LinkLike[]): boolean {
  /*
    As the SDK reads it, with the property shapes in one order: an executor lists them in its own,
    and the same shape read in two orders is the same shape. Order is what `sh:order` says, and that
    is an annotation, compared below.
  */
  const asRead = (links: readonly LinkLike[]) => {
    const { shapeUri } = nodesOf(links);
    const json = SHACLShape.fromLinks(links as never, shapeUri).toJSON() as {
      properties?: { path?: string; name?: string }[];
    };
    // By path, then name: several relations can share one path (containment's).
    const key = (p: { path?: string; name?: string }) => `${p.path ?? ''}\u0000${p.name ?? ''}`;
    const properties = [...(json.properties ?? [])].sort((x, y) => key(x).localeCompare(key(y)));
    return JSON.stringify(sortKeys({ ...json, properties }));
  };
  const annotations = (links: readonly LinkLike[]) => new Set(links.filter(isAnnotation).map(linkKey));
  const a = annotations(stored);
  const b = annotations(rebuilt);
  return asRead(stored) === asRead(rebuilt) && a.size === b.size && [...a].every((key) => b.has(key));
}

/** A JSON value with every object's keys in one order, so two readings compare as text. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}
