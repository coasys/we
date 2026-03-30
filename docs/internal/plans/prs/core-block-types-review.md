# Core Block Types — Plan Review

Findings from comparing [core-block-types.md](core-block-types.md) against the actual codebase.

---

## 1. URI Convention ✅

**Plan uses:** `we://has_*` URIs (`we://has_text`, `we://has_src`, `we://has_title`)

**Codebase uses:** block-prefixed URIs (`we://text_block_text`, `we://image_block_src`)

**Resolution:** Shared predicates are correct — query scoping happens at `@Model` layer. But `has_` prefix is redundant (Schema.org convention: direct nouns for everything).

**Decision:** All direct, no prefix — `we://title`, `we://description`, `we://start_date`. Applies to both data properties (`@Property`) and relationships (`@HasMany`): `we://comment`, `we://reaction`.

Migrate all 3 existing models' URIs as part of this PR so all 15 models are aligned. Breaking change for stored data, acceptable — no external consumers yet.

---

## 2. Missing `type` and `version` Fields

**Every existing model has:**

- `type` — the Lexical node type string, used by `resolveBlockType()` in serialization
- `version` — integer for schema migration support

**The plan omits both** from all 10 new block specs and the 3 existing block specs.

**Decision:**

- **`type`** — Only needed on TextBlock (stores Lexical node type: `"paragraph"`, `"heading"`, `"quote"`, etc.). Remove from ImageBlock and CollectionBlock. Skip on all new models.
- **`version`** — Keep on all models for forward-proofing schema migrations.
- **CollectionBlock root query** — Currently uses `CollectionBlock.findAll({ where: { type: 'root' } })`. Replace with Space `@HasMany` relationship:
  ```ts
  @Model({ name: 'Space' })
  class Space extends Ad4mModel {
    @HasMany(() => CollectionBlock, { through: 'we://post' })
    posts: CollectionBlock[];
  }
  ```
  Then query via `Space.findOne({ where: { id: ... }, include: { posts: true } })`. Semantically correct, eliminates the magic `type: 'root'` string, follows standard AD4M relationship pattern.

---

## 3. `required: true` on All Properties

**Existing pattern:** Every property in TextBlock, ImageBlock, CollectionBlock uses `required: true` with a default value.

**Plan marks only some fields as required** (e.g. `src` on ImageBlock but not `altText`).

**Decision:** Ad4mModel default is `required: false` — required is opt-in. In a triple store where models are projections over shared graph structure (aligned with the shared-predicate URI convention), optional-by-default enables model definitions to overlap predicates, improving interoperability and flexibility. Only mark `required: true` on properties that are structurally essential (e.g. `src` on ImageBlock).

Migrate existing models: remove blanket `required: true` from all properties, only keep it where semantically necessary.

---

## 4. CollectionBlock Field Additions

**Plan shows `columns` and `gap`** on CollectionBlock, but the current model only has: `type`, `display`, `direction`, `format`, `indent`, `version`.

**This is a schema change to an existing model** — different from creating new models. Existing CollectionBlock instances in AD4M won't have these fields.

**Decision:** Bundle — this PR gets all models (existing + new) fully aligned. Adding optional fields to existing models is safe (default values), and doing it now avoids a second migration pass.

---

## 5. TextBlock Field Additions → Separate Models

**Plan adds three new fields** to TextBlock for callout/divider support:

- `variant` — `info | warning | tip | danger` (callouts only)
- `icon` — callout icon
- `style` — `solid | dashed | dotted` (dividers only)

**Decision:** Don't add these to TextBlock. Create separate models instead:

- **CalloutBlock** — `{ text, variant, icon, version }`. Shares `we://text` predicate with TextBlock via graph overlap, but is structurally distinct (has variant/icon semantics).
- **DividerBlock** — `{ style, version }`. No text content at all — not a text variant.

TextBlock stays Lexical-focused: paragraph, heading, quote, list item. This avoids overloading TextBlock's `type` field (which is the Lexical node type discriminator) with non-text block kinds.

Total new models: **12** (original 10 + CalloutBlock + DividerBlock).

---

## 6. Editor Component Location

**Plan says:** components go in `@we/components` (design-system/4-components) or `@we/widgets` (design-system/5-widgets).

**Initial concern:** Block-specific renderers depend on block model semantics and potentially Lexical context.

**Decision:** Plan is correct. With GenericBlockNode, there are two distinct layers:

- **GenericBlockNode** (in `block-system/`) — Lexical adapter that mounts a component into a DOM container. Only Lexical-coupled piece.
- **Render components** (AudioPlayer, EventCard, ImageViewer, etc.) — pure SolidJS components with no Lexical dependency. Reusable in feeds, previews, mobile views.

Place render components in the design-system packages:

- `@we/components` — simpler block renderers (DividerBlock, CodeBlock)
- `@we/widgets` — richer interactive ones (AudioPlayer, EventCard, TaskItem)

Existing ImageBlock component in `block-system/` should migrate to design-system as part of this PR when GenericBlockNode is implemented.

---

## 7. Execution Order

**Plan orders:** Phase 1 (editor infrastructure) → Phase 2 (models) → Phase 3 (components)

**Revised order** (accounting for decisions above):

| Step | What                                                                                                   | Why                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 1    | **New models** (12 new)                                                                                | Zero risk — pure additions, no existing code changes, unblocks `$query` PR                                         |
| 2    | **Registry + serialization refactor**                                                                  | Must exist before `type` field can be removed from existing models (registry replaces string-based discrimination) |
| 3    | **Existing model migration** (URIs, remove `type`, change required, add fields) + **Space `@HasMany`** | Depends on registry; Space `@HasMany` must exist before `type: 'root'` query is removed                            |
| 4    | **GenericBlockNode + ImageBlock component migration**                                                  | Riskiest editor change — migrate ImageBlock component to design-system                                             |
| 5    | **New editor components**                                                                              | Incremental — one block type at a time                                                                             |

**Rationale:** New models are still the safest starting point. But existing model migration (findings #1–4) now depends on the registry being in place, since removing `type` from ImageBlock/CollectionBlock breaks `resolveBlockType()` without a registry-based alternative.

---

## Summary

| #   | Finding                                   | Decision needed                                                                                                 |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | URI convention: generic vs block-prefixed | Which convention?                                                                                               |
| 2   | `type` + `version` fields                 | **Decided:** `type` only on TextBlock, `version` on all. Space `@HasMany` replaces root query.                  |
| 3   | `required: true` on all vs selective      | **Decided:** Default `required: false` on Ad4mModel. Opt-in required for essential props only.                  |
| 4   | CollectionBlock field additions           | **Decided:** Bundle — all models aligned in this PR.                                                            |
| 5   | TextBlock field additions                 | **Decided:** Separate CalloutBlock + DividerBlock models instead. 12 new models total.                          |
| 6   | Component location                        | **Decided:** Design-system packages (`@we/components` + `@we/widgets`). Block-system only has GenericBlockNode. |
| 7   | Execution order                           | **Decided:** New models → registry → existing model migration → GenericBlockNode → components                   |
