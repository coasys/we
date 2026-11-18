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
 * Reading is the reverse. Structure comes from the SHACL. A closed value set, an abstract flag and a
 * single known parent are read from that structure when the shape carries no annotation for them.
 * Everything else comes from the annotations. Every function here is pure over links, so the round
 * trip is tested without an executor (`tests/shapeCodec.test.ts`).
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

import { toAd4mPredicate } from './containment';
import * as KnownEntities from './entities';

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
    const raw: unknown = Literal.fromUrl(target).get();
    return typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
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

type ShapedClass = {
  generateSHACL?: () => { shape?: { nodeShapeUri?: string; toJSON: () => { properties?: RawProperty[] } } };
};

/** Property JSON of a known generated class, keyed by field name. A missing class is not a parent we can prove. */
const parentProperties = new Map<string, Map<string, RawProperty> | null>();

function propertiesOf(parent: string): Map<string, RawProperty> | null {
  const cached = parentProperties.get(parent);
  if (cached !== undefined) return cached;
  const cls = (KnownEntities as Record<string, ShapedClass>)[parent];
  const list = cls?.generateSHACL?.().shape?.toJSON().properties;
  const props = list ? new Map(list.flatMap((prop) => (prop.name ? [[prop.name, prop] as const] : []))) : null;
  parentProperties.set(parent, props);
  return props;
}

/**
 * Class name for one shape URI, from the classes this package generates.
 *
 * The match is the URI the class actually emits. A suffix such as `Shape` is not a name, and two
 * classes that emit one URI resolve to neither — guessing would put the wrong parent on a save.
 */
let shapeOwners: Map<string, string | null> | undefined;

