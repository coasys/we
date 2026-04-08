# Plan: Scoped Local State in Schema System

## Problem

The schema system handles layout, navigation, and persistent app state well via `$store` / `$action`. But ephemeral form state (input values, loading flags, validation errors) has no natural home:

- **Global stores** (AdamStore, SpaceStore) shouldn't own throwaway form signals
- **Dedicated form stores** add boilerplate and must be manually reset on navigation
- **Components** work but sacrifice the schema system's declarative customizability

This gap forces us to fall back to SolidJS components for any interactive form, breaking the "everything is schema" model.

## Proposal: `$localState`

A new schema token that creates signals scoped to a schema node's lifecycle. State is created on mount and discarded on unmount — no store pollution, no manual cleanup.

### Declaration

```json
{
  "path": "/new-space",
  "type": "Column",
  "$localState": {
    "name": { "type": "string", "initial": "" },
    "description": { "type": "string", "initial": "" },
    "shared": { "type": "boolean", "initial": false },
    "loading": { "type": "boolean", "initial": false }
  },
  "children": [...]
}
```

### Reading values: `$local`

```json
{ "type": "we-input", "props": { "value": { "$local": "name" } } }
```

Equivalent to `$store` but resolves against local state instead of global stores. The resolver returns the signal accessor, so it's reactive.

### Setting values: `$setLocal`

```json
{
  "type": "we-input",
  "props": {
    "value": { "$local": "name" },
    "onInput": { "$setLocal": "name", "from": "$event.target.value" }
  }
}
```

`$setLocal` creates an event handler that calls the signal setter. `from` is a path expression describing where to extract the value from the event.

### Using local state in actions

Local state values can be passed as args to `$action`:

```json
{
  "type": "we-button",
  "props": {
    "onClick": {
      "$action": "adamStore.createSpace",
      "args": [{ "$local": "name" }, { "$local": "description" }, { "$local": "shared" }]
    },
    "loading": { "$local": "loading" },
    "disabled": { "$not": { "$local": "name" } }
  }
}
```

### Lifecycle

- **Created** when the schema node mounts (e.g. route becomes active)
- **Destroyed** when the schema node unmounts (e.g. navigate away)
- State resets to `initial` values on each mount — no stale data

## Implementation

### 1. Schema types

**File:** `packages/schema-system/shared/src/types.ts`

Add token types and extend `SchemaNode`:

```ts
export type LocalStateField = {
  type: 'string' | 'boolean' | 'number';
  initial: string | boolean | number;
};

export type LocalToken = { $local: string };
export type SetLocalToken = { $setLocal: string; from: string };
```

Add `LocalToken | SetLocalToken` to the `OperatorToken` union. Add `$localState?: Record<string, LocalStateField>` to `SchemaNode`.

### 2. Zod validation schemas

**File:** `packages/schema-system/shared/src/zodSchemas.ts`

Add token schemas and register in the `zSchemaProp` union (before the generic record fallback):

```ts
const zLocalToken = z.object({ $local: z.string().min(1) }).strict();
const zSetLocalToken = z.object({
  $setLocal: z.string().min(1),
  from: z.string().min(1),
}).strict();

const zLocalStateField = z.object({
  type: z.enum(['string', 'boolean', 'number']),
  initial: z.union([z.string(), z.boolean(), z.number()]),
});
const zLocalStateDeclaration = z.record(z.string(), zLocalStateField);
```

Add `zLocalToken` and `zSetLocalToken` to the `zSchemaProp` union alongside other tokens. Add `$localState: zLocalStateDeclaration.optional()` to the `SchemaNode` Zod schema.

### 3. Local state resolver

**File:** `packages/schema-system/shared/src/propResolvers/local.ts` (new)

`resolveLocalProp` mirrors the `resolveStoreProp` pattern — reads from `context.$local` instead of `stores`:

```ts
import { markReactive } from './reactive';
import type { Props } from './types';

export function resolveLocalProp(
  value: { $local: string },
  context: Props,
): unknown {
  const localState = context.$local as Record<string, () => unknown> | undefined;
  if (!localState) {
    console.warn(`Schema $local: no $localState in scope for "${value.$local}"`);
    return undefined;
  }
  const accessor = localState[value.$local];
  if (!accessor) {
    console.warn(`Schema $local: field "${value.$local}" not declared in $localState`);
    return undefined;
  }
  return markReactive(accessor);
}
```

`resolveSetLocalProp` creates an event handler that calls the signal setter with a value extracted via `from`:

```ts
export function resolveSetLocalProp(
  value: { $setLocal: string; from: string },
  context: Props,
): (event: unknown) => void {
  const localSetters = context.$localSetters as Record<string, (v: unknown) => void> | undefined;
  if (!localSetters) {
    console.warn(`Schema $setLocal: no $localState in scope for "${value.$setLocal}"`);
    return () => {};
  }
  const setter = localSetters[value.$setLocal];
  if (!setter) {
    console.warn(`Schema $setLocal: field "${value.$setLocal}" not declared in $localState`);
    return () => {};
  }
  return (event: unknown) => {
    setter(extractFromPath(event, value.from));
  };
}
```

#### `from` path extraction rules

The `from` field is a dot-path expression walked against the event object:

| `from` value             | Extraction                    |
| ------------------------ | ----------------------------- |
| `"$event.target.value"` | `event.target.value`          |
| `"$event.detail"`       | `event.detail`                |
| `"$event"`              | the raw event object          |

Implementation: strip the `$event` prefix, split remaining path on `.`, walk the object. No arbitrary expressions — just property access.

### 4. Wire into prop dispatcher

**File:** `packages/schema-system/shared/src/propResolvers/dispatcher.ts`

Add `$local` and `$setLocal` cases. They use distinct keys so ordering relative to `$store` doesn't matter — no shadowing conflict is possible:

```ts
if (hasToken(value, '$local', 'string')) return resolveLocalProp(value, context);
if (hasToken(value, '$setLocal', 'string')) return resolveSetLocalProp(value, context);
```

### 4b. Fix `$action` arg unwrapping (prerequisite)

**File:** `packages/schema-system/shared/src/propResolvers/action.ts`

When `{ "$local": "name" }` appears inside `$action.args`, it resolves at render time to a `REACTIVE_ACCESSOR`-marked signal accessor. But the existing action handler passes resolved args through to `method.apply()` without unwrapping — the store method receives accessor functions instead of values.

This is a latent bug that also affects `$store` tokens in `$action.args` (previously untested because existing schemas use `$item.*` strings in args, which resolve eagerly to values).

Fix: unwrap reactive accessors at execution time, just before calling the store method:

```ts
// In the returned event handler, after processArgTokens:
const unwrappedArgs = argsToUse.map(a =>
  typeof a === 'function' && REACTIVE_ACCESSOR in a ? a() : a
);
return method.apply(store, unwrappedArgs);
```

This ensures `$local` (and `$store`) args in `$action` read the **current** signal value when the event fires, not a stale render-time snapshot.

### 5. Schema renderer creates local context

**File:** `packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx`

Local state flows through the **`context`** object (not `stores`), matching how `$each` adds `item` to context.

**Placement:** Signal creation must happen at the **top** of `RenderSchema`, before `renderNode` is defined and before prop resolution — both consume `context` via closures:

```tsx
export function RenderSchema({ node, stores, registry, context = {}, children }: RenderProps) {
  if (!node) return null;

  // ← HERE: before renderNode and prop resolution
  let effectiveContext = context;
  if (node.$localState) {
    const accessors: Record<string, () => unknown> = {};
    const setters: Record<string, (v: unknown) => void> = {};
    for (const [name, field] of Object.entries(node.$localState)) {
      const [get, set] = createSignal(field.initial);
      accessors[name] = get;
      setters[name] = set;
    }
    effectiveContext = {
      ...context,
      $local: { ...(context.$local ?? {}), ...accessors },
      $localSetters: { ...(context.$localSetters ?? {}), ...setters },
    };
  }

  // Then use effectiveContext everywhere context was previously used:
  // - renderNode() closure
  // - renderChildren()
  // - prop resolution loop (resolveProp calls)
  // - $each context extension
  // - ConditionalRenderer context prop
```

Step by step:

1. Create `createSignal()` for each declared field
2. Build `$local` map (field name → signal accessor) and `$localSetters` map (field name → signal setter)
3. Extend the context: `{ ...context, $local: { ...context.$local, ...newAccessors }, $localSetters: { ...context.$localSetters, ...newSetters } }`
4. Replace all `context` references in the function body with `effectiveContext`
5. Child nodes inherit the extended context — nested `$localState` declarations merge, with inner scopes shadowing outer fields of the same name

This approach gives automatic cleanup (Solid disposes signals when the component scope unmounts) and natural nesting without a separate context provider.

## Example: Create Space Form (schema-only)

