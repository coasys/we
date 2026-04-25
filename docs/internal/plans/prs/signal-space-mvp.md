# Plan: Signal Space MVP Integration

> **Goal:** Get a live, persisted signal (e.g. "Like") working end-to-end in WE — viewable and interactive from SpacePage — using the existing `Signal`/`SignalType` models and `SignalControl` component, with signal state delivered via AD4M `include` projections on the `$query` token.

---

## Current State

### What already exists
| Item | Location | Status |
|------|----------|--------|
| `Signal` model | `packages/models/src/entities/Signal.ts` | ✅ |
| `SignalType` model | `packages/models/src/entities/SignalType.ts` | ✅ |
| `WeNode.signals: string[]` | `packages/models/src/WeNode.ts` | ✅ (predicate `we://has_signals`) |
| `SignalControl` component | `4-components/.../signals/SignalControl/` | ✅ |
| `SignalBar` widget | `5-widgets/.../signals/SignalBar/` | ✅ (remove, no longer needed) |
| `aggregateSignals` utility | `packages/models/src/utils/signalAggregate.ts` | ✅ |
| `SpaceStore` | `packages/app-framework/.../stores/SpaceStore.tsx` | ✅ (no signal actions yet) |
| `include` projection in AD4M `$query` | `ad4m/core` `feat/include-projections` branch | ✅ built + installed |

---

## Key Architecture Decisions

### 1. SignalBar — removed from MVP schema

The existing `SignalBar` widget is a convenience wrapper around a row of `SignalControl`s. For the schema, we compose it directly with a `Row` + `SignalControl` children — this is more flexible and less opaque. `SignalBar` gets removed.

### 2. `$create` token — does not exist, keep model creation in stores

The schema system has no `$create` token. Model instantiation from a schema must go through a store action (`$action: 'spaceStore.createSignalType'`). This is the right call for the following reasons:

