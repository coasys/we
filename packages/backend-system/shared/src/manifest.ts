/**
 * The model manifest — a backend-neutral description of the entities a template can query: their
 * scalar properties and their typed relations. This is the vocabulary in machine-readable form, and
 * what the query IR is validated and compiled against (`include` needs to know a relation's target
 * and cardinality; filter/sort need to know a property's type).
 *
 * It is a *separate* artifact from any query and from any backend. A third-party host authors a
 * manifest for its own entities; the AD4M adapter produces one from its own models.
 *
 * Relationship to the AD4M-specific manifest (`EntityManifestEntry` in `@we/app-shell`): that one
 * is the AD4M adapter's richer, flatter form — properties and relations in one list, plus RDF
 * binding (`predicate`, `resolveLanguage`, `targetClass`). This neutral form is the semantic
 * projection it maps onto: scalars vs relations separated, keyed by name, no backend binding. The
 * adapter keeps its RDF binding on its side; only this shape crosses into the schema engine.
 */
import { z } from 'zod';

export type ScalarType = 'string' | 'number' | 'boolean' | 'datetime' | 'json';
export type Cardinality = 'one' | 'many';

export interface PropertySchema {
  type: ScalarType;
  required?: boolean;
  /**
   * How the value is *stored*, when that differs from an inline scalar. `'file'` means the
   * property holds binary content written through the host's file storage. Every backend has this
   * problem and solves it differently — AD4M stores an expression through its file-storage
   * language, a SQL host would keep a URL beside a blob store — so the manifest names the intent
   * and each adapter supplies the mechanism.
   */
  format?: 'file';

  /**
   * How a file property reads back. `'dataUri'` means callers get something directly renderable
   * (an `<img src>`), rather than a reference they must fetch themselves.
   *
   * The distinction is load-bearing rather than cosmetic: WE stores avatars and image blocks one
   * way (read as data URIs) and stored templates, themes and editor state the other (read raw,
   * decoded by the caller). A single `format: 'file'` cannot express both, and guessing from the
   * property name would be exactly the kind of silent binding this manifest exists to avoid.
   */
  readAs?: 'dataUri';

  /**
   * Value a new instance starts with, and what an adapter writes when the property is required but
   * unset. Declared because it is part of what the entity *is* — a signal type whose range starts
   * at 1, a task that starts `todo` — and would otherwise be lost the moment the definition stops
   * being a hand-written class with field initialisers.
   */
  default?: string | number | boolean | null;

  /**
   * Bind this property to an existing predicate instead of minting one.
   *
   * Core entities need it: their vocabulary (`we://name`, `we://uuid`) predates any minting rule
   * and is how all existing data is found. Modules should rarely use it — minting inside their own
   * subtree is the default precisely so nothing is shared by accident.
   */
  predicate?: string;

  /**
   * What an LLM is told about this property when the entity is an interpretation/extraction
   * target. Prompt payload, not documentation (see TaskBlock's rationale in `@we/entities`): the two
   * things it must carry that the type cannot are closed vocabularies and exact value formats.
   * Declared here so a hint survives the definition being data rather than a decorated class —
   * without this field, the one path that makes an entity *declarable* was also the one path that
   * silently dropped its hints.
   */
  interpretationHint?: string;

  /**
   * Marks this property as the entity's dedup key for interpretation. Its presence is what admits
   * the entity to the "instances that already exist" prompt block at all — an entity declaring no
   * identity property is never shown its existing instances, so every extraction pass duplicates.
   * At most one property per entity may carry it.
   */
  identity?: boolean;

  /**
   * Closed set of allowed values, for a property whose vocabulary is fixed ("todo" | "in-progress"
   * | "done"). Manifest-level metadata: derived forms render it as a select, and authoring surfaces
   * fold it into interpretation hints. Backends do not enforce it (v1) — the stored value remains
   * the scalar type.
   */
  options?: (string | number)[];

