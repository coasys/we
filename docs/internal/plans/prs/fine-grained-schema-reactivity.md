# Plan: Fine-Grained Schema Reactivity

## Problem

The schema renderer resolves and distributes props through a single `createMemo` chain:

```ts
// ONE memo resolves ALL props — reads every store signal referenced in the schema node
const split = createMemo(() => splitProps(resolveProps(node.props, stores, context, createMemo)));

// ONE memo builds the entire attrs object — calls split(), touching all dependencies
const reactiveAttrs = createMemo(() => {
  const { safeProps, complexProps } = split();
  // ... builds single attrs object from all props
  return attrs;
});

// Spread as single expression
<Dynamic {...reactiveAttrs()} />
```

**Consequence:** Changing `spaceStore.showSkybox` re-evaluates *every* prop for *every* component in the schema tree that touches `spaceStore`, even if most props didn't change. SolidJS's `<Dynamic>` does shallow-diff the spread, so unchanged DOM attributes aren't re-applied — but the resolver + unwrap work runs unnecessarily.

### Current cost model

| What happens on a single store change | Cost |
|---|---|
| `resolveProps` re-runs for every node reading that store | Walks all props, resolves all tokens |
| `splitProps` re-runs | Iterates all resolved props |
| `deepUnwrap` re-runs on all complex props | Walks nested objects/arrays |
| `reactiveAttrs` returns new object | Solid diffs against previous |
| `createEffect` (web components) re-runs | Sets all complex + camelCase props |

For simple templates (10-20 nodes, 3-5 props each) this is negligible. For large templates (100+ nodes, complex layer configs, data tables) it becomes measurable.

### After: cost model with stable bindings + per-prop memos

| What happens on a single store change | Cost |
|---|---|
| Stable binding fires (inner memo from setup) | One path walk for the changed prop only |
| Per-prop memo re-evaluates | `deepUnwrap` on one prop's value |
| `reactiveAttrs` re-runs if memo value changed | Shallow object construction |
| `<Dynamic>` shallow-diffs | Key comparison (inherent, unavoidable) |
| Other props' memos | Untouched — deps unchanged |
| Static props | Zero cost — no memos involved |

## Proposed Fix: Per-prop resolution

Move from one-memo-per-component to one-memo-per-prop. Each prop's memo tracks only the store signals it actually references.

### Architecture

**Two changes working together:**

**1. Stable bindings — resolve once at setup, not inside memos:**

```
Current (re-creates inner memos on every change):
  per-prop memo → resolveProp() → resolveStoreProp() → createMemo(walkPath) ← new memo each run
                                                                               old memo disposed

Stable (inner memos live for component lifetime):
  resolveProp() → resolveStoreProp() → createMemo(walkPath) ← created once at setup
  per-prop memo → binding()                                  ← just reads the stable accessor
```

**2. Per-prop memos — isolate each prop's dependencies:**

```
Schema node props: { label: { $store: 'a.x' }, color: { $store: 'b.y' }, items: [...] }
                          ↓                         ↓                        ↓
              binding = resolveProp()    binding = resolveProp()        (static value,
              at setup (stable memo)    at setup (stable memo)          no memo needed)
                          ↓                         ↓                        ↓
                    createMemo(() =>          createMemo(() =>          items as-is
                      deepUnwrap(binding()))    deepUnwrap(binding()))
                          ↓                         ↓                        ↓
                    label="Hello"             color="#ff0000"           items=[...]
```

Store `a` changes → only `label`'s stable binding fires → only `label` memo re-evaluates. Store `b` unchanged → `color` memo untouched. Static props never re-evaluate. No inner memos are created or disposed.

### Implementation

**File:** `packages/schema-system/solid/src/SchemaRenderer.tsx`

Replace the current `split` + `reactiveAttrs` pattern:

```ts
// --- Current (coarse) ---
const split = createMemo(() => splitProps(resolveProps(node.props, stores, context, createMemo)));
const reactiveAttrs = createMemo(() => { /* reads split(), builds attrs */ });

// --- Proposed (fine-grained with stable bindings) ---

// 1. Resolve each prop ONCE at setup — stable bindings, never re-created
const propBindings: Record<string, { binding: unknown; isStatic: boolean }> = {};
for (const [key, value] of Object.entries(node.props ?? {})) {
  if (isStaticValue(value)) {
    propBindings[key] = { binding: value, isStatic: true };
  } else {
    // resolveProp runs ONCE — any inner memos (from $store, $if, etc.) live
    // for the component's lifetime. No disposal/re-creation on change.
    const binding = resolveProp(value, stores, context, createMemo);
    propBindings[key] = { binding, isStatic: false };
  }
}

// 2. Per-prop memos — each only reads its own stable binding
const propMemos: Record<string, () => unknown> = {};
for (const [key, { binding, isStatic }] of Object.entries(propBindings)) {
  if (isStatic) {
    propMemos[key] = () => binding;
  } else {
    propMemos[key] = createMemo(() => {
      // Just read the stable accessor and unwrap — no resolver work
      return typeof binding === 'function' && REACTIVE_ACCESSOR in binding
        ? deepUnwrap((binding as () => unknown)())
        : deepUnwrap(binding);
    });
  }
}

// 3. Build attrs — each propMemo call only triggers if that prop's deps changed
const reactiveAttrs = createMemo(() => {
  const attrs: Record<string, unknown> = {};
  for (const [key, memo] of Object.entries(propMemos)) {
    attrs[key] = memo();
  }
  return attrs;
});
```

