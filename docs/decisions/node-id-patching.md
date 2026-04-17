# Decision: Node ID-Based Patching for AI Schema Editing

## Status

**Proposed** — ready for implementation.

## Context

The AI chat editor modifies templates by sending `update_schema` tool calls with a `patches` array. Each patch currently uses a **numeric path** to address the target node:

```json
{ "path": [-1, 2, 0, 0], "node": { "type": "Column", ... } }
```

Where each integer indexes into `children` arrays and `-1` signals entry into a `routes` array.

### The Problem

LLMs consistently fail at computing numeric index paths:

1. **Route index off-by-one** — the AI confuses tab position with route array index, forgetting that a default `"/"` route at index 0 shifts all other indices.
2. **Children index miscounting** — the AI miscounts how many children a node has, producing a path that points past the end of the array or into a text node.
3. **Strings in paths** — the AI sometimes emits `[-1, 1, "children", 0]` instead of `[-1, 1, 0]`, including literal `"children"` and `"routes"` strings in what must be an integer-only array.

These are all index arithmetic errors — exactly what LLMs are worst at. The AI consistently knows _what_ to target ("the `$each` inside the Posts route") but fails at _computing the address_. Attempts to mitigate with chain-of-thought prompting reduced but did not eliminate the errors.

### Root Cause

Numeric index paths are hostile to LLMs. They require counting from zero in nested arrays, tracking which dimension (children vs. routes) each number refers to, and accounting for invisible structural nodes (default routes, wrapper Columns). This is a design problem, not a prompt engineering problem.

## Decision

Replace numeric path-based patching with **node ID-based patching**. Every `SchemaNode` gets a short, persistent `id` field. The AI addresses nodes by copying the `id` it sees in `currentSchema` — no arithmetic required.

### Before (numeric paths)

```json
{
  "patches": [
    { "path": [-1, 2, 0, 0], "node": { "type": "$each", ... } }
  ]
}
```

AI must derive: routes[0]="/", routes[1]="/about", routes[2]="/posts" → index 2 → children[0] → children[0] → path `[-1, 2, 0, 0]`

### After (node IDs)

```json
{
  "patches": [
    // Update a node (merge — absent keys preserved, null deletes)
    { "targetId": "n14", "node": { "props": { "gap": "lg" } } },
    { "targetId": "n5", "node": { "props": { "color": null } } },

    // Insert a new child (append, or position relative to a sibling)
    { "targetId": "n1", "insert": { "children": { "node": { "type": "we-text", ... } } } },
    { "targetId": "n1", "insert": { "children": { "node": { "type": "we-text", ... }, "after": "n5" } } },

    // Remove a child or route by its id
    { "targetId": "n1", "remove": { "children": "n7" } }
  ]
}
```

AI just finds the node in `currentSchema`, copies its `"id"` — no arithmetic. Update merges only the keys provided. Insert and remove target the **parent** and reference **sibling IDs** for positioning.

## Implementation Plan

### 1. Add `id` to SchemaNode type

**File:** `packages/schema-system/shared/src/types.ts`

Add `id?: string` to the `SchemaNode` type. This makes IDs a first-class optional field on every node, including route nodes (which extend `SchemaNode`).

### 2. Update Zod schemas to allow `id`

**File:** `packages/schema-system/shared/src/zodSchemas.ts`

Add `id: z.string().optional()` to `schemaNodeShape()`. Since `zSchemaNode`, `zTemplateSchema`, and `zRouteSchema` all use `.strict()`, the field must be declared or structural validation will reject nodes with `id` fields.

