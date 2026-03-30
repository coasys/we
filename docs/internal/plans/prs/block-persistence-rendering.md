# Plan: Block Persistence & Rendering

> Parent-child linking, polymorphic @HasMany, display vs. edit components, and integration with the WE apps ecosystem.

---

## Context

PR #5b (Core Block Types) delivered 15 block models, a block type registry, generic serialization via `getPropertiesMetadata()`, and a `createBlockNodeClass` factory for Lexical editor nodes. But the persistence layer (`createBlocks`) currently creates flat, unlinked model instances — no parent→child relationships. And the block component architecture needs to be extended so contributors can provide display + input components without touching Lexical.

This PR addresses both gaps: proper AD4M relationship-based persistence and a component registration architecture that keeps Lexical coupling inside the factory.

**Prerequisite:** [core-block-types](core-block-types.md) (PR #5b — models, registry, factory)
**Related:** [CRDT Ordering Strategy](../../../notes/ad4m/CRDT-ORDERING-STRATEGY-V3.md) (future AD4M work), [query-service](query-service.md) (PR #5c — `$query` token)

---

## 1. Parent-Child Persistence

### Problem

`createBlocks()` currently creates block model instances but doesn't link children to parents. A CollectionBlock with TextBlocks and ImageBlocks produces orphaned records — there's no queryable relationship between them.

### Solution: Polymorphic @HasMany

All block models extend `WeNode` (which extends `Ad4mModel`). A single `@HasMany` relationship on parent blocks can reference any child block type through a shared predicate:

```typescript
@Model({ name: 'CollectionBlock' })
class CollectionBlock extends WeNode {
  @HasMany({ through: 'we://children' })
  children: string[] = [];

  // ... existing properties
}
```

### Polymorphic Hydration Strategy (Resolved)

**Finding:** Ad4mModel does **not** support polymorphic hydration. The hydration code in `ad4m/core/src/model/hydration.ts` always instantiates children as the declared target class — `@HasMany(() => WeNode)` returns plain `WeNode` instances, losing concrete type info and properties.

**Alternatives considered:**

1. **Separate `@HasMany` per block type** (Flux pattern) — `@HasMany(() => TextBlock)`, `@HasMany(() => ImageBlock)`, etc. Rejected: 15+ declarations, ordering across types is lost, every new block type requires updating every container model. Works for Flux's Channel (genuinely separate concerns) but wrong for a single heterogeneous ordered collection.
2. **Array of allowed types** — `@HasMany(() => [TextBlock, ImageBlock, ...])`. Viable interim but still requires explicit enumeration that must be updated per new block type.
3. **Intermediate `Block` base class with stored `type` field** — Rejected: redundant with `@Model({ name })` which already writes SHACL type links. Adds unnecessary hierarchy complexity.
4. **`polymorphic: true` flag on `@HasMany`** — Optimal long-term. Tells hydration to check each child's `@Model` type flag and resolve the concrete class from a registry. Matches Rails polymorphic associations / Hibernate `@Any`. **Proposed as AD4M feature request.** See [polymorphic-has-many](../ad4m/polymorphic-has-many.md).
5. **String-only `@HasMany` (no target model)** — `@HasMany({ through: 'we://children' })` stores child URIs as `string[]`. Avoids wasted hydration as plain `WeNode` instances. `loadBlocks()` takes the URIs, resolves each child's `@Model` type, and hydrates with the correct class from the block registry. Consistent with existing WeNode pattern (`comments`, `reactions`). **Chosen as the current approach.**

**Decided approach (two-phase):**

- **Now (WE-side):** `@HasMany({ through: 'we://children' })` on CollectionBlock — stores child IDs as `string[]`. `loadBlocks()` takes those URIs, determines each child's `@Model` type from its SHACL type flag, looks up the concrete class from the block registry (`getBlockModel()`), and hydrates with the correct class. No wasted intermediate `WeNode` hydration. Consistent with existing WeNode pattern (`comments`, `reactions`).
- **Later (AD4M-side):** Propose `polymorphic: true` option on `@HasMany`. See [polymorphic-has-many](../ad4m/polymorphic-has-many.md). Once landed, the declaration changes to `@HasMany(() => WeNode, { through: 'we://children', polymorphic: true })` and WE's manual hydration collapses to `include: { children: true }`.
- **Optional (AD4M-side):** Default `children` relation on `Ad4mModel` base class using `ad4m://has_child` predicate for convention-over-configuration.

### Refactored createBlocks

Uses `Ad4mModel.transaction()` for atomic persistence with implicit rollback on error. A closure over `tx` and `perspective` keeps the recursive helper clean:

```typescript
export async function createBlocks(
  perspective: PerspectiveProxy,
  node: SerializedBlockNode,
): Promise<Ad4mModel | undefined> {
  return Ad4mModel.transaction(perspective, async (tx) => {
    async function persist(
      node: SerializedBlockNode,
      parent?: Ad4mModel,
    ): Promise<Ad4mModel | undefined> {
      const ModelClass = getBlockModel(node.type);
      let block: Ad4mModel | undefined;

      if (ModelClass) {
        const data = extractBlockData(ModelClass, node);
        block = await ModelClass.create(perspective, data, { batchId: tx.batchId });

        if (parent && block) {
          await parent.addChildren(block.id, { batchId: tx.batchId });
        }
      }

      if (node.children) {
        for (const child of node.children) {
          await persist(child, block ?? parent);
        }
      }

      return block;
    }

    return persist(node);
  });
}
```

If any block creation or linking fails, the transaction aborts — `commitBatch()` is never called, so no partial data is persisted.

### Ordering

**This PR:** Timestamp-based ordering (link creation time). Sufficient for initial creation — blocks written sequentially in a transaction preserve document order. Reordering is out of scope for this PR.

**When reordering is needed:** CRDT ordering via [CRDT Ordering Strategy](../../../notes/ad4m/CRDT-ORDERING-STRATEGY-V3.md) as the single ordering solution — no intermediate position-based approach. CRDT works equally well for single-user and multi-user compositions (a linked list CRDT with one writer produces the same result as a simple position list, with minimal overhead). One implementation, no branching logic, and multi-user collaboration becomes free. Reordering and arbitrary-position insertion are first-class operations.

When CRDT ordering lands in AD4M, the only WE-side change is adding `ordering` to the existing `@HasMany`:

```typescript
@HasMany({
  through: 'we://children',
  ordering: 'linkedList',
})
children: string[] = [];
```

---

## 2. Block Component Architecture

### Three-part registration

A block type is registered with three pieces: a **model**, a **display component**, and an **input component**. The display and input components are both pure SolidJS — neither imports from Lexical. The factory (`createBlockNodeClass`) is the only thing that touches Lexical.

```typescript
registerBlock({
  nodeTypes: ['image'],
  model: ImageBlock,
  display: ImageDisplay,   // (props) => JSX — pure, no onChange
  input: ImageInput,       // (props + onChange) => JSX — pure, no Lexical
});
```

| Piece | Coupling | Props contract | Reusable in |
|---|---|---|---|
| **model** | AD4M decorators | N/A | Persistence, queries, everywhere |
| **display** | Pure SolidJS | Block properties as props | Read-only editor, schema views, feeds, overrides |
| **input** | Pure SolidJS | Block properties + `onChange(prop, value)` + `isSelected` | Editor only (via factory) |

### Factory bridges Lexical

`createBlockNodeClass` manages Lexical coupling so components don't have to. In its `decorate()` method:

```typescript
const reg = getBlockRegistration(this.getType());
const readOnly = !editor.isEditable();
const nodeProps = this.__props;

return readOnly
  ? <reg.display {...nodeProps} />
  : <reg.input
      {...nodeProps}
      onChange={(prop, value) => {
        editor.update(() => {
          const node = $getNodeByKey(this.__key);
          node?.setProperty(prop, value);
        });
      }}
      isSelected={isSelected()}
    />;
```

The factory handles:
- Choosing display vs. input based on `editor.isEditable()`
- Providing `onChange` that wraps `editor.update()` + `$getNodeByKey()`
- Managing selection state via `useLexicalNodeSelection`
- Passing current node properties as reactive props

### Composition display = Lexical read-only

When viewing a saved composition, the same Lexical editor renders in read-only mode (`editor.setEditable(false)`). The factory switches to display components automatically. This preserves the author's intended layout — same structure, same ordering, no re-rendering through a different system.

### Display overrides

Consumers can override display components per block type without affecting the registered defaults:

```typescript
<BlockDisplayOverrides overrides={{ image: MyCustomImageCard }}>
  <ReadOnlyComposition content={...} />
</BlockDisplayOverrides>
```

The factory checks the override context before falling back to the registered display component. This works because display components are pure props-in/JSX-out — any component with the same props contract is a valid replacement.

### What a block contributor ships

1. **A model** (required) — `@Model` class extending WeNode
2. **A display component** (required) — pure SolidJS, just props. Can compose existing primitives: `(props) => <we-image src={props.src} />`
3. **An input component** (required for editor blocks) — pure SolidJS with `onChange` prop. Can compose existing primitives: `<we-file-input onFile={(f) => props.onChange('src', f)} />`

No Lexical imports. No framework lock-in beyond SolidJS.

### Input component patterns

The input component handles all editing states internally — the factory only provides `onChange`, `isSelected`, and block properties as props. Two patterns emerge depending on block type:

**Media blocks** (image, video, audio, link) have two internal states — *empty* and *populated*. When empty, they show a creation UI (drop zone, URL field). When populated, they **compose the display component** and layer edit affordances on top:

```tsx
import { ImageDisplay } from './ImageDisplay';

function ImageInput(props) {
  return (
    <div class="image-block-editor">
      <Show when={props.src} fallback={
        <DropZone onDrop={(file) => props.onChange('src', file)} />
      }>
        <ImageDisplay src={props.src} width={props.width} height={props.height} />
        <Show when={props.isSelected}>
          <button class="delete-overlay" onClick={() => props.onChange('src', undefined)}>×</button>
          <ResizeHandle onChange={(w, h) => { props.onChange('width', w); props.onChange('height', h); }} />
        </Show>
      </Show>
    </div>
  );
}
```

This avoids duplicating rendering logic — the populated editing view and the read-only display are the same `ImageDisplay` component, with edit controls overlaid. Recommended for any block where the "populated editing" state looks like the display plus controls.

**Form blocks** (event, task, callout) look the same empty or populated — always a form with fields. The display is a completely different rendered view (e.g., an event card vs. date picker inputs). No composition of display inside input for these.

| Block type | Empty (input) | Populated (input) | Read-only (display) |
|---|---|---|---|
| Image | Drop zone + upload button | `ImageDisplay` + delete/resize | Just the image |
| Video | URL field + upload button | `VideoDisplay` (player) + replace/delete | Just the player |
| Audio | File picker | `AudioDisplay` (player) + replace/delete | Just the player |
| Link | URL text input | `LinkDisplay` (preview card) + edit/delete | Just the preview |
| Code | Empty editor + language picker | Editable code + language picker | Syntax-highlighted, static |
| Event | Date pickers + title field | Same form, populated | Rendered event card |
| Task | Status dropdown + title field | Same form, populated | Rendered task item |

### Schema rendering (future, separate PR)

Display components are also consumable outside Lexical — via `$query` in schema templates or direct use in app views. This is a post-`$query` concern (see [query-service](query-service.md)) and is not in scope for this PR. The architecture supports it because display components have zero editor coupling.

---

## 3. Implementation Plan

### Phase 1: Investigate Ad4mModel polymorphic @HasMany ✅

- [x] Test whether `@HasMany(() => WeNode)` hydrates correct subclasses — **no**, returns plain `WeNode`
- [x] Investigate discriminator options or manual hydration fallback — no discriminator support; manual fallback via block registry
- [x] Document findings — see §1 "Polymorphic Hydration Strategy" above
- [x] File AD4M feature request for `polymorphic: true` on `@HasMany`

### Phase 2: Parent-child persistence

- [ ] Add `@HasMany({ through: 'we://children' })` to CollectionBlock (string-only, no target model)
- [ ] Refactor `createBlocks()` to link children to parents
- [ ] Add `loadBlocks()` function to reconstruct block tree from AD4M
- [ ] Verify round-trip: create in editor → save → load → display in editor

### Phase 3: Factory + component registration

- [ ] Extend `BlockRegistration` interface with `display` and `input` component fields
- [ ] Extend `createBlockNodeClass` factory to provide `onChange`, `isSelected` props and switch between display/input based on `editor.isEditable()`
- [ ] Add `BlockDisplayOverrides` context provider for consumer-side display overrides
- [ ] Migrate existing ImageBlock to the new pattern (split into ImageDisplay + ImageInput, remove direct Lexical imports from component)
- [ ] Verify round-trip: edit mode uses input component, read-only mode uses display component

### Not in scope

- Schema integration / `$query` rendering of blocks (post-`$query` PR)
- CRDT ordering implementation (AD4M-side work, see ordering strategy doc)
- TableBlock (complex Lexical integration)
- Custom store for drag-and-drop block reordering in the editor
- Building all 15 block display/input components (incremental, per-block-type PRs)

---

## Risks

| Risk                                                      | Mitigation                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| Ad4mModel doesn't support polymorphic @HasMany            | Manual hydration via block registry now; `polymorphic: true` AD4M feature request filed for future |
| Ordering breaks without CRDT strategy                     | Timestamp-based creation order is sufficient for initial implementation    |
| Factory `onChange` contract doesn't cover all input patterns | Start with ImageBlock migration as proof; extend contract if needed for complex blocks (e.g., multi-field forms) |
| Display override context adds rendering indirection       | Single context lookup per block render — negligible cost; fallback is the registered default |
