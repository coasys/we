# Plan: Block Persistence & Rendering

> Parent-child linking, polymorphic @HasMany, display vs. edit components, and integration with the WE apps ecosystem.

---

## Context

PR #5b (Core Block Types) delivered 15 block models, a block type registry, generic serialization via `getPropertiesMetadata()`, and a `createBlockNodeClass` factory for Lexical editor nodes. But the persistence layer (`createBlocks`) currently creates flat, unlinked model instances — no parent→child relationships. And there are no display components for blocks outside the editor context.

This PR addresses both gaps: proper AD4M relationship-based persistence and a dual-mode rendering story (edit + display).

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
  @HasMany(() => WeNode, { through: 'we://children' })
  children: WeNode[] = [];

  // ... existing properties
}
```

### Open Question: Polymorphic Hydration

**Does Ad4mModel resolve the correct subclass on hydration?** When `CollectionBlock.find(perspective, id, { include: { children: true } })` returns children, does it check each child's `@Model` flag/type link and instantiate `TextBlock`, `ImageBlock`, etc. — or does it return plain `WeNode` instances?

**Investigation needed:**

1. Check Ad4mModel's `@HasMany` hydration path — does it look up the target's `@Model` name link?
2. If not, is there a `discriminator` or `polymorphic` option on `@HasMany`?
3. If neither, is this a feature request for AD4M?

**Fallback if no polymorphic hydration:** Use `perspective.get({ source: parentId, predicate: 'we://children' })` to get child URIs, then use the block registry to determine each child's type from its `@Model` flag and hydrate with the correct class. Less elegant but functional.

### Refactored createBlocks

Once parent-child linking works:

```typescript
export async function createBlocks(
  perspective: PerspectiveProxy,
  node: SerializedBlockNode,
  parent?: Ad4mModel,
  existingBatchId?: string,
): Promise<Ad4mModel | undefined> {
  const ModelClass = getBlockModel(node.type);
  const batchId = existingBatchId || (await perspective.createBatch());

  let block: Ad4mModel | undefined;

  if (ModelClass) {
    const data = extractBlockData(ModelClass, node);
    block = await ModelClass.create(perspective, data, { batchId });

    // Link child to parent
    if (parent && block) {
      await parent.addChildren(block, { batchId }); // Uses @HasMany setter
    }
  }

  // Recurse into children
  if (node.children) {
    for (const child of node.children) {
      await createBlocks(perspective, child, block ?? parent, batchId);
    }
  }

  if (!existingBatchId) {
    await perspective.commitBatch(batchId);
  }

  return block;
}
```

### Ordering

The [CRDT Ordering Strategy](../../../notes/ad4m/CRDT-ORDERING-STRATEGY-V3.md) maps directly to this:

```typescript
@HasMany(() => WeNode, {
  through: 'we://children',
  ordering: 'linkedList',
})
children: WeNode[] = [];
```

This is **future work on the AD4M side** — the ordering strategy doc is pre-implementation. For now, creation order (timestamp-based sorting) provides correct ordering for new documents. When CRDT ordering lands in AD4M, adding the `ordering` option to the existing `@HasMany` is a one-line change.

---

## 2. Display vs. Edit Components

### Two rendering contexts

| Context     | Framework coupling         | Where it lives                   | How it's used                                             |
| ----------- | -------------------------- | -------------------------------- | --------------------------------------------------------- |
| **Edit**    | Lexical + SolidJS          | `@we/block-solid`                | `createBlockNodeClass()` → DecoratorNode in BlockComposer |
| **Display** | Framework-agnostic SolidJS | `@we/components` / `@we/widgets` | Schema templates via `$query`, feed views, previews       |

### Why separate components

Edit components need:

- Lexical context (`useLexicalComposerContext`, `$getNodeByKey`)
- Selection/focus state
- Input affordances (URL entry, file upload, drag handles)
- Bidirectional data flow (user types → node updates → model saves)

Display components need:

- Just props in, rendered output out
- No editor dependencies
- Reusable in feeds, cards, previews, mobile views, schema-rendered apps

A single component with an `editable` prop would force Lexical as a dependency for all rendering — defeating the purpose of the design-system separation.

### Component mapping

| Block type      | Edit component (block-system)                             | Display component (design-system)                              |
| --------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| TextBlock       | Built-in Lexical nodes (ParagraphNode, HeadingNode, etc.) | `we-text`, `we-blockquote`, `we-heading` (existing primitives) |
| ImageBlock      | ImageBlock (existing, migrate to factory)                 | `we-image` or simple `<img>` wrapper                           |
| AudioBlock      | AudioEditor (upload, waveform)                            | `AudioPlayer` widget                                           |
| VideoBlock      | VideoEditor (URL/upload)                                  | `VideoPlayer` widget                                           |
| FileBlock       | FileUploader                                              | `FileAttachment` component                                     |
| EventBlock      | EventEditor (date pickers)                                | `EventCard` widget                                             |
| TaskBlock       | TaskEditor (status, assignee)                             | `TaskItem` component                                           |
| LocationBlock   | LocationEditor (map picker)                               | `LocationCard` widget                                          |
| LinkBlock       | LinkEditor (URL with OG fetch)                            | `LinkPreview` component                                        |
| CodeBlock       | CodeEditor (syntax highlight)                             | `Code` component (existing primitive)                          |
| TagBlock        | N/A (not an editor block)                                 | `Tag` component (existing primitive)                           |
| EmbedBlock      | EmbedEditor (entity picker)                               | `EmbedRenderer` widget                                         |
| CalloutBlock    | CalloutEditor (variant picker)                            | `Alert` component (existing primitive, maps well)              |
| DividerBlock    | HorizontalRuleEditor (style picker)                       | `Divider` component (existing primitive)                       |
| CollectionBlock | Built-in Lexical root node                                | Layout component (`Grid`, `List`, etc.)                        |

### $query integration

Display components are consumed via `$query` in schema templates:

```json
{
  "type": "$each",
  "source": { "$query": { "model": "AudioBlock", "parent": { "id": "...", "predicate": "we://children" } } },
  "children": [
    {
      "type": "AudioPlayer",
      "props": {
        "title": "$item.title",
        "artist": "$item.artist",
        "src": "$item.audioUrl"
      }
    }
  ]
}
```

This closes the loop: blocks are created in the editor, persisted to AD4M with parent-child relationships, queried via `$query`, and rendered by display components.

---

## 3. Implementation Plan

### Phase 1: Investigate Ad4mModel polymorphic @HasMany

- [ ] Test whether `@HasMany(() => WeNode)` hydrates correct subclasses
- [ ] If not, investigate discriminator options or manual hydration fallback
- [ ] Document findings

### Phase 2: Parent-child persistence

- [ ] Add `@HasMany(() => WeNode, { through: 'we://children' })` to CollectionBlock
- [ ] Refactor `createBlocks()` to link children to parents
- [ ] Add `loadBlocks()` function to reconstruct block tree from AD4M
- [ ] Verify round-trip: create in editor → save → load → display in editor

### Phase 3: Display components (incremental)

- [ ] Identify which existing design-system components map directly to block types
- [ ] Create display components for block types that need new components
- [ ] Place in `@we/components` (simple) or `@we/widgets` (complex/interactive)
- [ ] Each component is a standalone deliverable — no big-bang required

### Phase 4: Schema integration

- [ ] Wire display components into component registry for schema rendering
- [ ] Create example schema templates that use `$query` + block display components
- [ ] Document the block→schema rendering pattern

### Not in scope

- CRDT ordering implementation (AD4M-side work, see ordering strategy doc)
- TableBlock (complex Lexical integration)
- Custom store for drag-and-drop block reordering in the editor

---

## Risks

| Risk                                                      | Mitigation                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| Ad4mModel doesn't support polymorphic @HasMany            | Manual hydration fallback using registry + perspective.get()               |
| Ordering breaks without CRDT strategy                     | Timestamp-based creation order is sufficient for initial implementation    |
| Display component explosion (15 block types × components) | Most map to existing design-system primitives; only ~5 need new components |