  /**
   * Which control a derived form should offer, where the scalar type does not say.
   *
   * The sibling of `options`, and here for the same reason: a form generated from a manifest can
   * infer a select from a closed vocabulary and a switch from a boolean, and then has nothing to go
   * on for the cases where one storage type covers several kinds of value. `TaskBlock.dueDate` and
   * `EventBlock.startDate` are both `string`, and their interpretation hints spend a sentence each
   * saying they are a date in one format and a datetime in another — a fact the schema was carrying
   * only in prose aimed at a language model.
   *
   * Presentation, not storage — `format` is the storage counterpart and stays about where bytes
   * live. Absent means "whatever the type implies", which is right for most properties.
   */
  control?: 'textarea' | 'date' | 'datetime' | 'color' | 'url';
}

export interface RelationSchema {
  /**
   * Target entity name — must be a key in `EntityManifest.entities`, or empty for an untyped
   * reference (a relation that links to whatever, like a node's comments).
   */
  target: string;
  cardinality: Cardinality;
  /** Name of the inverse relation on the target entity (enables reverse-relation queries). */
  reverseOf?: string;
  /** Bind to an existing predicate instead of minting one — see `PropertySchema.predicate`. */
  predicate?: string;
}

export interface EntitySchema {
  /** Scalar fields, keyed by property name. */
  properties: Record<string, PropertySchema>;
  /** Typed edges, keyed by relation name. */
  relations: Record<string, RelationSchema>;

  /**
   * How instances of this entity are told apart from everything else in the same dataset.
   *
   * Backends that store entities in their own container (a SQL table) can ignore it; graph
   * backends need a marker, and WE's is a fixed predicate/value pair written on every instance.
   * Declared rather than derived because the value is part of the vocabulary — `we://space` is
   * not something a compiler should invent.
   */
  flag?: { predicate: string; value: string };

  /**
   * Name of an entity whose properties, relations and flag this one also has.
   *
   * WE's content entities all extend a common node — comments and signals attach to anything —
   * and repeating that on twenty-odd entities would be the kind of duplication that drifts.
   */
  extends?: string;

  /**
   * A base entity: extended by others, never stored in its own right.
   *
   * It gets no type marker, because nothing is ever *of* this type — every instance is one of its
   * subtypes, and marking them as the base as well would make a query for the base return
   * everything.
   */
  abstract?: boolean;

  /**
   * What an LLM is told this entity *is* when it is an interpretation/extraction target — the
   * class-level counterpart of `PropertySchema.interpretationHint`.
   */
  interpretationHint?: string;

  /**
   * An LLM may mint instances of this entity from what people said.
   *
   * The declaration that makes extraction targets *data*. It was a constant in one module —
   * `EXTRACT_CLASSES = ['TaskBlock', 'EventBlock']` — which meant a community could define a
   * `Sighting`, write careful hints for it, and never have anything extract one: the hints were
   * stored, synced and editable, and nothing read them.
   *
   * ## Why it is opt-in, and why the flag has to be explicit
   *
   * Every selected entity puts its **whole shape** into the prompt, every property hinted or not,
   * so the target list is the cost *and* the quality control — a longer one is slower, dearer and
   * vaguer rather than more capable. `TextBlock` is the case that makes this concrete: it is what a
   * transcript is made of, and most of its shape is serialization (`indent`, `textFormat`,
   * `listType`), so offering it is offering a model a dozen fields it can only fill with noise.
   * And a model somebody curates by hand should not have an interpreter minting rows into it,
   * which is a decision only its author can make.
   *
   * Deriving it instead from "carries an interpretationHint" does not work and was tried on paper:
   * `Relationship` carries hints — it is a *target* of hint-driven work, not of extraction — so the
   * derivation admits exactly the entity that must never be admitted.
   *
   * ## Where it does not belong
   *
   * Not a property of the `Shape` record. That record is metadata *about* a definition document;
   * this is a fact about the entity, so it lives beside `interpretationHint` in the document
   * itself — which also means it travels with a shape that is copied or forked, as a record
   * property would not.
   *
   * ## What it does not decide
   *
   * Whether a *pass* targets it. The space's declared targets are the default set; a call may
   * narrow that (see the transcribe module), and a space may switch auto-extraction off entirely.
   * This says only that the entity is eligible.
   *
   * Absent means no, which is the right default: an entity becomes an extraction target by
   * somebody deciding it should be one.
   */
  extractable?: boolean;

