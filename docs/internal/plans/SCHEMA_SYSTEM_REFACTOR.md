# Schema System Refactor Proposal

## Background

During investigation of a search filter bug in `MarketplaceBrowser.ts` and `TemplatesRoute.ts`, a structural inconsistency in the schema system was identified. The immediate bug (`from: '$arg'` not working in `$setLocal`) exposed a deeper pattern of accumulated inconsistencies. This document captures the analysis and a proposed long-term direction.

**Confidence level**: Moderate on direction, lower on specifics. The recommended next step before committing to the larger refactor is to analyse AI schema generation failure patterns across many examples — not just this one bug — to validate that the identified issues are the actual drivers of error rate.

---

## The Immediate Bug (Already Fixed)

`$arg` in `$action.args` strings (`args: ['$arg']`) is handled by `processArgValue` in `action.ts` and means "first callback argument". The same token in `$setLocal.from` (`from: '$arg'`) was **not** handled by `extractFromPath` in `local.ts`, so it silently returned `undefined`.

The fix was to add `$arg` / `$arg.path` support to `extractFromPath` — same semantics as `$event` / `$event.path`, backward-compatible.

The correct pattern for `SearchInput.onSearch` (and any callback that delivers a plain value rather than a DOM event) is now:

```ts
onSearch: { $setLocal: 'search', from: '$arg' }     // ✓ plain string callback
onSearch: { $setLocal: 'search', from: '$event' }    // ✓ also works (alias)
onChange: { $setLocal: 'value', from: '$arg.detail' } // ✓ property on first arg
```

---

## Identified Structural Problems

### 1. Two tokens for the same concept depending on context

| Context | Token | Meaning |
|---|---|---|
| `$action.args` | `'$arg'` | first callback argument |
| `$setLocal.from` | `'$event'` | first callback argument |

Same concept, different tokens, different subsystems. The immediate fix adds `$arg` to `$setLocal.from` as well, but the underlying split remains: `$event` is the "official" documented name while `$arg` exists only in action args string processing.

### 2. Two parallel expression systems

Magic strings and object tokens coexist with no principled distinction:

```ts
// Magic strings (parsed at runtime from raw strings)
'$item.name'            // context ref in children/props
'$event.detail'         // arg path in $setLocal.from
'$arg.id'               // arg path in $action.args

// Object tokens (explicit schema tokens)
{ $local: 'name' }
{ $store: 'storeName.prop' }
{ $concat: ['a', 'b'] }
```

Both do path-based value resolution but through entirely separate mechanisms. An AI or developer has to know which mechanism is active in which position.

### 3. Three namespaces for "read a value"

`$store`, `$local`, and context strings all retrieve a value from a named location, but each has a different token shape. They represent different data lifetimes (store = global/persistent, local = component-scoped ephemeral, context = per-item in a loop) but that distinction isn't clearly communicated by the token shapes alone.

### 4. `$setLocal.from` is a stringly-typed sub-language

The `from` field in `$setLocal` accepts strings that are parsed by `extractFromPath` — a separate mini-DSL embedded inside a JSON string field, not composable with the main prop resolver. This is the direct cause of the `$arg` bug: extending the prop system doesn't automatically extend `from`.

### 5. `$concat` is verbose for simple interpolation

```ts
// Current
children: [{ $concat: ['v', '$template.version'] }]

// What most templating systems look like
children: ['v{{template.version}}']
```

The current form is machine-parseable and unambiguous but significantly harder to read and author at scale.

---

## Proposed Long-Term Direction

These are ordered roughly by confidence and impact. None require doing all of them.

### A. Unify event argument references (high confidence, low risk)

Make `$arg` / `$arg.path` and `$event` / `$event.path` synonyms everywhere that callback argument extraction can appear (`$setLocal.from`, `$action.args`, `merge` values). Already done for `extractFromPath` as part of the immediate fix — this item is about making `$arg` the documented preferred form and ensuring it works in all handler contexts.

**Why**: Eliminates the most confusing inconsistency. `$arg` communicates "the argument passed to this handler" regardless of whether that argument is a DOM event or a plain value. `$event` is misleading when the callback receives a string.