**Key insight:** Store bindings are created once at setup — the inner memos from `resolveStoreProp` (and `$if`, `$map`, etc.) live for the component's lifetime instead of being re-created on every change. Per-prop memos then read these stable accessors, so only changed props re-evaluate. Static props bypass both layers entirely. The outer `reactiveAttrs` memo still produces a single object (Dynamic spread requires it), but Solid's memo equality check means it only re-runs when an inner memo's value actually changes.

### Helper: `isStaticValue`

Detects values with no schema tokens (can be passed through without any reactive tracking):

```ts
function isStaticValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object') return true;  // primitives, strings, functions
  if (Array.isArray(value)) return value.every(isStaticValue);
  // Object — check for $ tokens at any depth
  return !Object.keys(value).some((k) => k.startsWith('$'))
    && Object.values(value).every(isStaticValue);
}
```

### Web component path

The `createEffect` for web components also benefits:

```ts
// Per-prop effects for web components (instead of one effect for all)
if (needsPropertyHandling) {
  for (const [key, memo] of Object.entries(propMemos)) {
    if (isComplexValue(memo()) || designSystemCamelCaseProps.has(key)) {
      createEffect(() => {
        if (hostRef) hostRef[key] = memo();
      });
    }
  }
}
```

Each web component property gets its own effect — only the changed property triggers a DOM write.

### `splitProps` removal

With per-prop resolution, `splitProps` is no longer needed in the renderer. The safe/complex distinction is handled per-prop:
- Solid components: all props go into the `reactiveAttrs` spread (Dynamic handles functions, objects, and primitives)
- Web components: complex/camelCase props get per-prop effects, rest go into attrs spread

## Key considerations

### 1. Stable bindings eliminate memo churn

Previously, `resolveProp` ran inside a memo — each re-run of the memo called `resolveStoreProp`, which called `createMemo` to create a new path-walking memo. Solid would dispose the old one and allocate the new one on every store change. With stable bindings, `resolveProp` runs once at setup, and the inner memo lives for the component's lifetime. Zero allocation/disposal overhead on updates.

### 2. Memo overhead vs tracking savings

Creating N memos per component (one per prop) adds baseline overhead. For components with mostly static props (2-3 props, no tokens), the memos cost more than they save.

**Mitigation:** Only create memos for props containing tokens. Static props bypass the memo system entirely. Most components have 3-8 props, typically 1-3 with tokens → only 1-3 memos per component.

### 3. Dynamic spread still produces a new object

Even with per-prop memos, `reactiveAttrs` returns a new object reference each time any prop changes. Solid's `<Dynamic>` does shallow-diff the spread, so unchanged attributes aren't re-applied to the DOM — but the diff work still runs.

This is inherent to the `<Dynamic>` component pattern. The alternative (assigning props via individual `createEffect` calls, like the web component path) avoids the diff but loses Solid's JSX optimization. For Solid components, the spread approach is the standard pattern and performs well.

### 4. Prop resolution must remain synchronous

`resolveProp` is synchronous and must stay that way — Solid's `createMemo` expects a synchronous factory. This is already the case; no changes needed.

### 5. `$forEach` and `$if` special cases

These are handled before the prop resolution loop (they have their own rendering paths). No changes needed — they already create their own memos for the `items` / `condition` props.

### 6. Backward compatibility

Components receive identical values — this is a pure performance optimization with no API changes. The `deepUnwrap` function added in PR #2 works unchanged.

## Testing approach

### Functional: existing schema templates

Run the app (`pnpm dev:electron`) and verify:
- Globe route: layers toggle on/off, user locations render
- Sidebar: collapsible groups expand/collapse
- Settings pages: form inputs bind correctly
- Navigation: route changes don't break reactive props

### Performance: targeted profiling

Create a minimal stress test:
- Schema template with 50+ nodes, each reading from different store paths
- Toggle one store value → measure how many memos re-evaluate
- Compare before/after with Chrome DevTools performance panel

Before this PR: all 50 nodes' memos re-evaluate.
After: only nodes reading the changed store path re-evaluate.

### Regression: prop resolution tests

The `@we/schema-shared` package has tests for `resolveProp` / `resolveProps`. These don't change. Add integration tests for the per-prop memo pattern in `@we/schema-solid` if coverage exists.

## Files to change

| File | Change |
|---|---|
| `packages/schema-system/solid/src/SchemaRenderer.tsx` | Replace single `split`/`reactiveAttrs` memo with per-prop memo pattern. Remove `splitProps` import/usage. Separate web component per-prop effects. |
| `packages/schema-system/shared/src/propResolvers/splitProps.ts` | No change (keep for other consumers), but usage removed from renderer |

## Relationship to other PRs

- **Depends on:** PR #2 (Deep Unwrap) — `deepUnwrap` as a pure function is the foundation
- **Independent of:** PR #3 (Schema-Theme), PR #4b ($concat), PR #10 (Component Library)
- **Benefits:** PR #10 components will inherit fine-grained reactivity automatically