  /**
   * A person can author one of these inline, as a unit of content inside a composed document.
   *
   * ## Why this is a flag and not a second kind of thing
   *
   * "Entity" and "block" read as alternatives — they were two sibling directories in `@we/entities`
   * for a long time — but the manifest has only ever had one map, and every block is in it. A block
   * is not a different sort of declaration; it is an entity that answers yes to one extra question:
   * *can somebody make one of these fresh, inline, while writing a document?* `TaskBlock` says yes
   * and is also perfectly usable standalone on a board; `Space` says no, because creating one has
   * infrastructure consequences that inline authoring cannot carry.
   *
   * Expressing that as a flag rather than a folder is what lets the rule below be checked. It also
   * stops the vocabulary implying a split that the data never had.
   *
   * ## What it obliges
   *
   * A `version`, checked by {@link validateManifest}. Blocks are edited collaboratively inside a
   * document, so conflict resolution needs a counter to compare; entities that are not composed
   * are written by one owner at a time and need none. That rule predates this flag — it was prose
   * in CONVENTIONS.md that nothing enforced, and the folder it keyed off could not enforce it.
   *
   * ## What it does not decide
   *
   * Whether the block editor can *render* one. That needs Display and Input components, registered
   * through `registerBlock()` in `@we/block-shared`. This flag is the data half of the same fact,
   * and the two are deliberately separate: a backend reading the manifest learns which entities are
   * composable without having to load any UI at all.
   */
  blockable?: boolean;

  /**
   * A person can create one of these by hand, filling in these fields in this order.
   *
   * Two facts in one, because they are the same fact. Most entities are not hand-authored at all —
   * `Template`, `AgentSettings`, `ReadMarker` are written by the app, and `TextBlock` and
   * `DividerBlock` exist only inside a composed document — so a surface offering "create a…" needs
   * to know which of the two dozen names in the manifest are things anybody would want. And of an
   * entity that *is* authorable, only some properties are the author's: `version` is bookkeeping
   * and `occurrence` is derived, and a generated form that showed them would ask a person to fill
   * in the implementation.
   *
   * Naming the fields rather than flagging the ones to hide also fixes their order, which a form
   * needs and a property record does not reliably carry.
   *
   * Absent means "not authored by hand", which is the right default: an entity gains a form by
   * someone deciding it should have one. Entities a *community* defines are the other way round —
   * every property of a shape somebody wrote is theirs by construction, so those need no
   * declaration and never carry one.
   */
  authoring?: { fields: string[] };

  /**
   * How an instance of this entity is shown when nothing was written to show it — the read-side
   * counterpart of `authoring`.
   *
   * A content type today is a model and two components, and the components are the only reason it
   * cannot arrive from a stranger. This is the half that lets a display be *derived* from the
   * declaration, the way `authoring` lets a form be: which property is the title, which is the
   * one-line summary, which holds the picture, and which fields are worth listing, in order.
   *
   * Every part is optional and the derivation guesses without it — the first required string is
   * the title, a `format: 'file'` string the media, `authoring.fields` the list. Declare it where
   * the guess is wrong, which is exactly what `control` is for on a property.
   */
  display?: {
    /** Property that names the instance. */
    title?: string;
    /** Property shown beneath the title, one line. */
    summary?: string;
    /** Property holding the picture or file to show. */
    media?: string;
    /** Properties to list, in order. Defaults to `authoring.fields`, else every property. */
    fields?: string[];
  };
}

export interface EntityManifest {
  version: string;
  /** Entities keyed by name (the key IS the entity name). */
  entities: Record<string, EntitySchema>;
}

// ─── Zod schema (structural validation) ────────────────────────────────────────

