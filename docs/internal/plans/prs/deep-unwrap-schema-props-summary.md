# PR #2 Summary: Deep Unwrap Schema Props

**Branch:** `feat/deep-unwrap-schema-props`
**Commits:** 1 (`421c790`)
**Files changed:** 4

## What changed

### Core fix: `deepUnwrap` in SchemaRenderer

Added a `deepUnwrap` function to `SchemaRenderer.tsx` that recursively walks complex prop values (objects/arrays) and wraps any `REACTIVE_ACCESSOR`-marked functions in `createMemo`. This resolves the bug where nested `$store` tokens (e.g. sidebar `items` resolved from `adamStore.mySpaceSidebarItems`) leaked through as raw accessor functions instead of plain values.

**Guard:** Only unwraps functions marked with the `REACTIVE_ACCESSOR` symbol — event handlers (`onClick`, etc.) pass through untouched.

**Depth limit:** `MAX_UNWRAP_DEPTH = 10`, matching the existing resolver depth limit.

**Applied in both distribution paths:**
1. `reactiveAttrs` memo — Solid components receive deep-unwrapped complex props
2. `createEffect` — web components receive deep-unwrapped complex props via `hostRef[k]`

### Workaround removals

| Component | What was removed |
|---|---|
| **CollapsibleSidebar** | 8-line `groupItems` memo with manual `typeof items === 'function'` check → simplified to 1-line memo |
| **CesiumGlobe** | 2 `enabledLayers` filter blocks with manual `typeof enabled === 'function'` checks → simplified to direct `.filter()` |

### Correctly left unchanged

| Component | Reason |
|---|---|
| **ConditionalRenderer** | Calls `resolveProp` directly — bypasses the renderer's prop distribution pipeline, so `deepUnwrap` doesn't apply |
| **cesium user-locations** | `UserLocationsOptions.locations` type explicitly accepts `(() => T)` — intentional API design for passing signal accessors |
| **GraphWidget** | `labelColor(node)` / `labelBgColor(node)` are legitimate callback invocations (pass a parameter), not leaked schema accessors |

## Impact

Any component receiving nested reactive values via schema props (objects containing `$store` tokens, arrays of configs with reactive fields, etc.) now gets plain values automatically. No more need for manual `typeof x === 'function' ? x() : x` workarounds in component code.