(Remove the existing `id: z.string().optional()` from `zTemplateSchema`'s explicit shape since it will now come from `schemaNodeShape()`.)

### 3. Create `ensureNodeIds` utility

**File:** `packages/schema-system/shared/src/indexer.ts` (alongside existing tree utilities)

```
ensureNodeIds(schema: SchemaNode): SchemaNode
```

- Walks the full tree (children, routes, slots)
- Assigns a short unique ID (e.g. `"n1"`, `"n2"`, ..., counter-based) to any node missing an `id`
- **Deduplicates**: if a node's `id` was already seen earlier in the walk, reassign it a new unique ID. This prevents collisions from copy-paste, template merges, or the AI accidentally reusing an existing ID on a new node.
- Returns the schema (mutates in place for simplicity, since callers already clone)
- Algorithm:
  1. First pass: collect all existing IDs, find max numeric suffix
  2. Set counter = max + 1
  3. Walk tree: no id → assign `"n{counter++}"`. Duplicate id (seen before) → reassign `"n{counter++}"`. Unique id → keep, add to seen set.

### 4. Create `findNodeById` utility

**File:** `packages/schema-system/shared/src/indexer.ts`

```
findNodeById(schema: SchemaNode, targetId: string): { node: SchemaNode, parent: SchemaNode | null, key: 'children' | 'routes' | 'slots', index: number } | null
```

- Walks the tree looking for a node with the given `id`
- Searches `children`, `routes`, **and `slots`** (slot values are arrays of SchemaNodes that also have IDs)
- Returns the node, its parent, which array it lives in (`children`, `routes`, or `slots` — for slots, `key` includes the slot name e.g. `slots.header`), and its index within that array
- Used by replace, insert, and remove operations
- For root targeting (`targetId: ""`), return `null` (caller handles root as a special case)

### 5. Create `mergeNode` utility

**File:** `packages/schema-system/shared/src/indexer.ts`

```
mergeNode(existing: SchemaNode, patch: Partial<SchemaNode>): SchemaNode
```

Implements JSON Merge Patch (RFC 7396) semantics at one level deep on the node:

- For each key in `patch`:
  - If value is `null` → delete that key from the result
  - If value is an array (e.g. `children`, `routes`) → **replace** the existing array entirely (do not merge element-by-element)
  - If value is a plain object and the existing key is also a plain object (e.g. `props`) → shallow-merge (patch keys override, absent keys preserved, `null` deletes)
  - Otherwise → override the existing value
- Keys absent from `patch` are preserved from `existing`
- Always preserves `id` from the existing node (AI can't change/remove IDs)

Examples:

- `mergeNode(existing, { props: { gap: "lg" } })` → updates `gap`, preserves all other props, preserves children/routes
- `mergeNode(existing, { props: { color: null } })` → removes `color`, preserves everything else
- `mergeNode(existing, { children: [...] })` → replaces children entirely (intentional full replacement)

### 6. Create `insertChild` and `removeChild` utilities

**File:** `packages/schema-system/shared/src/indexer.ts`

```
insertChild(schema: SchemaNode, parentId: string, arrayKey: 'children' | 'routes', node: SchemaNode, position?: { after: string } | { before: string }): SchemaNode
removeChild(schema: SchemaNode, parentId: string, arrayKey: 'children' | 'routes', childId: string): SchemaNode
```

**`insertChild`:**

- Finds the parent by `parentId` (supports `""` for root)
- If no `position`, appends `node` to the end of `parent[arrayKey]`
- If `{ after: "n5" }`, finds the sibling with that ID and splices after it
- If `{ before: "n5" }`, finds the sibling and splices before it
- If the sibling ID is not found, returns an error

**`removeChild`:**

- Finds the parent by `parentId` (supports `""` for root)
- Finds the child with `childId` in `parent[arrayKey]` and removes it
- If the child ID is not found, returns an error

### 7. Update `update_schema` tool definition

**File:** `packages/app-framework/src/frameworks/solid/stores/AiStore.tsx`

Replace the current tool schema with three patch types:

```typescript
patches: {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      targetId: { type: 'string', description: 'The id of the node to target. Use "" for root.' },
      // Update: merge into existing node (absent keys preserved, null deletes)
      node: { type: 'object', description: 'Partial node to merge. Absent keys preserved, null deletes a key. Mutually exclusive with insert/remove.' },
      // Insert: add a child or route to a parent
      insert: {
        type: 'object',
        properties: {
          children: { type: 'object', properties: {
            node: { type: 'object', description: 'The new node to insert.' },
            after: { type: 'string', description: 'ID of sibling to insert after. Omit to append.' },
            before: { type: 'string', description: 'ID of sibling to insert before.' }
          }},
          routes: { /* same shape */ }
        },
        description: 'Insert into children or routes array.'
      },
      // Remove: delete a child or route by ID
      remove: {
        type: 'object',
        properties: {
          children: { type: 'string', description: 'ID of child to remove.' },
          routes: { type: 'string', description: 'ID of route to remove.' }
        },
        description: 'Remove from children or routes array by child ID.'
      }
    },
    required: ['targetId']
  }
}
```

Each patch must have exactly one of `node`, `insert`, or `remove`. Validation rejects patches with multiple or none.

### 8. Update patch handling in AiStore

**File:** `packages/app-framework/src/frameworks/solid/stores/AiStore.tsx`

In `sendViaClaude()`:

1. Before sending `currentSchema` to the AI, run `ensureNodeIds()` on it. This guarantees every node the AI sees has an `id`.
2. When receiving patches, dispatch based on which key is present:
   - **`node`** — find node via `findNodeById()`, apply `mergeNode(existing, patch)`. Absent keys preserved, `null` deletes. For root (`targetId: ""`), merge into the root schema.
   - **`insert`** — call `insertChild(schema, targetId, arrayKey, newNode, position)`.
   - **`remove`** — call `removeChild(schema, targetId, arrayKey, childId)`.
3. If `targetId` is `""` (empty string), treat as root.
4. If the target node is not found, return a tool error: `"No node with id \"${targetId}\" found in the current schema."`.
5. If an `insert`/`remove` references a sibling/child ID that doesn't exist, return a tool error with the missing ID.
6. After all patches applied, run `ensureNodeIds()` on the result to assign IDs to any new nodes.
7. **Post-patch validation**: run Zod structural validation on the final schema. If it fails (e.g. a merge produced an invalid node, or a type change left incompatible children), return a tool error with the validation message so the AI can self-correct.

### 9. Simplify system prompt

**File:** `packages/app-framework/src/shared/prompts/chatSystemPrompt.ts`

Replace the entire path-counting section with:

```
### How patching works

Every node in currentSchema has an "id" field (e.g. "n1", "n14", "n23").
Do NOT invent IDs for new nodes — the system assigns them automatically.

**Update** a node (merge):
  { "targetId": "n14", "node": { "type": "Column", "props": { "gap": "md" } } }
  Merge semantics (JSON Merge Patch):
  - Keys present in the patch OVERRIDE the original.
  - Keys ABSENT from the patch are PRESERVED (e.g. existing children stay).
  - Keys set to null are REMOVED (e.g. { "props": { "color": null } } deletes color).
  - To replace children/routes entirely, include them. To leave them unchanged, omit them.

**Insert** a child or route:
  { "targetId": "n1", "insert": { "children": { "node": { ... } } } }                 ← append
  { "targetId": "n1", "insert": { "children": { "node": { ... }, "after": "n5" } } }   ← after sibling
  { "targetId": "n1", "insert": { "children": { "node": { ... }, "before": "n5" } } }  ← before sibling
  Use "routes" instead of "children" to insert a route.

**Remove** a child or route:
  { "targetId": "n1", "remove": { "children": "n7" } }     ← remove child by its id
  { "targetId": "n1", "remove": { "routes": "n12" } }      ← remove route by its id

Use targetId "" (empty string) to target the root node.
Each patch must have exactly one of: node, insert, remove.
Patches are applied sequentially — if you remove a node, later patches in the same call cannot reference its id.
```

Remove: path format docs, `-1` marker explanation, valid/invalid path examples, chain-of-thought derivation instruction. All replaced by "copy the id you see in the schema."

### 10. Remove dead code

**File:** `packages/schema-system/shared/src/indexer.ts`

Remove `validatePatches` and `patchByPath` — both are replaced by the ID-based utilities (`findNodeById`, `insertChild`, `removeChild`). Replace patches use direct assignment via the parent/key/index returned by `findNodeById`.

### 11. Update semantic validation

**File:** `packages/schema-system/shared/src/semanticValidation.ts`

Add `id` to the set of allowed node fields so the semantic validator doesn't warn about unknown properties. (The structural validator already handles this via the Zod schema update in step 2.)

### 12. Unit tests

**File:** `packages/schema-system/shared/src/__tests__/nodeIdPatching.test.ts`

Critical-path tests for each new utility:

**`ensureNodeIds`:**

- Assigns IDs to a tree with no existing IDs
- Preserves existing IDs, fills gaps
- Deduplicates: two nodes with same ID → second gets reassigned
- Counter starts from max existing suffix + 1
- Walks children, routes, and slots

**`findNodeById`:**

- Finds a node in children, routes, and slots
- Returns correct parent, key, and index
- Returns `null` for unknown ID
- Returns `null` for `""`

**`mergeNode`:**

- Absent keys preserved from existing
- Present keys override existing
- `null` deletes a key
- Nested object (props) shallow-merges: absent sub-keys preserved, `null` sub-keys deleted
- Array values (children) replace entirely, not element-merged
- `id` always preserved from existing node

**`insertChild`:**

- Append (no position)
- Insert after sibling
- Insert before sibling
- Error on unknown sibling ID
- Works with `""` (root) as parent

**`removeChild`:**

- Remove by child ID
- Error on unknown child ID
- Works with `""` (root) as parent

## Files Changed

| File                                                                 | Change                                                                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/schema-system/shared/src/types.ts`                         | Add `id?: string` to `SchemaNode`                                                                                                                  |
| `packages/schema-system/shared/src/zodSchemas.ts`                    | Add `id` to `schemaNodeShape()`, remove from `zTemplateSchema`                                                                                     |
| `packages/schema-system/shared/src/indexer.ts`                       | Add `ensureNodeIds()` (with dedup), `findNodeById()`, `mergeNode()`, `insertChild()`, `removeChild()`. Remove `validatePatches()`, `patchByPath()` |
| `packages/schema-system/shared/src/semanticValidation.ts`            | Allow `id` field on nodes                                                                                                                          |
| `packages/schema-system/shared/src/__tests__/nodeIdPatching.test.ts` | Unit tests for all new utilities                                                                                                                   |
| `packages/app-framework/src/frameworks/solid/stores/AiStore.tsx`     | Update tool def (3 patch types), dispatch by patch type, call `ensureNodeIds`, post-patch validation                                               |
| `packages/app-framework/src/shared/prompts/chatSystemPrompt.ts`      | Replace path instructions with ID + insert/remove instructions                                                                                     |

## Tradeoffs

### Benefits

- **Eliminates all path-counting errors** — the AI copies a string, no arithmetic.
- **Eliminates child-reproduction errors** — `insert` adds a child without the AI needing to reproduce all existing siblings. `remove` deletes by ID, not index. `node` merge preserves absent keys, so changing one prop doesn't require reproducing children.
- **System prompt gets shorter** — fewer tokens per request, lower cost.
- **Simpler mental model** — "find the node, copy its id" vs. "count children arrays from root, remember -1 for routes."
- **Zero-counting design** — every operation (replace, insert, remove) uses IDs exclusively. No numeric indices anywhere in the AI-facing API.
- **IDs survive restructuring** — stable across reordering, adding/removing siblings.
- **Future-proof** — IDs are useful for undo history, drag-and-drop, collaboration, and the section indexer.

### Costs

- **~10 extra characters per node** — `"id":"n14"` on every node. A 50-node schema adds ~500 chars. Negligible vs. the thousands already in the schema.
- **New nodes lack IDs until post-patch** — the AI can't reference a node it just created in the same patch. This is the same limitation as today (can't reference a new path that doesn't exist yet). Workaround: use `insert` to add the child (it doesn't need an ID for the new node — the system assigns one post-patch).
- **Merge semantics require `null` for deletion** — omitting a key preserves it, so the AI must explicitly set a key to `null` to remove it. This is well-understood (JSON Merge Patch, RFC 7396) and natural for LLMs.
- **Migration** — existing saved schemas have no inner node IDs. `ensureNodeIds` handles this transparently on first load. No migration script needed.

## What This Does NOT Change

- **Schema renderer** — ignores `id` (it's not a rendered prop).
- **Structural/semantic validation** — unchanged except allowing the `id` field.
- **Template storage** — IDs persist in the schema blob alongside all other fields.
- **AI context fragments** — no changes needed (they describe schema authoring patterns, not patching mechanics).

## Future: Property-Level `set` Patches

**Status: No longer planned.** Merge semantics on `node` replacement handle all the use cases that `set` was designed for:

- Change a prop → `{ node: { props: { label: "Articles" } } }` (other props preserved)
- Delete a prop → `{ node: { props: { color: null } } }` (null = delete)
- Change type → `{ node: { type: "Row" } }` (children/props preserved)

Since absent keys are preserved and `null` deletes, there's no need for a separate dot-path `set` operation. The three patch types (node/insert/remove) cover the full spectrum of edits.
