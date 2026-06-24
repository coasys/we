# Schema System Refactor Plan

## Background

During investigation of a search filter bug in `MarketplaceBrowser.ts` and `TemplatesRoute.ts`, a structural inconsistency in the schema system was identified. The immediate bug (`from: '$arg'` not working in `$setLocal`) exposed a deeper pattern: the system has two coexisting expression mechanisms — object tokens and magic strings — with no principled distinction between them. Every bug of this class traces back to that split.

This document captures the recommended long-term direction. The decision window is now: no consumers yet, so migration cost is low.

---

## The Immediate Bug (Already Fixed)

`$arg` in `$action.args` strings (e.g. `args: ['$arg']`) is handled by `processArgValue` in `action.ts`. The same token in `$setLocal.from` (`from: '$arg'`) was **not** handled by `extractFromPath` in `local.ts`, silently returning `undefined` on every keystroke — causing search filters to never update.

Fixed by adding `$arg` / `$arg.path` support to `extractFromPath`, making it an alias for `$event` / `$event.path`. Backward-compatible.

---

## Root Problem: Two Parallel Expression Systems

The schema system has two ways to express a dynamic value:

```ts
// Object tokens — explicit, structured, validatable without string parsing
{
  $store: 'adamStore.me.name';
}
{
  $local: 'search';
}
{
  $concat: ['v', { $local: 'version' }];
}

// Magic strings — parsed at runtime, invisible to the validator
('$item.name'); // context ref in children / props
('$event.detail'); // arg path in $setLocal.from
('$arg.id'); // arg path in $action.args
```

Both resolve values but through entirely separate mechanisms. The validator can find every object token without string parsing; it cannot find magic strings without regex scanning. The `$arg` bug happened precisely because adding `$arg` to `processArgValue` didn't automatically add it to `extractFromPath` — two separate systems, two separate places to update.

The goal is to eliminate magic strings from prop positions entirely, leaving a single coherent expression system throughout.

---

## The Correct Long-Term Design

### Core principle: object tokens everywhere in props, magic strings only in children

Magic strings in `children` arrays are visually unambiguous — a string starting with `$` is clearly a context reference, not a literal. They are readable and worth keeping there:

```ts
// Fine — in children, '$' strings are clearly not literals
children: ['$template.name'];
children: ['$item.author'];
```

In `props` and `args`, however, strings and dynamic expressions are mixed — `'primary'` is a literal, `'$item.name'` is a lookup, and the difference isn't obvious without knowing the convention. The fix is to make every dynamic value in a prop position an explicit object token.

---

### Change 1: Add `{ $ctx: 'path' }` token (replaces magic strings in props)

Introduce a third read token alongside `$store` and `$local` for context variable references — the per-item values injected by `$each`, `$single`, `$agent`, route params, etc.

```ts
// Current (magic string in prop position)
props: { text: '$template.name' }
args: ['$item.id']
onClick: { $action: 'store.method', args: ['$item.id'] }

// Proposed
props: { text: { $ctx: 'template.name' } }
args: [{ $ctx: 'item.id' }]
onClick: { $action: 'store.method', args: [{ $ctx: 'item.id' }] }
```

Magic strings in `children` arrays are left unchanged — they remain the natural syntax there:

```ts
children: ['$template.name']; // unchanged, still the idiomatic form
```

**Why keep `$store` and `$local` as separate tokens rather than collapsing all three into `$get: 'store.x'`?**

The separation is semantically meaningful, not just cosmetic:

- `$store` — global reactive state, lives outside any component, persists across navigation
- `$local` — ephemeral state scoped to a single node's lifetime, destroyed on unmount
- `$ctx` — per-iteration value injected by a parent loop or route, read-only

When reading a schema, the token immediately communicates the data's origin and lifetime. For AI generation, the distinction matters: the model needs to know _where_ to declare state, not just how to read it. Collapsing into `$get: 'store.x'` saves one token name at the cost of that signal.

---

### Change 2: Make `$setLocal.from` accept any expression token

Currently `from` accepts only a string mini-language (`'$event.detail'`, `'$arg.target.value'`). Replace with full prop-token resolution so `from` is composable with the rest of the system:

```ts
// Current — string mini-language, separate parsing path
{ $setLocal: 'value', from: '$arg.detail' }

// Proposed — any resolvable token
{ $setLocal: 'value', from: { $arg: 'detail' } }
{ $setLocal: 'name', from: { $ctx: 'item.name' } }  // set from context
{ $setLocal: 'copy', from: { $local: 'original' } }  // copy another field
```

This eliminates `extractFromPath` as a separate parsing path. The `from` value passes through `resolveProp` like any other token. Existing string forms (`'$arg.detail'`, `'$event.detail'`) continue working during a transition period, then deprecate.

---

### Change 3: `$arg` as the canonical event-argument token everywhere

