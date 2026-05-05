# @we/models — Data Model Conventions

Rules and patterns for authoring AD4M data models in this package.

## Directory Structure

```
src/
├── WeNode.ts        ← base class for all models
├── constants.ts     ← shared URIs and constants
├── entities/        ← first-class application objects
├── blocks/          ← composable content nodes
└── utils/           ← helper functions (transforms, normalisation)
```

## The Core Distinction: Entities vs Blocks

### Entities (`entities/`)

Entities are **first-class application objects with independent identity and lifecycle**. They exist before and outside any document that might reference them. They are never written as direct children of a `CollectionBlock` in the block editor.

Examples: `Space`, `AgentProfile`, `Signal`, `ChatSession`, `ChatMessage`

Rules:
- No `version` property — they are not collaboratively edited in a CRDT sense
- If they need to appear *inside* a document composition, they are referenced **by pointer** via `EmbedBlock` (not embedded directly)
- Typically managed by stores (`AdamStore`, `SpaceStore`, etc.)

### Blocks (`blocks/`)

Blocks are **composable content nodes** that can be created fresh and dropped directly into the block editor as a unit of authored content. They may also exist and be used standalone outside any composition — but their defining characteristic is that authoring them inline in a document makes sense.

Examples: `TextBlock`, `ImageBlock`, `LocationBlock`, `EventBlock`, `TaskBlock`, `AudioBlock`

Rules:
- Always have a `version: number` property for CRDT conflict resolution in collaborative editing
- Can appear as direct children of `CollectionBlock`
- Can also be used standalone (e.g. `LocationBlock` referenced via `Space.locations` HasMany, `TaskBlock` in a task board view) — this does not make them entities

### The deciding question

> **"Can a user meaningfully create this fresh, inline, while authoring a document?"**

- **Yes** → it's a block (`blocks/`)
- **No** → it's an entity (`entities/`)

`Space` is the canonical borderline example: a space *could* theoretically be created from a document, but doing so has infrastructure consequences (registering SDNA models, creating a perspective, optionally publishing a neighbourhood) that make inline authoring impractical. It is therefore an entity.

### EmbedBlock — the bridge

`EmbedBlock` is a special block whose purpose is to embed a **reference** to an entity (or another block) by its stable identifier. The renderer resolves the reference lazily from the appropriate store.

```ts
// Embedding a Space in a document
EmbedBlock {
  target: '<space-uuid>',
  targetType: 'space',
  displayMode: 'card' | 'inline',
}

// Embedding a user in a document
EmbedBlock {
  target: '<agent-did>',
  targetType: 'agent',
  displayMode: 'card' | 'inline',
}
```

Valid `targetType` values: `'space'` | `'agent'` | `'block'`

---

## Base Classes

### `WeNode` (base for all models)

All models — both entities and blocks — extend `WeNode`, which in turn extends `Ad4mModel`.

`WeNode` provides:
- `comments: string[]` — HasMany relation for comment IDs
- `signals: string[]` — HasMany relation for signal IDs

These are always present on every model instance but are only surfaced in the UI where contextually appropriate (e.g. a `LocationBlock` pin on a map might not show a comments thread, but the data is there if needed in future).

---

## Naming Conventions

| Type | Suffix | Example |
|---|---|---|
| Block | `*Block` | `LocationBlock`, `TaskBlock` |
| Entity | none | `Space`, `AgentProfile` |
| Utility function | camelCase | `resizeImage`, `normalizeSignal` |

---

## Property URIs

All `@Property` predicates use the `we://` namespace. Use snake_case for multi-word predicates:

```ts
@Property({ through: 'we://has_name' })
@Property({ through: 'we://start_date' })
```

Avoid generic predicates that could clash across models (e.g. `we://name` is used by `LocationBlock` — prefer `we://has_name` for new properties).

---

## Adding a New Model

1. Decide: entity or block? Apply the authoring question above.
2. Place in the correct folder (`entities/` or `blocks/`).
3. Extend `WeNode` (not `Ad4mModel` directly, unless you have a specific reason).
4. Add a `version: number` property if and only if it's a block.
5. Export from the folder's `index.ts` and from `src/index.ts`.
6. Register the model in any perspective that needs it (e.g. in `AdamStore.createSpace` or `initSystemPerspectives`).