const scalarType = z.enum(['string', 'number', 'boolean', 'datetime', 'json']);
const cardinality = z.enum(['one', 'many']);

const propertySchema = z.object({
  type: scalarType,
  required: z.boolean().optional(),
  format: z.literal('file').optional(),
  readAs: z.literal('dataUri').optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  predicate: z.string().optional(),
  interpretationHint: z.string().optional(),
  identity: z.boolean().optional(),
  options: z.array(z.union([z.string(), z.number()])).optional(),
  control: z.enum(['textarea', 'date', 'datetime', 'color', 'url']).optional(),
});
const relationSchema = z.object({
  target: z.string(),
  cardinality,
  reverseOf: z.string().optional(),
  predicate: z.string().optional(),
});
const entitySchema = z.object({
  properties: z.record(z.string(), propertySchema),
  relations: z.record(z.string(), relationSchema),
  flag: z.object({ predicate: z.string(), value: z.string() }).optional(),
  extends: z.string().optional(),
  abstract: z.boolean().optional(),
  interpretationHint: z.string().optional(),
  extractable: z.boolean().optional(),
  blockable: z.boolean().optional(),
  authoring: z.object({ fields: z.array(z.string()) }).optional(),
  display: z
    .object({
      title: z.string().optional(),
      summary: z.string().optional(),
      media: z.string().optional(),
      fields: z.array(z.string()).optional(),
    })
    .optional(),
});

export const modelManifestSchema = z.object({
  version: z.string(),
  entities: z.record(z.string(), entitySchema),
});

// ─── Validation (structure + referential integrity) ────────────────────────────

export interface ManifestError {
  path: string;
  message: string;
}

/**
 * Validate a manifest: structure (via Zod) plus referential integrity that Zod can't express —
 * every relation `target` names a real entity, and every `reverseOf` names a real relation on that
 * target. Returns the typed manifest when valid.
 *
 * `opts.externalEntities` names entities defined *outside* this manifest that targets and
 * `extends` may legitimately reference — a space shape relating to `LocationBlock` (core
 * vocabulary) or to a sibling shape stored separately. `reverseOf` cannot be checked against an
 * external target (its relations are not in view), so it is refused there rather than guessed at.
 */