### B. Make `$setLocal.from` accept full expression tokens (medium confidence)

Rather than a string mini-language, allow `from` to accept any resolvable prop token:

```ts
// Current
{ $setLocal: 'value', from: '$event.detail' }

// Proposed (also accepts full tokens)
{ $setLocal: 'value', from: { $arg: 'detail' } }
// or just keep strings but make them go through resolveProp:
{ $setLocal: 'value', from: { $local: 'someOtherField' } }
```

This would make `$setLocal` composable with the rest of the prop system and eliminate `extractFromPath` as a separate parsing path.

**Risk**: Changes the API shape of `$setLocal`. Existing string forms (`'$event.detail'`) would need to continue working.

### C. Unified `$get` namespace for value reads (medium confidence, high migration cost)

Collapse `$local`, `$store`, and context string refs into a single token with explicit namespace prefixes:

```ts
{ $get: 'local.search' }        // was { $local: 'search' }
{ $get: 'store.adamStore.me' }  // was { $store: 'adamStore.me' }
{ $get: 'ctx.item.name' }       // was '$item.name' magic string
```

**Why**: Single token to learn. Validation is straightforward. AI has one pattern for "read a value."

**Uncertainty**: The current separation of `$local` and `$store` communicates something meaningful about data scope and lifetime. Collapsing into `$get` with namespaces may lose that semantic clarity. Needs validation against real AI error patterns before committing.

**Migration cost**: High — every schema file, plus the validator, renderer, and all resolvers.

### D. Template string interpolation for children (lower confidence)

Replace `$concat` with a template string syntax for inline text:

```ts
// Current (verbose, hard to read)
children: [{ $concat: ['v', '$template.version'] }]
children: [{ $concat: ['Hello, ', { $store: 'adamStore.me.firstName' }] }]

// Proposed
children: ['v{{local.version}}']
children: ['Hello, {{store.adamStore.me.firstName}}']
```

**Why**: Dramatically more readable for the common case of inserting a single value into a string. Most developers recognize mustache syntax immediately.

**Uncertainty**: Introduces string parsing into a system that is otherwise JSON-native. Edge cases (nested braces, escaping) add complexity. The `$concat` form, while verbose, is unambiguous and machine-parseable. This is the lowest-confidence item.

---

## What to Validate Before Committing

The proposed refactor is based on design principles and the analysis of one bug. Before investing in B/C/D:

1. **Audit AI generation failures**: Look at 20–30 schemas that AI got wrong and categorise the mistake types. If errors cluster around token inconsistencies → C is probably worth doing. If errors cluster around component prop misuse or route structure → the CLAUDE.md registry docs are the bottleneck, not the token system.

2. **Check human author pain points**: Talk to anyone manually writing schemas. The verbosity of `$concat` is obvious to an outside reader but might not be the actual source of friction for someone who knows the system.

3. **Prototype C on a branch**: Before migrating all schemas, implement unified `$get` on a branch and re-generate the CLAUDE.md context. Ask the AI to write a few schemas with the new system and compare error rates with the current system.

---

## What NOT to Do

- Do not replace the JSON-native token approach with a full expression language (JSONata, JEXL, etc.). The current object-token system is actually well-suited for AI generation — the AI reasons about structured objects better than it reasons about embedded expression strings.
- Do not redesign `$each` / `$if` / `$routes` block structures — these are clean and well-understood.
- Do not change `$localState` / `$queries` — these patterns work well.

---

## Files Relevant to Any Refactor

| File | Role |
|---|---|
| `packages/schema-system/shared/src/propResolvers/dispatcher.ts` | Central `resolveProp` — all token routing |
| `packages/schema-system/shared/src/propResolvers/local.ts` | `$local`, `$setLocal`, `extractFromPath` |
| `packages/schema-system/shared/src/propResolvers/action.ts` | `$action`, `$arg` handling |
| `packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx` | Solid renderer — where tokens become reactive |
| `packages/ai-context/src/fragments/schema-operators.ts` | Source for CLAUDE.md docs |
| `packages/schema-system/shared/src/zodSchemas.ts` | Validation schema |
| `packages/schema-system/shared/tests/propResolvers.test.ts` | Resolver unit tests |