- Store actions have access to the `PerspectiveProxy` (ambient context the schema doesn't hold)
- Schema validation (`checkActionRef`) validates `$action` references at build time — direct model calls would be unvalidated
- Business logic (upsert semantics, SHACL registration, author-checking) belongs in the store, not scattered across schema definitions

**Adding `$create` to the schema language is not recommended.** The current design correctly keeps model persistence bound to stores. If templates need to feel less tied to specific store names, that's addressed by schema parameterisation (store name as a variable) rather than bypassing the store layer.

### 3. Getting signal state per post — `include` projections

Rather than preloading all signals centrally in the store (expensive) or subscribing per post (N queries), we use the `include` projections we built in `feat/include-projections`:

```ts
{
  $query: {
    model: 'CollectionBlock',
    where: { type: 'root' },
    subscribe: true,
    include: {
      $totalLikeCount: { from: 'signals', where: { signalTypeId: 'like' }, count: true },
      $myLikeSignal:   { from: 'signals', where: { signalTypeId: 'like', author: '$me' }, limit: 1 },
      $likeSignals:    { from: 'signals', where: { signalTypeId: 'like' } },
    },
  },
}
```

Each `CollectionBlock` item returned from the query will have `$totalLikeCount: number`, `$myLikeSignal: Signal | null`, `$likeSignals: Signal[]` merged onto it. The schema can then pass these directly to `SignalControl` props:

```ts
{
  type: 'SignalControl',
  props: {
    signalType:  { icon: '❤️', display: 'icon', rangeMin: 0, rangeMax: 1 },
    myValue:     '$post.$myLikeSignal.value',
    aggregate:   '$post.$totalLikeCount',
    onSignal:    { $action: 'spaceStore.upsertSignal', args: ['$post.id', 'like', '$arg'] },
  },
}
```

**How `include` flows through the schema system:**

1. The `$query` token is NOT handled by the `resolveProp` dispatcher — it's handled directly by `SchemaRenderer.tsx`'s `createQuerySignal`
2. `resolveQueryProp` strips `model`/`subscribe`/`perspectiveStore` and puts everything else (including `include`) into `descriptor.params`
3. `createQuerySignal` passes `descriptor.params` directly to `ModelClass.query(p, params)` or `ModelClass.findAll(p, params)`
4. `findAll` passes `query.include` to `hydrateRelations` after SPARQL results are materialised
5. Projection keys (`$totalLikeCount`, etc.) are merged onto each instance

**`$store` tokens inside `include.where`:**

`descriptor.params` is passed **as-is** to the model — `$store` tokens inside nested `where` objects are not resolved by the schema system. To avoid this, projection `where` clauses should use only literal values or special shorthand tokens evaluated server-side.

For `author: currentUserDid`, the right long-term fix is a `deepResolveTokens(params, stores, context)` call inside `createQuerySignal`'s `createEffect`, which deep-walks only `descriptor.params` and evaluates any `$store`/`$local` tokens before passing to the model. **This is surgically scoped to `descriptor.params` — it never touches the broader schema tree**, which continues to be processed by the normal `resolveProp`/dispatcher pipeline. The two paths are entirely separate:

- Schema tree → `renderNode` → `resolveProp` → dispatcher (handles `$store`, `$local`, `$action`, etc.)
- `$query` token → `createQuerySignal` → `descriptor.params` only

Since `createQuerySignal` already runs inside a Solid `createEffect`, any signal reads made during token resolution are auto-tracked as reactive deps at zero extra cost. Re-runs trigger `onCleanup(() => builder.dispose())` before re-firing, so subscription management is already correct.

**→ `deepResolveTokens` is part of this PR (Step 6 below). Once in place, `$myLikeSignal` uses `{ author: { $store: 'adamStore.me.did' } }` to filter to the current user's signal directly in the projection.**

---

## Implementation Steps

### Step 1 — Register Signal + SignalType models

**File:** `packages/app-framework/src/frameworks/solid/stores/SpaceStore.tsx`

Two additions:
1. At module scope, alongside existing `registerModel` calls:
```ts
registerModel('Signal', Signal as any);
registerModel('SignalType', SignalType as any);
```
2. Inside `getSpace()`, add to the parallel SHACL registration:
```ts
await Promise.all([
  CollectionBlock.register(spacePerspective),
  TextBlock.register(spacePerspective),
  ImageBlock.register(spacePerspective),
  Signal.register(spacePerspective),
  SignalType.register(spacePerspective),
]);
```

---

### Step 2 — Add `createSignalType` action

**File:** `packages/app-framework/src/frameworks/solid/stores/SpaceStore.tsx`

Store interface addition:
```ts
createSignalType: (config: Partial<SignalType>) => Promise<void>;
```

Implementation:
```ts
async function createSignalType(config: {
  name: string; icon: string; display: string;
  aggregate: string; rangeMin: number; rangeMax: number;
}): Promise<void> {
  const p = perspective();
  if (!p) return;
  await SignalType.create(p, config);
  // No reactive state needed — SignalType list is driven by $query in the schema (subscribe: true)
}
```

---

### Step 3 — Add `upsertSignal` action

**File:** `packages/app-framework/src/frameworks/solid/stores/SpaceStore.tsx`

Store interface addition:
```ts
upsertSignal: (nodeId: string, signalTypeId: string, value: number) => Promise<void>;
```

Implementation:
```ts
async function upsertSignal(nodeId: string, signalTypeId: string, value: number): Promise<void> {
  const p = perspective();
  const myDid = adamStore.me()?.did;
  if (!p || !myDid) return;

  // Find this user's existing signal on this node for this type
  // Signals are linked from the node via we://has_signals
  const nodeLinks = await p.get({ source: nodeId, predicate: 'we://has_signals' });
  const myLinks = nodeLinks.filter(l => l.author === myDid);

  for (const link of myLinks) {
    // Load the Signal instance
    const [existing] = await Signal.findAll(p, { where: { id: link.data.target, signalTypeId } });
    if (existing) {
      if (existing.value === value) {
        // Toggle off — remove the link and the signal
        await p.remove(link.data);
      } else {
        existing.value = value;
        await existing.save();
      }
      return;
    }
  }

  // No existing signal — create new, linked to node atomically via parent param
  await Signal.create(
    p,
    { signalTypeId, value },
    { parent: { id: nodeId, predicate: 'we://has_signals' } },
  );
}
```

---

### Step 4 — Schema: Signals management tab

**File:** `packages/app-framework/src/shared/schemas/DefaultTemplate/SpacePage.ts`

**4a.** Add a "Signals" tab button alongside About/Posts/Members:
```ts
{
  type: 'we-tab',
  props: {
    key: 'signals',
    label: 'Signals',
    onClick: { $action: 'routeStore.navigate', args: ['./signals'] },
  },
},
```

**4b.** Add a `/signals` subroute with create modal and list:
```ts
{
  path: '/signals',
  type: 'Column',
  props: { gap: '400' },
  $localState: {
    createOpen:   { type: 'boolean', initial: false },
    newName:      { type: 'string',  initial: '' },
    newIcon:      { type: 'string',  initial: '❤️' },
    newDisplay:   { type: 'string',  initial: 'icon' },
    newAggregate: { type: 'string',  initial: 'count' },
    newRangeMin:  { type: 'number',  initial: 0 },
    newRangeMax:  { type: 'number',  initial: 1 },
  },
  children: [
    // Header
    {
      type: 'Row',
      props: { ax: 'between', ay: 'center' },
      children: [
        { type: 'we-text', props: { fontSize: '600', fontWeight: 'bold' }, children: ['Signal Types'] },
        {
          type: 'we-button',
          props: {
            text: 'Add Signal Type', bg: 'primary-500', color: 'neutral-0',
            height: '40px', width: 'fit-content',
            onClick: { $setLocal: 'createOpen', value: true },
          },
        },
      ],
    },

    // Existing signal types list (driven by $query — no store state needed)
    {
      type: '$each',
      props: {
        items: { $query: { model: 'SignalType', subscribe: true } },
        as: 'signalType',
      },
      children: [
        {
          type: 'Row',
          props: { p: '300', r: '300', bg: 'neutral-100', gap: '300', ay: 'center' },
          children: [
            { type: 'we-text', props: { fontSize: '500' }, children: ['$signalType.icon'] },
            {
              type: 'Column', props: { gap: '50' },
              children: [
                { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['$signalType.name'] },
                { type: 'we-text', props: { fontSize: '300', color: 'neutral-400' }, children: ['$signalType.display'] },
              ],
            },
            // Preview the control (no state = preview mode)
            {
              type: 'SignalControl',
              props: {
                signalType: {
                  icon: '$signalType.icon', display: '$signalType.display',
                  rangeMin: '$signalType.rangeMin', rangeMax: '$signalType.rangeMax',
                },
                myValue: null, aggregate: 0,
                onSignal: null, // preview only
              },
            },
          ],
        },
      ],
    },

    // Create modal
    {
      type: '$if',
      props: {
        condition: { $local: 'createOpen' },
        then: {
          type: 'we-modal',
          props: { close: { $setLocal: 'createOpen', value: false }, maxWidth: '500px', width: '100%' },
          children: [
            { type: 'we-text', props: { fontSize: '600', fontWeight: 'bold' }, children: ['New Signal Type'] },
            { type: 'we-input', props: { label: 'Name', placeholder: 'e.g. Like', value: { $local: 'newName' }, onInput: { $setLocal: 'newName', from: '$event.target.value' } } },
            { type: 'we-input', props: { label: 'Icon (emoji)', value: { $local: 'newIcon' }, onInput: { $setLocal: 'newIcon', from: '$event.target.value' } } },
            { type: 'we-select', props: { label: 'Display', value: { $local: 'newDisplay' }, onChange: { $setLocal: 'newDisplay', from: '$event.target.value' }, options: [
              { label: 'Icon (toggle)', value: 'icon' },
              { label: 'Up / Down', value: 'vertical-icons' },
              { label: 'Star rating', value: 'horizontal-icons' },
              { label: 'Slider', value: 'slider' },
            ]} },
            { type: 'we-select', props: { label: 'Aggregate', value: { $local: 'newAggregate' }, onChange: { $setLocal: 'newAggregate', from: '$event.target.value' }, options: [
              { label: 'Count', value: 'count' },
              { label: 'Sum', value: 'sum' },
              { label: 'Mean', value: 'mean' },
              { label: 'Median', value: 'median' },
            ]} },
            // Live preview updates as the user types
            {
              type: 'SignalControl',
              props: {
                signalType: {
                  icon: { $local: 'newIcon' }, display: { $local: 'newDisplay' },
                  rangeMin: { $local: 'newRangeMin' }, rangeMax: { $local: 'newRangeMax' },
                },
                myValue: null, aggregate: 0, onSignal: null,
              },
            },
            {
              type: 'Row',
              props: { gap: '300', ax: 'end', mt: '200' },
              children: [
                { type: 'we-button', props: { variant: 'ghost', text: 'Cancel', onClick: { $setLocal: 'createOpen', value: false } } },
                {
                  type: 'we-button',
                  props: {
                    text: 'Create', bg: 'primary-500', color: 'neutral-0', height: '40px',
                    onClick: [
                      {
                        $action: 'spaceStore.createSignalType',
                        args: [{
                          name: { $local: 'newName' }, icon: { $local: 'newIcon' },
                          display: { $local: 'newDisplay' }, aggregate: { $local: 'newAggregate' },
                          rangeMin: { $local: 'newRangeMin' }, rangeMax: { $local: 'newRangeMax' },
                        }],
                      },
                      { $setLocal: 'createOpen', value: false },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    },
  ],
},
```

---

### Step 5 — Schema: SignalControl on post cards (using `include` projections)

**File:** `packages/app-framework/src/shared/schemas/DefaultTemplate/SpacePage.ts`

The `$query` for posts gets an `include` block that injects projection data onto each item. The SignalType IDs used in `where.signalTypeId` should match the `id` (base expression URI) of persisted `SignalType` instances. For MVP with a well-known "Like" type, either hardcode the URI or use a constant. Once the SignalType management tab is wired, these can become dynamic.

```ts
// BEFORE:
{
  type: '$each',
  props: {
    items: { $query: { model: 'CollectionBlock', where: { type: 'root' }, subscribe: true } },
    as: 'post',
  },
  children: [
    {
      type: 'Column',
      props: { width: '100%', bg: 'neutral-25', p: '600', r: '400' },
      children: [
        { type: 'BlockRenderer', props: { post: '$post.editorState' } },
      ],
    },
  ],
},

// AFTER:
{
  type: '$each',
  props: {
    items: {
      $query: {
        model: 'CollectionBlock',
        where: { type: 'root' },
        subscribe: true,
        include: {
          $totalLikeCount: { from: 'signals', where: { signalTypeId: 'like' }, count: true },
          $myLikeSignal:   { from: 'signals', where: { signalTypeId: 'like', author: { $store: 'adamStore.me.did' } }, limit: 1 },
          // ^ author filter resolved by deepResolveTokens in SchemaRenderer (Step 6)
        },
      },
    },
    as: 'post',
  },
  children: [
    {
      type: 'Column',
      props: { width: '100%', bg: 'neutral-25', r: '400', overflow: 'hidden' },
      children: [
        {
          type: 'Column', props: { p: '600' },
          children: [
            { type: 'BlockRenderer', props: { post: '$post.editorState' } },
          ],
        },
        {
          type: 'Row',
          props: { px: '600', py: '300', borderTop: '1px solid', borderColor: 'neutral-100' },
          children: [
            {
              type: 'SignalControl',
              props: {
                signalType: { icon: '❤️', display: 'icon', rangeMin: 0, rangeMax: 1 },
                myValue:    '$post.$myLikeSignal.value',
                aggregate:  '$post.$totalLikeCount',
                onSignal:   { $action: 'spaceStore.upsertSignal', args: ['$post.id', 'like', '$arg'] },
              },
            },
          ],
        },
      ],
    },
  ],
},
```

---

### Step 6 — `deepResolveTokens` in SchemaRenderer

**File:** `packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx`

Currently, `resolveQueryProp` passes `descriptor.params` as-is to `ModelClass.query`. Any `{ $store: '...' }` tokens inside `include[*].where` are passed literally to the model layer and ignored.

Add a `deepResolveTokens(params, stores, context)` helper that deep-walks **only `descriptor.params`** and evaluates any `$store`/`$local` tokens before passing to the model. This is surgically scoped — it never touches the rest of the schema tree, which continues through the normal `resolveProp`/dispatcher pipeline unchanged.

Since `createQuerySignal` already runs inside a Solid `createEffect`, signal reads made during token resolution are auto-tracked as reactive deps for free. Re-runs trigger the existing `onCleanup(() => builder.dispose())` before re-firing — no extra subscription management needed.

```ts
// In createQuerySignal, inside createEffect, before calling ModelClass.query:
const resolvedParams = deepResolveTokens(descriptor.params, stores as Props, {});
const builder = ModelClass.query(p, resolvedParams) as ...;
```

With this in place, `include.where` can use `$store` tokens directly:
```ts
$myLikeSignal: { from: 'signals', where: { signalTypeId: 'like', author: { $store: 'adamStore.me.did' } }, limit: 1 }
```

---

## Open Questions / Risks

1. **`$myLikeSignal.value` when no signal exists** — `limit: 1` returns `null` when no signal was found. The `'$post.$myLikeSignal.value'` string interpolation needs to safely return `null` (not throw) when `$myLikeSignal` is `null`. Verify the dispatcher's dot-path resolver handles `null` mid-path gracefully.

2. **Concurrent devices / duplicate signals** — AD4M `p.add()` is not transactional. Two tabs could create duplicate `Signal` links. Accept for MVP; address later with last-writer-wins merge strategy.

4. **`signalTypeId: 'like'` coupling** — hardcoding `'like'` in the schema ties the include projection to a specific SignalType identifier. Once the Signals management tab exists, this should be replaced with the persisted SignalType's base expression URI; or the SignalType can be seeded with a stable well-known ID.

5. **SHACL registration delay** — `getSpace()` has a 500ms fixed delay after SHACL registration. Adding Signal + SignalType registration should be fine, but watch for race conditions if `$query` fires before schemas are registered.

---

## Implementation Order

```
1. SpaceStore: register Signal + SignalType (registerModel + SHACL)
2. SpaceStore: add createSignalType action
3. SpaceStore: add upsertSignal action
4. SpacePage schema: add Signals tab + /signals subroute (Step 4)
5. SpacePage schema: add include projections + SignalControl on post cards (Step 5)
6. SchemaRenderer: add deepResolveTokens for $store/$local tokens in descriptor.params
7. Manual test cycle:
   a. Open a space, go to Signals tab
   b. Create a "Like" signal type
   c. Go to Posts tab — confirm SignalControl renders on each post
   d. Click Like on a post — confirm Signal instance persists
   e. Reload — confirm Like count and myValue restore from projection
   f. Confirm only current user's Like is highlighted (author filter via $store)
```