export function validateManifest(
  input: unknown,
  opts?: { externalEntities?: Iterable<string> },
): { valid: true; manifest: EntityManifest } | { valid: false; errors: ManifestError[] } {
  const parsed = modelManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  const manifest = parsed.data as EntityManifest;
  const errors: ManifestError[] = [];
  const entityNames = new Set(Object.keys(manifest.entities));
  const external = new Set(opts?.externalEntities ?? []);
  const known = (name: string) => entityNames.has(name) || external.has(name);

  for (const [entityName, entity] of Object.entries(manifest.entities)) {
    if (entity.extends && !known(entity.extends)) {
      errors.push({ path: `entities.${entityName}.extends`, message: `unknown entity "${entity.extends}"` });
    }
    // Exactly-one-at-most is part of what `identity` means (it is THE dedup key), and a manifest
    // author has no other way to find out — the compiler would happily decorate both and the
    // failure would surface as duplicated extractions much later.
    const identityProps = Object.entries(entity.properties)
      .filter(([, spec]) => spec.identity)
      .map(([propName]) => propName);
    if (identityProps.length > 1) {
      errors.push({
        path: `entities.${entityName}.properties`,
        message: `more than one identity property (${identityProps.join(', ')}) — an entity has at most one dedup key`,
      });
    }
    // Nothing is ever *of* an abstract entity, so nothing could be minted as one — and a target
    // list built by collecting the flag would carry a name the executor cannot resolve to a shape,
    // failing the whole pass rather than the one entry.
    if (entity.extractable && entity.abstract) {
      errors.push({
        path: `entities.${entityName}.extractable`,
        message: 'an abstract entity cannot be an extraction target — nothing is ever an instance of it',
      });
    }
    // A block is edited collaboratively inside a document, so resolving two concurrent edits needs
    // a counter to compare. This was a rule in CONVENTIONS.md that nothing checked, because the
    // thing it keyed off was which directory the file sat in.
    if (entity.blockable && !entity.abstract && !entity.properties.version) {
      errors.push({
        path: `entities.${entityName}.blockable`,
        message:
          'a blockable entity needs a `version` property — it is what resolves concurrent edits inside a document',
      });
    }
    for (const [propName, spec] of Object.entries(entity.properties)) {
      if (!spec.options) continue;
      const base = `entities.${entityName}.properties.${propName}.options`;
      if (spec.options.length === 0) {
        errors.push({ path: base, message: 'options must not be empty — omit the field for an open value' });
      }
      const expected = spec.type === 'number' ? 'number' : spec.type === 'string' ? 'string' : null;
      if (!expected) {
        errors.push({
          path: base,
          message: `options are only meaningful on string/number properties, not "${spec.type}"`,
        });
      } else if (spec.options.some((o) => typeof o !== expected)) {
        errors.push({ path: base, message: `every option must be a ${expected} to match the property type` });
      } else if (spec.default !== undefined && !spec.options.includes(spec.default as string | number)) {
        errors.push({ path: base, message: `default "${spec.default}" is not one of the declared options` });
      }
    }
    for (const [relName, rel] of Object.entries(entity.relations)) {
      const base = `entities.${entityName}.relations.${relName}`;
      // An empty target is an untyped reference, not a broken one.
      if (rel.target === '') continue;
      if (!known(rel.target)) {
        errors.push({ path: `${base}.target`, message: `unknown target entity "${rel.target}"` });
        continue;
      }
      if (rel.reverseOf && !entityNames.has(rel.target)) {
        // The target is external, so its relations are not in view — refusing beats guessing.
        errors.push({
          path: `${base}.reverseOf`,
          message: `cannot declare reverseOf against external entity "${rel.target}"`,
        });
        continue;
      }
      if (rel.reverseOf && !(rel.reverseOf in manifest.entities[rel.target].relations)) {
        errors.push({
          path: `${base}.reverseOf`,
          message: `"${rel.reverseOf}" is not a relation on "${rel.target}"`,
        });
      }
    }
  }

  return errors.length ? { valid: false, errors } : { valid: true, manifest };
}

// ─── Lookup helpers (used by the query engine / IR compiler) ────────────────────

export function getEntity(manifest: EntityManifest, name: string): EntitySchema | undefined {
  return manifest.entities[name];
}

export function getProperty(manifest: EntityManifest, entity: string, property: string): PropertySchema | undefined {
  return manifest.entities[entity]?.properties[property];
}

export function getRelation(manifest: EntityManifest, entity: string, relation: string): RelationSchema | undefined {
  return manifest.entities[entity]?.relations[relation];
}

/**
 * Names of the entities a manifest declares an LLM may mint — see {@link EntitySchema.extractable}.
 *
 * Sorted, because the answer becomes an `AutoProcessorConfig`'s class list and two peers computing
 * a different order for the same set would each see the other's registration as a change worth
 * rewriting. The executor sorts what it loads back for the same reason.
 *
 * One function over one field, rather than each caller filtering: core vocabulary and a community's
 * own shapes are both manifests, so "what may be extracted here" is this run twice and concatenated
 * — which is exactly what keeps a shape defined this morning on equal footing with `TaskBlock`.
 */
export function extractableEntities(manifest: EntityManifest): string[] {
  return Object.entries(manifest.entities)
    .filter(([, entity]) => entity.extractable && !entity.abstract)
    .map(([name]) => name)
    .sort();
}

/**
 * Names of the entities whose records can be authored inline in a document — see
 * {@link EntitySchema.blockable}.
 *
 * Sorted for the same reason {@link extractableEntities} is: the answer is compared between peers
 * and between runs, and two orderings of one set read as a change.
 */
export function blockableEntities(manifest: EntityManifest): string[] {
  return Object.entries(manifest.entities)
    .filter(([, entity]) => entity.blockable && !entity.abstract)
    .map(([name]) => name)
    .sort();
}