`$event` was the original name for "first callback argument" in `$setLocal.from`. It's misleading when the callback doesn't receive a DOM event (e.g. `SearchInput.onSearch` delivers a plain string). `$arg` is more accurate.

With Change 2 landed, `$arg` / `$arg.path` becomes the single canonical way to reference a callback argument in any handler context:

```ts
// In $setLocal.from (with Change 2)
{ $setLocal: 'search', from: { $arg: '' } }      // first arg directly
{ $setLocal: 'value', from: { $arg: 'detail' } } // property on first arg

// In $action.args (already works)
{ $action: 'store.method', args: [{ $ctx: 'item.id' }, { $arg: 'detail' }] }
```

`$event` / `$event.path` string forms are kept as aliases indefinitely (they're in many schemas and the muscle memory is established). But new schemas and docs use `$arg`.

---

### What NOT to change

**`$concat` stays as-is.** Adding template string interpolation (`'v{{local.version}}'`) would introduce string parsing into a system that is otherwise entirely JSON-native, create a dual expression system (object tokens for complex cases, template strings for simple ones), and make the validator more complex. The readability cost of `$concat` is real but modest. Document it clearly and move on.

**`$each`, `$if`, `$routes`, `$animate`, `$single` stay as-is.** These block structures are clean and well-understood.

**`$localState`, `$queries` stay as-is.** These patterns work well.

**No full expression language** (JSONata, JEXL, etc.). The object-token approach is correct for AI generation — AI produces structured JSON reliably and struggles with embedded mini-expression strings. Adding a real expression language would move in the wrong direction.

---

## End State

After all three changes, the expression system is fully coherent:

| Operation               | Token                                | Notes                                            |
| ----------------------- | ------------------------------------ | ------------------------------------------------ |
| Read global state       | `{ $store: 'store.path' }`           | unchanged                                        |
| Read local state        | `{ $local: 'field' }`                | unchanged                                        |
| Read context variable   | `{ $ctx: 'item.name' }`              | **new** (replaces `'$item.name'` in props)       |
| Read first callback arg | `{ $arg: '' }` or `{ $arg: 'path' }` | **new** (replaces `'$arg'` / `'$event'` strings) |
| Context ref in children | `'$item.name'`                       | unchanged — still idiomatic in children          |
| Set local on event      | `{ $setLocal: 'x', from: <token> }`  | **extended** to accept any token                 |

Every dynamic value in a prop object is an explicit token. Magic strings exist only in children arrays where they are unambiguous. The validator can find every reference without string parsing. The AI has one consistent pattern to learn: objects with `$`-keys are tokens; strings in children arrays may be context refs; strings everywhere else are literals.

---

## Migration Scope

The migration is mechanical. The bulk of it is replacing magic string context refs in prop positions:

```ts
// Before
props: {
  value: '$item.name';
}
args: ['$template.id'];

// After
props: {
  value: {
    $ctx: 'item.name';
  }
}
args: [{ $ctx: 'template.id' }];
```

Children arrays require no changes. `$store` and `$local` tokens require no changes.

**Validator update**: add a warning (then error) when a `$`-prefixed string appears in a prop value or args array position — this catches any missed migrations and prevents new magic strings from appearing in prop positions going forward.

---

## Implementation Order

1. **Add `{ $ctx: 'path' }` to `resolveProp`** — add the resolver, add the Zod schema entry, add to CLAUDE.md. No migration yet, just opt-in.
2. **Update validator** to warn on magic strings in prop/args positions.
3. **Migrate existing schemas** — mechanical find-and-replace of `'$item.x'` → `{ $ctx: 'item.x' }` etc. in all prop/args positions. Children arrays untouched.
4. **Extend `$setLocal.from`** to accept token expressions via `resolveProp`. Keep string forms as deprecated aliases.
5. **Update CLAUDE.md** to document `$ctx`, `$arg`, and the children-vs-props distinction. Deprecate `$event` in docs.
6. **Remove validator warning grace period** — make magic strings in prop positions a hard error.

---

## Files Affected

| File                                                             | Change                                            |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| `packages/schema-system/shared/src/propResolvers/dispatcher.ts`  | Add `$ctx` token routing                          |
| `packages/schema-system/shared/src/propResolvers/local.ts`       | Extend `$setLocal.from` to accept tokens          |
| `packages/schema-system/shared/src/zodSchemas.ts`                | Add `$ctx` to valid prop token shapes             |
| `packages/schema-system/shared/src/semanticValidation.ts`        | Warn on magic strings in prop positions           |
| `packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx` | Handle `$ctx` in renderer                         |
| `packages/ai-context/src/fragments/schema-operators.ts`          | Document `$ctx`, update `$arg` / `$setLocal` docs |
| `packages/app-framework/src/shared/schemas/**`                   | Migrate magic strings in prop/args positions      |
