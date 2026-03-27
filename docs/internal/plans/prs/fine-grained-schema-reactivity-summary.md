# PR #2b Summary: Fine-Grained Schema Reactivity

**Branch:** `feat/fine-grained-schema-reactivity`
**Commits:** 2 (`331b612`, `0accc8e`)
**Files changed:** 2 code (`SchemaRenderer.tsx`, `skybox/index.ts`), 3 docs

## What changed

### Core refactor: per-prop memos in SchemaRenderer

Replaced the single `split`/`reactiveAttrs` memo chain with per-prop memos. Previously, one `createMemo` resolved ALL props via `resolveProps` → `splitProps`, so any store signal change re-evaluated every prop for the component. Now each prop gets its own `createMemo` that resolves independently.

**Three phases per component:**

1. **Per-prop memos** — each prop with schema tokens (`$store`, `$if`, `$map`, etc.) gets its own `createMemo`. Static props (no `$` tokens) bypass resolution entirely via `isStaticValue`.

2. **Web component per-prop effects** — complex values and `DESIGN_SYSTEM_CAMEL_CASE_PROPS` entries get individual `createEffect` calls instead of one monolithic effect. Only the changed property triggers a DOM write.

3. **Reactive attrs** — outer `createMemo` builds the attrs object from per-prop memos. Solid's memo equality check means it only re-runs when an inner memo's value actually changes.

### Architecture: resolve-inside-memo (not resolve-at-setup)

The plan proposed "stable bindings" — calling `resolveProp` once at setup, outside the per-prop memo. This broke comparison resolvers (`$not`, `$eq`, `$ne`, `$and`, `$or`) which return plain values (not reactive accessors). The password toggle (`$not: { $store: 'adamStore.showPassword' }`) baked the boolean `true` at setup and never updated.

The implemented architecture calls `resolveProp` inside each per-prop memo. This naturally self-selects the optimal behavior:

| Resolver returns | Behavior | Cost |
|---|---|---|
| Reactive accessor (`$store`, `$if`, `$map`) | Solid: accessor passes through, memo never re-runs (stable) | Zero churn |
| Plain value (`$not`, `$eq`, `$and`, `$or`) | Signal reads tracked inside memo, re-runs on change | Minimal — no inner memos |
| Callback (`$action`) | No deps, created once | Stable |

### Solid vs web component handling

For Solid components, reactive accessors (marked with `REACTIVE_ACCESSOR`) pass through as-is — the component calls them in its own reactive scope. This is the standard Solid pattern and means the per-prop memo has no signal dependencies → never re-runs → inner memos from the resolver persist for the component's lifetime. Effectively stable bindings without a separate setup phase.

For web components, accessors are eagerly unwrapped since web components can't call JS functions.

### Removed from renderer

- `splitProps` import and usage — the safe/complex distinction is now handled per-prop
- `resolveProps` import — replaced by per-prop `resolveProp` calls
- Single monolithic `createEffect` for web component properties

### New helpers

- `isStaticValue(value)` — detects values with no `$` tokens (recursively checks objects/arrays). Static props get a trivial `() => value` thunk with no memo.
- `isComplexValue(value)` — checks if a resolved value is an object/array, used to determine web component property-based setting.

### Bonus fix: skybox layer cleanup

The skybox layer's `onCleanup` set `viewer.scene.skyBox.show = false` instead of removing the skybox from the scene. This caused the skybox to not visually toggle off. Changed to `viewer.scene.skyBox = undefined`, matching the remove pattern used by the stars and solar system layers.

## Bugs discovered & fixed during implementation

| Bug | Root cause | Fix |
|---|---|---|
| Password toggle stops working after first click | `$not` returns a plain boolean, baked at setup | Move `resolveProp` inside per-prop memo |
| Settings modal doesn't open | `$map` returns `markReactive(memo(...))` — PopoverMenu expects callable accessor, but eager unwrap flattened it to plain object | Pass reactive accessors through for Solid components |
| Skybox layer doesn't toggle off | Cleanup sets `.show = false` instead of removing skybox | Set `viewer.scene.skyBox = undefined` |

## Cost model

| What happens on a single store change | Cost |
|---|---|
| Changed prop's per-prop memo re-evaluates | `resolveProp` + `deepUnwrap` for one prop |
| Other props' memos | Untouched — deps unchanged |
| Static props | Zero cost — no memos involved |
| `reactiveAttrs` re-runs if memo value changed | Shallow object construction |
| `<Dynamic>` shallow-diffs | Key comparison (inherent) |

## Files changed

| File | Change |
|---|---|
| `packages/schema-system/solid/src/SchemaRenderer.tsx` | Per-prop memos, `splitProps`/`resolveProps` removal, Solid/web component branching, `isStaticValue`/`isComplexValue` helpers |
| `packages/cesium-layers/src/background/skybox/index.ts` | Cleanup: remove skybox from scene instead of hiding |

## Testing

- **Unit tests:** 19 schema-solid tests pass, 83 schema-shared tests pass
- **Functional:** Password toggle, settings modal, skybox toggle, layer toggling, sidebar collapse, navigation — all verified in `pnpm dev:electron`

## Follow-up: Web Component Prop Unification (PR #2c)

Per-prop memos are the foundation for [PR #2c](web-component-prop-unification.md) — unifying web component prop delivery into a single per-prop effect channel, removing `DESIGN_SYSTEM_CAMEL_CASE_PROPS` and ceremony registry wrappers.
