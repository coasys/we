# @we/entities — Entity Authoring Conventions

Rules and patterns for authoring WE's entities in this package.

**The vocabulary, in three words.** An **entity** is a type — a kind of thing that can be stored. A
**record** is one instance of one. A **block** is an entity whose records can be authored inline
inside a composed document; it is a flag on an entity, not a second kind of declaration.

"Model" is not one of them. It means an AI model, everywhere in WE.

## Directory Structure

```
src/
├── manifest/        ← THE SOURCE OF TRUTH — authored, per-entity neutral schemas
│   ├── <Entity>.ts  ← one module per entity: schema + prose + codegen facts
│   ├── shared.ts    ← WeNode's shared relations, declared once
│   ├── defs.ts      ← the CoreEntityDef shape a module exports
│   ├── types.ts     ← GENERATED neutral interfaces — the model contract (generate:types)
│   ├── base.ts      ← WeNodeRecord over @we/backend-shared's RecordInstance
│   └── index.ts     ← assembles CORE_MANIFEST (imported as '@we/entities/manifest')
├── index.ts         ← entity proxies, typed by the contract — never by any backend's classes
├── entityRegistry.ts ← where backends register implementations, transactions, file storage
├── constants.ts     ← shared URIs and constants
└── utils/           ← helper functions (transforms, normalisation)
```

This package has **no `@coasys` dependency**. The AD4M classes generated from this manifest live in
`@we/backend-ad4m` (`src/entities/`, rebuilt with `pnpm --filter @we/backend-ad4m generate:classes`),
beside the adapter that registers them — as any backend's implementations live beside their
adapter. The conformance assertions holding them to `manifest/types.ts` live there too.

````

## Authoring an entity — edit the manifest, generate the class

The decorated classes in `@we/backend-ad4m/src/models` are build artifacts. To add or change a
model, edit its module under `src/manifest/` — schema, defaults, interpretation hints and the
design prose all live there — then run both generators:

```sh
pnpm --filter @we/entities generate:types
pnpm --filter @we/backend-ad4m generate:classes
````

Doc comments in the manifest module are lifted into the generated class, so IDE hovers keep
working. `coreManifest.test.ts` (backend-ad4m) holds the generated classes and the manifest's
_runtime_ compilation in exhaustive agreement — a stale or wrong generation fails there, with
predicates, hints, defaults and storage behaviour all compared.

Codegen-only facts (TypeScript optionality, union aliases, accessor-method interfaces, typed
relation arrays) ride beside the schema in each module's `CoreEntityDef` — see `manifest/defs.ts`.
They shape the generated class; the neutral schema itself stays free of TypeScript.

## The neutral type surface

`generate:classes` also emits `src/manifest/types.ts` — one interface per entity (`SpaceRecord`,
`TaskBlockRecord`, …) over the neutral base in `manifest/base.ts`. These ARE the model contract:
fields only, deliberately, since relation accessors and query sugar are backend ergonomics.
`src/manifest/conformance.ts` holds the generated AD4M classes to them with type-level assertions
reached from the manifest entry point, so a class drifting from its interface fails the build.
A new backend implements these interfaces — runtime-compiled the way `@we/backend-inmemory` does,
or generated the way the AD4M lane is — and registers its implementations in the entity proxy
registry; consumers never notice which.

## Blocks are entities, with one extra capability

`blockable: true` on an entity's schema says: **a person can create one of these fresh, inline,
while authoring a document.**

That is the whole distinction, and it is deliberately a flag rather than a folder. These lived in
two sibling directories — `entities/` beside `blocks/` — for a long time, which read as two kinds of
declaration when the manifest has only ever had one map with all of them in it. Worse, it made
blockness a fact about a file's _location_, which meant the rule below could not be checked by
anything.

### What the flag obliges

A `version: number` property, enforced by `validateManifest`. Blocks are edited collaboratively
inside a document, so resolving two concurrent edits needs a counter to compare; an entity that is
never composed is written by one owner at a time and needs none. This was prose here that nothing
enforced.

### The deciding question

> **"Can a person meaningfully create this fresh, inline, while authoring a document?"**

- **Yes** → `blockable: true`, and give it a `version`. `TextBlock`, `TaskBlock`, `ImageBlock`.
- **No** → leave it off. `Space`, `Signal`, `ChatSession`, `Template`.

Being blockable does **not** mean the entity only exists inside documents. `LocationBlock` is
referenced by `Space.location`, `TaskBlock` renders standalone on a task board — both are ordinary
records that also happen to be composable. The flag adds a capability; it takes nothing away.

`Space` is the canonical borderline case: one _could_ be created from a document, but doing so has
infrastructure consequences (registering SDNA, creating a perspective, optionally publishing a
neighbourhood) that inline authoring cannot carry. So it is not blockable.

### The other half of blockness

`blockable` is the _data_ half. Rendering one in the block editor needs Display and Input components
registered through `registerBlock()` in `@we/block-shared`. The two are separate on purpose: a
backend reading the manifest learns which entities are composable without loading any UI at all.

### EmbedBlock — the bridge

`EmbedBlock` is the block whose purpose is to embed a **reference** to a record by its stable
identifier. The renderer resolves the reference lazily.

```ts
// Embedding a Space in a document
EmbedBlock {
  target: '<space-uuid>',
  targetType: 'space',
  displayMode: 'card' | 'inline',
}
```

Valid `targetType` values: `'space'` | `'agent'` | `'block'`

---

## Base Classes

### `WeNode` (base for all entities)

Almost every entity extends `WeNode`, which in turn extends `Ad4mModel`.

`WeNode` provides:

- `comments: string[]` — HasMany relation for comment IDs
- `signals: string[]` — HasMany relation for signal IDs

These are always present on every model instance but are only surfaced in the UI where contextually appropriate (e.g. a `LocationBlock` pin on a map might not show a comments thread, but the data is there if needed in future).

---

## Naming Conventions

| Type             | Suffix    | Example                          |
| ---------------- | --------- | -------------------------------- |
| Blockable entity | `*Block`  | `LocationBlock`, `TaskBlock`     |
| Any other entity | none      | `Space`, `Signal`                |
| Utility function | camelCase | `resizeImage`, `normalizeSignal` |

The `*Block` suffix is convention, not mechanism — `blockable: true` is what anything reads. Keep
them in agreement: a suffix without the flag is a lie the compiler cannot catch.

---

## Property URIs

All `@Property` predicates use the `we://` namespace. Use snake_case for multi-word predicates:

```ts
@Property({ through: 'we://name' })
@Property({ through: 'we://start_date' })
```

**Prefer generic, reusable predicates.** When two models share the same semantic concept (e.g. `name`, `description`, `url`), use the same predicate — this enables cross-model graph pattern queries. For example, querying `?node we://name ?name` returns names from `LocationBlock`, `Theme`, `ChatSession`, `TagBlock`, and any future model without knowing the type in advance.

---

## Relations — three tiers, and choosing between them

Before adding a `@HasOne` or `@HasMany`, read
[`docs/architecture/relations.md`](../../docs/architecture/relations.md). A connection between two
records can live in three places and they are not interchangeable:

|                                      | Authored by             | Query by it                     | Carries its own data |
| ------------------------------------ | ----------------------- | ------------------------------- | -------------------- |
| Free-text label on a `Relationship`  | any member              | no                              | yes                  |
| A community-named `RelationshipType` | the community           | `where: { relationshipTypeId }` | yes                  |
| A relation declared here             | whoever owns the schema | fully                           | **no**               |

The deciding question is not scale — it is **whether the connection is a fact about the _type_ or a
claim about a _pair_**. "Every task may have an assignee" is the first and belongs on the class.
"This task came out of that call" is the second, was made by a person after both records existed,
and belongs in a record of its own.

Two consequences worth knowing before you reach for a decorator:

- **A declared relation has no identity.** No author, no date, nothing to comment on, nothing to
  rate. If the connection can be disputed or attributed, declaring it throws that away — and no
  amount of extra properties on either end brings it back.
- **A reified relation has no query pushdown.** No `include` hydration, no ordering by a related
  property, no count projections. If you will query _by_ it, declare it.

`Relationship`, `Placement` and `Signal` are all the reified form, and each names in its own header
why it is not a declared relation. `RelationshipType` and `SignalType` are the middle tier.

---

## Type Discriminators (`@Flag`)

Every model must have a `@Flag` as its first property. The `@Flag` decorator writes a constant triple that uniquely identifies the model type — essential for filtering mixed graph results.

```ts
@Flag({ through: 'we://flag', value: 'we://location_block' })
flag: string = '';
```

Rules:

- Always use `we://flag` as the `through` predicate — **never `we://type`** (that is a content property on some models)
- The `value` follows the pattern `we://<snake_case_model_name>`
- The TypeScript property must be named `flag` to avoid clashing with content `type` properties
- Always the **first property** in the class, before any `@Property` or `@HasMany`

---

## Adding a New Entity

1. Create `src/manifest/<Name>.ts` — one flat directory, no folder decision to make.
2. Set `base: 'WeNode'` (not `'Ad4mModel'`, unless you have a specific reason).
3. Ask the blockable question above. If yes: `blockable: true` **and** a `version: number` property.
   `validateManifest` fails the build if you set one without the other.
4. Export from `src/manifest/index.ts` and, if consumers need a proxy, from `src/index.ts`.
5. Register the entity in any perspective that needs it (e.g. in `AdamStore.createSpace` or `initSystemPerspectives`).
6. Regenerate: `pnpm --filter @we/entities build && pnpm --filter @we/entities generate:manifest`.

### The generated manifest

`src/generated/coreManifest.ts` is a machine-readable description of every model here, derived from
the classes by `scripts/generateCoreManifest.mjs`. It is what the manifest compiler — the same one
feature modules declare their entities through — is tested against, so a stale manifest means the
compiler is being tested against a data model we no longer have.

It is **not** generated during `build`: the script imports the _built_ classes, so it has to run
after a build rather than as part of one. Nothing depends on you remembering, though — the
equivalence suite in `@we/backend-ad4m` compares every entity against its class and fails with the
command to run. If you add a model, change a property, or change a predicate, expect that suite to
go red until you regenerate.

Never hand-edit the generated file.