function entityForShapeUri(uri: string): string | undefined {
  if (!shapeOwners) {
    shapeOwners = new Map();
    for (const [name, value] of Object.entries(KnownEntities)) {
      if (typeof value !== 'function') continue;
      const owned = (value as ShapedClass).generateSHACL?.().shape?.nodeShapeUri;
      if (!owned) continue;
      shapeOwners.set(owned, shapeOwners.has(owned) ? null : name);
    }
  }
  const name = shapeOwners.get(uri);
  return name ? name : undefined;
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
  in?: unknown;
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

  const shape = SHACLShape.fromLinks(links as never, shapeUri);
  const json = shape.toJSON() as {
    target_class?: string;
    interpretation_hint?: string;
    properties: RawProperty[];
  };
  const name = (json.target_class ?? '').replace(/^we:\/\//, '');
  // The annotation wins when it is present, including when it disagrees with the native link.
  // A native parent is one URI that names a class this package generates — not a name cut out of the URI.
  const annotatedParent = value(shapeUri, ANNOTATION.extends);
  const parent =
    annotatedParent !== undefined
      ? typeof annotatedParent === 'string' && annotatedParent
        ? annotatedParent
        : undefined
      : shape.parentShapes.length === 1
        ? entityForShapeUri(shape.parentShapes[0])
        : undefined;

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
  const annotatedAbstract = value(shapeUri, ANNOTATION.abstract);
  if (annotatedAbstract !== undefined) entity.abstract = annotatedAbstract as EntitySchema['abstract'];
  else if (shape.isAbstract === true) entity.abstract = true;
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

  const parentProps = parent ? propertiesOf(parent) : null;
  for (const { raw } of declared) {
    const field = raw.name ?? '';
    const node = fields.get(field);
    // A field this shape declares carries `sh:order`. An inherited field does not, and it is left
    // out only when its structure is the parent's — a same-named override (its own predicate, its
    // own value set) stays, because the name alone does not make it the parent's field.
    const declaredHere = value(node, ANNOTATION.order) !== undefined;
    const parentProp = parentProps?.get(field);
    const inheritedIdentical = !declaredHere && parentProp !== undefined && sameDeclaration(raw, parentProp);
    if (!field || SDK_FIELDS.has(field) || inheritedIdentical) continue;
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
    // The annotation keeps the author's exact values, including a number beside a numeric string.
    // With no annotation, only a native `sh:in` this manifest can write back becomes `options`.
    const annotatedOptions = value(node, ANNOTATION.options);
    const options = annotatedOptions !== undefined ? annotatedOptions : recoverOptions(raw.in, type);
    entity.properties[field] = {
      type,
      predicate: raw.path,
      ...((raw.min_count ?? 0) >= 1 ? { required: true } : {}),
      ...(raw.resolve_language ? { format: 'file' as const } : {}),
      ...(raw.transform ? { readAs: 'dataUri' as const } : {}),
      ...(defaultLink !== undefined ? { default: decode(defaultLink) as string | number | boolean | null } : {}),
      ...(raw.interpretation_hint !== undefined ? { interpretationHint: raw.interpretation_hint } : {}),
      ...(raw.identity ? { identity: true } : {}),
      ...(options !== undefined ? { options: options as (string | number)[] } : {}),
      ...(value(node, ANNOTATION.vocabulary) !== undefined
        ? { vocabulary: value(node, ANNOTATION.vocabulary) as string }
        : {}),
      ...(control ? { control: control as never } : {}),
    };
  }

  if (whole !== undefined) entity.display = whole as EntitySchema['display'];
  else if (display.title || display.summary || display.media || keyFields.length) {
    if (keyFields.length) display.fields = keyFields.sort((a, b) => a.order - b.order).map((k) => k.field);
    entity.display = display;
  }

  const manifestVersion = value(shapeUri, ANNOTATION.manifestVersion);
  const text = (predicate: string) => {
    const held = value(shapeUri, predicate);
    return typeof held === 'string' ? held : '';
  };
  return {
    shapeUri,
    name,
    description: text(ANNOTATION.recordDescription),
    icon: text(ANNOTATION.icon),
    shapeId,
    version: Number(value(shapeUri, ANNOTATION.version) ?? 1),
    forkedFrom: text(ANNOTATION.forkedFrom),
    manifest: {
      version: typeof manifestVersion === 'string' ? manifestVersion : '1',
      entities: { [name]: entity },
    },
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
 * Whether a stored shape says nothing a save from WE would lose.
 *
 * The SDK's JSON is the structure (`fromLinks` then `toJSON`). A native `sh:in` or `sh:node` that
 * the parser drops — empty, malformed, duplicated — is still a constraint, so those links are
 * checked on the raw graph as well. A later caller that holds `{ shape, links }` can pass the
 * shape's JSON in place of the parse; the presence check stays on the links.
 *
 * Equality, not a subset. A stored value set that is only part of the rebuilt one is a narrowing a
 * save would widen, and `in: []` accepts nothing — it is not an absent constraint. The one
 * allowance is a WE shape whose options or parent annotation is already there and whose native
 * `sh://in` or `sh://node` was never written. Adding that link loses nothing. A missing
 * `ad4m://abstract`, an `auto_accept` link, or any other predicate the rebuild does not write is
 * not that allowance.
 */
export function sameShape(stored: readonly LinkLike[], rebuilt: readonly LinkLike[]): boolean {
  if (stored.some((link) => !writtenPredicate(rebuilt, link))) return false;
  const storedNotes = new Set(stored.filter(isAnnotation).map(linkKey));
  const rebuiltNotes = new Set(rebuilt.filter(isAnnotation).map(linkKey));
  if (![...storedNotes].every((key) => rebuiltNotes.has(key))) return false;
  return structuresMatch(stored, rebuilt);
}

function writtenPredicate(links: readonly LinkLike[], link: LinkLike): boolean {
  const key = `${link.source}\u0000${link.predicate ?? ''}`;
  return links.some((other) => `${other.source}\u0000${other.predicate ?? ''}` === key);
}

interface ShapeJson {
  parent_shapes?: string[];
  abstract?: boolean;
  properties?: RawProperty[];
  [key: string]: unknown;
}

function asShape(links: readonly LinkLike[]): ShapeJson {
  const { shapeUri } = nodesOf(links);
  return SHACLShape.fromLinks(links as never, shapeUri).toJSON() as ShapeJson;
}

function structuresMatch(storedLinks: readonly LinkLike[], rebuiltLinks: readonly LinkLike[]): boolean {
  const stored = asShape(storedLinks);
  const rebuilt = asShape(rebuiltLinks);
  if ((stored.abstract === true) !== (rebuilt.abstract === true)) return false;
  if (!parentsMatch(storedLinks, rebuiltLinks, stored.parent_shapes, rebuilt.parent_shapes)) return false;
  if (!propertiesMatch(storedLinks, rebuiltLinks, stored.properties ?? [], rebuilt.properties ?? [])) return false;
  const { properties: _sp, parent_shapes: _spa, abstract: _sa, ...storedRest } = stored;
  const { properties: _rp, parent_shapes: _rpa, abstract: _ra, ...rebuiltRest } = rebuilt;
  return deepEqual(storedRest, rebuiltRest);
}

/** Set equality of parent URIs. A missing `sh://node` is the legacy allowance, and only beside the same parent annotation. */
function parentsMatch(
  storedLinks: readonly LinkLike[],
  rebuiltLinks: readonly LinkLike[],
  storedParents: string[] | undefined,
  rebuiltParents: string[] | undefined,
): boolean {
  const storedSet = [...new Set(storedParents ?? [])].sort();
  const rebuiltSet = [...new Set(rebuiltParents ?? [])].sort();
  if (storedSet.length === rebuiltSet.length && storedSet.every((uri, i) => uri === rebuiltSet[i])) return true;
  const { shapeUri } = nodesOf(storedLinks);
  const raw = storedLinks.filter((link) => link.source === shapeUri && link.predicate === 'sh://node');
  if (raw.length !== 0 || storedSet.length !== 0 || rebuiltSet.length === 0) return false;
  return samePresentAnnotation(storedLinks, rebuiltLinks, ANNOTATION.extends);
}

function propertiesMatch(
  storedLinks: readonly LinkLike[],
  rebuiltLinks: readonly LinkLike[],
  storedProps: RawProperty[],
  rebuiltProps: RawProperty[],
): boolean {
  const index = (props: RawProperty[]) => {
    const map = new Map<string, RawProperty>();
    for (const prop of props) {
      if (!prop.name || !prop.path) return undefined;
      const key = `${prop.name}\u0000${prop.path}`;
      if (map.has(key)) return undefined;
      map.set(key, prop);
    }
    return map;
  };
  const stored = index(storedProps);
  const rebuilt = index(rebuiltProps);
  if (!stored || !rebuilt || stored.size !== rebuilt.size) return false;
  const nodes = nodesOf(storedLinks).fields;
  for (const [key, storedProp] of stored) {
    const rebuiltProp = rebuilt.get(key);
    if (!rebuiltProp) return false;
    if (!inMatch(storedLinks, rebuiltLinks, nodes.get(storedProp.name ?? ''), storedProp.in, rebuiltProp.in))
      return false;
    const { in: _si, ...storedRest } = storedProp;
    const { in: _ri, ...rebuiltRest } = rebuiltProp;
    if (!deepEqual(storedRest, rebuiltRest)) return false;
  }
  return true;
}

/**
 * The allowed-value sets are the same multiset, labels included, order ignored.
 * One malformed or repeated `sh://in` is not "no constraint". A missing one is the legacy
 * allowance only when both sides already carry the same `we://options` annotation.
 */
function inMatch(
  storedLinks: readonly LinkLike[],
  rebuiltLinks: readonly LinkLike[],
  node: string | undefined,
  storedIn: unknown,
  rebuiltIn: unknown,
): boolean {
  const raw = node ? storedLinks.filter((link) => link.source === node && link.predicate === 'sh://in') : [];
  if (raw.length > 1) return false;
  if (raw.length === 1 && !arrayTarget(raw[0].target)) return false;
  const storedSet = asArray(storedIn);
  const rebuiltSet = asArray(rebuiltIn);
  if (storedSet === 'bad' || rebuiltSet === 'bad') return false;
  if (storedSet === undefined && rebuiltSet !== undefined) {
    if (raw.length !== 0 || rebuiltSet.length === 0) return false;
    return samePresentAnnotation(storedLinks, rebuiltLinks, ANNOTATION.options);
  }
  return entryMultiset(storedSet) === entryMultiset(rebuiltSet);
}

function arrayTarget(target: string): boolean {
  if (!target.startsWith('literal:string:')) return false;
  try {
    return Array.isArray(JSON.parse(target.slice('literal:string:'.length)));
  } catch {
    return false;
  }
}

function asArray(value: unknown): unknown[] | undefined | 'bad' {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : 'bad';
}

/** Both sides carry the annotation, and carry the same one. Both absent does not count. */
function samePresentAnnotation(stored: readonly LinkLike[], rebuilt: readonly LinkLike[], predicate: string): boolean {
  const keys = (links: readonly LinkLike[]) =>
    links
      .filter((link) => link.predicate === predicate)
      .map(linkKey)
      .sort();
  const a = keys(stored);
  const b = keys(rebuilt);
  return a.length > 0 && a.length === b.length && a.every((key, i) => key === b[i]);
}

function entryMultiset(value: unknown): string | undefined {
  if (value === undefined) return '';
  if (!Array.isArray(value)) return undefined;
  const keys: string[] = [];
  for (const entry of value) {
    const key = entryKey(entry);
    if (key === undefined) return undefined;
    keys.push(key);
  }
  keys.sort();
  return keys.join('\n');
}

/** `{ value: 2 }` and `{ value: "2" }` are one entry. A label or any other key is part of the entry. */
function entryKey(entry: unknown): string | undefined {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
  const record = { ...(entry as Record<string, unknown>) };
  if (typeof record.value === 'number' && Number.isFinite(record.value)) record.value = String(record.value);
  else if (typeof record.value !== 'string') return undefined;
  return stable(record);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (a !== null && typeof a === 'object' && b !== null && typeof b === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      const av = left[key];
      const bv = right[key];
      if (av === undefined && bv === undefined) continue;
      if (av === undefined || bv === undefined || !deepEqual(av, bv)) return false;
    }
    return true;
  }
  return false;
}

/**
 * Structure worth comparing before an inherited field can be left out of the manifest.
 * A target class is not in this list: a child compiled without that class resolved omits it, and
 * a declared override is kept by its `sh:order` annotation rather than by this comparison.
 */
const STRUCTURE_KEYS = [
  'path',
  'datatype',
  'min_count',
  'max_count',
  'node_kind',
  'relation_kind',
  'collection',
  'ordering',
  'has_value',
  'identity',
  'resolve_language',
] as const;

function sameDeclaration(child: RawProperty, parent: RawProperty): boolean {
  for (const key of STRUCTURE_KEYS) {
    if ((child[key] ?? null) !== (parent[key] ?? null)) return false;
  }
  return entryMultiset(child.in) === entryMultiset(parent.in);
}

/**
 * Options a manifest can store for a native `sh:in`.
 * An exact numeric text on a number property comes back as a number (`"2"` → `2`). `"2.0"` stays
 * text, because turning it into `2` would make the next write emit a different value. Labels are
 * not part of the manifest value; the lossless check keeps the shape read-only while they are there.
 */
function recoverOptions(inn: unknown, type: string): (string | number)[] | undefined {
  if (!Array.isArray(inn) || inn.length === 0) return undefined;
  const options: (string | number)[] = [];
  for (const entry of inn) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const value = (entry as { value?: unknown }).value;
    if (typeof value !== 'string') return undefined;
    if (type === 'number') {
      const numeric = Number(value);
      options.push(value.trim() === value && Number.isFinite(numeric) && String(numeric) === value ? numeric : value);
    } else {
      options.push(value);
    }
  }
  return options;
}