```json
{
  "path": "/new-space",
  "type": "Column",
  "props": { "ax": "center", "width": "100%", "height": "100%", "gap": "400", "p": "600" },
  "$localState": {
    "name": { "type": "string", "initial": "" },
    "description": { "type": "string", "initial": "" },
    "shared": { "type": "boolean", "initial": false },
    "loading": { "type": "boolean", "initial": false }
  },
  "children": [
    { "type": "we-text", "props": { "text": "New space", "size": "700", "weight": "600" } },
    {
      "type": "we-input",
      "props": {
        "label": "Name",
        "placeholder": "Space name",
        "value": { "$local": "name" },
        "onInput": { "$setLocal": "name", "from": "$event.target.value" }
      }
    },
    {
      "type": "we-input",
      "props": {
        "label": "Description",
        "placeholder": "Space description",
        "value": { "$local": "description" },
        "onInput": { "$setLocal": "description", "from": "$event.target.value" }
      }
    },
    {
      "type": "we-toggle",
      "props": {
        "label": "Share as neighbourhood",
        "checked": { "$local": "shared" },
        "onToggle": { "$setLocal": "shared", "from": "$event.detail" }
      }
    },
    {
      "type": "we-button",
      "props": {
        "text": "Create Space",
        "variant": "primary",
        "loading": { "$local": "loading" },
        "disabled": { "$not": { "$local": "name" } },
        "onClick": {
          "$action": "adamStore.createSpace",
          "args": [{ "$local": "name" }, { "$local": "description" }, { "$local": "shared" }]
        }
      }
    }
  ]
}
```

## Design Decisions

- **Nested dot paths** (`{ "$local": "form.name" }`): **No** for v1. Fields are flat, top-level keys only. Avoids introducing nested signal structures and keeps the resolver trivial.
- **Child `$localState` scoping:** **Yes** — each `$localState` declaration creates a new scope merged into context, shadowing parent fields of the same name. Natural nesting via context propagation, same pattern as `$each` adding `item`.
- **Derived local state** (`$derived` / `$computed`): **Deferred** — achievable with existing `$if` / `$and` / `$not` / `$concat` in prop expressions. No new mechanism needed yet.
- **Direct value setting** (e.g. `{ "$setLocal": "loading", "value": true }`): **No** for v1. `$setLocal` always requires `from` (event extraction). Setting flags like `loading = true` in response to actions stays in stores, or can be composed via `$action` that sets the flag as a side effect. This keeps `$setLocal` single-purpose and avoids a second code path.

## Deferred: `$validate`

Form validation (`$validate`, `$errors`, touched/dirty tracking, action-level `"validate": true` gating) is the natural companion to `$localState` but adds significant complexity. It will be a **follow-up PR** after `$localState` lands. The core local state system is self-contained and useful on its own — every form that currently requires a SolidJS component can move to schema-only with just `$local` / `$setLocal`.

See [schema-token-roadmap.md](schema-token-roadmap.md) for the `$validate` design notes.

## Scope

This PR adds the core `$localState` / `$local` / `$setLocal` system. Specifically:

1. **Types** — `LocalStateField`, `LocalToken`, `SetLocalToken` in `types.ts`; `$localState` on `SchemaNode`; add to `OperatorToken` union
2. **Zod** — `zLocalToken`, `zSetLocalToken`, `zLocalStateDeclaration` in `zodSchemas.ts`; register in `zSchemaProp` union
3. **Resolver** — new `propResolvers/local.ts` with `resolveLocalProp`, `resolveSetLocalProp`, and `extractFromPath`
4. **Dispatcher** — add `$local` and `$setLocal` cases in `dispatcher.ts`
5. **Action arg unwrap** — fix `REACTIVE_ACCESSOR` unwrapping in `action.ts` so `$local` / `$store` tokens in `$action.args` resolve to current values at execution time (prerequisite, not new feature)
6. **SchemaRenderer** — detect `$localState` on nodes, create Solid signals at the top of `RenderSchema` (before `renderNode`), replace `context` with `effectiveContext` throughout
7. **Tests** — unit tests for resolver functions, action arg unwrapping, and integration tests for SchemaRenderer local state lifecycle (mount/unmount/reset, nesting, `$setLocal` event handling, `$local` inside `$action.args`)
8. **AI context** — update `@we/ai-context` fragments so AI agents know about the new tokens

Derived state, nested dot paths, direct value setting, and `$validate` follow incrementally.
