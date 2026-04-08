# Plan: Declarative Form Validation via `$localState`

## Problem

`$localState` provides ephemeral state for forms, but validation still requires imperative code in store actions or falling back to SolidJS components. Every form with a "required" field breaks the declarative schema model.

Current workarounds:

- Store actions that validate and set error flags (pollutes global stores with ephemeral concerns)
- Boolean error fields like `adamStore.passwordError` that must be manually reset
- SolidJS components for any non-trivial form (breaks "everything is schema")

## Proposal

Extend `$localState` field descriptors with declarative validation rules. Add 6 new tokens (4 read, 2 handler) for accessing validation state and controlling touch/reset behaviour.

### Field descriptor extension

```json
{
  "$localState": {
    "name": {
      "type": "string",
      "initial": "",
      "validate": [
        { "rule": "required", "message": "Name is required" },
        { "rule": "minLength", "value": 3, "message": "At least 3 characters" }
      ]
    },
    "email": {
      "type": "string",
      "initial": "",
      "validate": [{ "rule": "required" }, { "rule": "pattern", "value": "^[^@]+@[^@]+$", "message": "Invalid email" }]
    },
    "confirmPassword": {
      "type": "string",
      "initial": "",
      "validate": [{ "rule": "required" }, { "rule": "match", "field": "password", "message": "Passwords must match" }]
    }
  }
}
```

### New tokens

| Token         | Type    | Shape                                         | Resolves to                                                                |
| ------------- | ------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| `$error`      | read    | `{ $error: "field" }`                         | First failing validation message or `""` (only after touched)              |
| `$valid`      | read    | `{ $valid: "field" }`                         | `true` if all rules pass for this field                                    |
| `$touched`    | read    | `{ $touched: "field" }`                       | `true` after field has been blurred                                        |
| `$formValid`  | read    | `{ $formValid: "$scope" }`                    | `true` if all validated fields in current scope pass                       |
| `$touch`      | handler | `{ $touch: "field" }` or `{ $touch: "$all" }` | Marks field(s) as touched                                                  |
| `$resetLocal` | handler | `{ $resetLocal: "$scope" }`                   | Resets all fields in current scope to initial values, clears touched state |

### Built-in validation rules

| Rule        | Value        | Default message                       |
| ----------- | ------------ | ------------------------------------- |
| `required`  | —            | "Required"                            |
| `minLength` | number       | "Must be at least {value} characters" |
| `maxLength` | number       | "Must be at most {value} characters"  |
| `min`       | number       | "Must be at least {value}"            |
| `max`       | number       | "Must be at most {value}"             |
| `pattern`   | regex string | "Invalid format"                      |
| `match`     | field name   | "Must match {field}"                  |

All rules accept an optional `message` override.

## Usage examples

### Basic form

```json
{
  "type": "Column",
  "$localState": {
    "name": {
      "type": "string",
      "initial": "",
      "validate": [{ "rule": "required" }, { "rule": "minLength", "value": 3 }]
    }
  },
  "children": [
    {
      "type": "we-form-field",
      "props": {
        "label": "Name",
        "error": { "$error": "name" }
      },
      "children": [
        {
          "type": "we-input",
          "props": {
            "value": { "$local": "name" },
            "onInput": { "$setLocal": "name", "from": "$event.detail" },
            "onBlur": { "$touch": "name" }
          }
        }
      ]
    },
    {
      "type": "we-button",
      "props": {
        "disabled": { "$not": { "$formValid": "$scope" } },
        "onClick": { "$action": "store.submit", "args": [{ "$local": "name" }] }
      },
      "children": ["Submit"]
    }
  ]
}
```

### Touch all on submit attempt

```json
{
  "type": "we-button",
  "props": {
    "onClick": [
      { "$touch": "$all" },
      {
        "$if": {
          "condition": { "$formValid": "$scope" },
          "then": { "$action": "store.submit", "args": [{ "$local": "name" }] }
        }
      }
    ]
  },
  "children": ["Submit"]
}
```

### Reset after success (sync actions only)

```json
{
  "type": "we-button",
  "props": {
    "onClick": [{ "$action": "store.submit", "args": [{ "$local": "name" }] }, { "$resetLocal": "$scope" }]
  },
  "children": ["Submit"]
}
```

> **Note:** Handler arrays execute sequentially but do NOT await async actions.
> If `submit` is async, the reset fires immediately. For async actions, call
> `$resetLocal` from the action's success path instead.

### Conditional styling based on touched state

```json
{
  "type": "Column",
  "props": {
    "bg": {
      "$if": {
        "condition": { "$and": [{ "$touched": "name" }, { "$not": { "$valid": "name" } }] },
        "then": "danger-50",
        "else": "neutral-50"
      }
    }
  }
}
```

### Cross-field validation (password match)

```json
{
  "$localState": {
    "password": {
      "type": "string",
      "initial": "",
      "validate": [{ "rule": "required" }, { "rule": "minLength", "value": 8 }]
    },
    "confirmPassword": {
      "type": "string",
      "initial": "",
      "validate": [{ "rule": "required" }, { "rule": "match", "field": "password", "message": "Passwords must match" }]
    }
  }
}
```

## Design decisions

### Validation timing

- Rules evaluate on every value change (derived signals, always current)
- `$error` only returns messages for **touched** fields — avoids "errors on first render" UX
- `$valid` and `$formValid` reflect the true state regardless of touched (so submit buttons can disable immediately)

### Token value shapes

`$formValid` and `$resetLocal` use string values (`"$scope"`) rather than booleans (`true`). This is because the `hasToken` predicate in the dispatcher only supports `'string' | 'object' | 'array'` type checks — boolean values would not be detected. Using `"$scope"` is also consistent with `$touch: "$all"` and leaves room for future extensions (e.g. `"$parent"` for cross-scope validation).

### Token rationale

Explicit tokens over dot-path conventions (e.g. `{ $local: "name.$error" }`):

- **AI-authored schemas** — LLMs pattern-match tokens reliably; dot-path conventions are ambiguous
- **Zod validation** — dedicated token shapes catch errors at parse time, not runtime
- **Composition** — `{ $not: { $valid: "name" } }` reads better than `{ $not: { $local: "name.$valid" } }`

### What stays out of scope

- **Async/server validation** — "is username taken?" stays in `$action` handlers. The action sets an error via `$setLocal` on a dedicated error field. Schema-level async is too complex and not portable.
- **`$dirty` (changed from initial)** — Approximated with `{ $ne: [{ $local: "name" }, ""] }`. Can add later if real demand appears.
- **Custom JS validation functions** — Security risk in JSON schemas, not portable. Built-in rules only.
- **Form-level `$onSubmit`** — `$action` already handles this.

### Validation context shape

The SchemaRenderer already passes `context.$local` (signal getters) and `context.$localSetters` (signal setters) to resolvers. Validation adds one new context field: **`$localMeta`** — a merged map of per-field metadata that co-locates all validation state:

```ts
type LocalFieldMeta = {
  initial: unknown;                // Original value (for reset)
  rules: ValidationRule[];         // Validation rules from field descriptor
  touched: () => boolean;          // Signal getter
  setTouched: (v: boolean) => void; // Signal setter
  errors: () => string[];          // Derived memo: all failing rule messages
  reset: () => void;               // Resets value to initial + clears touched
};

context.$localMeta: Record<string, LocalFieldMeta>  // Merged with parent (like $local)
context.$localScopeFields: string[]                  // NOT merged (replaces parent)
```

**Why a unified map:** Resolvers do one lookup to access any field state. The `reset()` closure naturally captures the setter + initial value. `$formValid` iterates `$localScopeFields` and reads `$localMeta[field].errors()`. No need for separate `$localTouched`, `$localErrors`, `$localInitials` context fields.

**Merging rules:**

- `$localMeta` **is merged** with parent scope (`{ ...context.$localMeta, ...newMeta }`), so `$error: "parentField"` works from child scopes.
- `$localScopeFields` **is not merged** (replaces parent), so `$formValid`, `$touch: "$all"`, and `$resetLocal` operate only on the current scope's fields.

**How resolvers use it:**

| Token         | Reads from `$localMeta`                                                           |
| ------------- | --------------------------------------------------------------------------------- |
| `$valid`      | `meta.errors().length === 0` → reactive boolean                                   |
| `$error`      | `meta.touched() ? (meta.errors()[0] ?? "") : ""` → reactive string                |
| `$touched`    | `meta.touched()` → reactive boolean                                               |
| `$formValid`  | Iterates `$localScopeFields`, checks `meta.errors().length === 0` for each        |
| `$touch`      | Calls `meta.setTouched(true)` (or all fields in `$localScopeFields` for `"$all"`) |
| `$resetLocal` | Calls `meta.reset()` for each field in `$localScopeFields`                        |

All read resolvers return `markReactive(memo(...))` so `deepUnwrap` unwraps them inside tracked computations, preserving reactivity.

### Scope tracking

The SchemaRenderer context merges `$local` and `$localMeta` from parent and child scopes into flat maps. `$localScopeFields: string[]` is the **non-merged** field that tracks which fields belong to the current `$localState` declaration.

**`$formValid: "$scope"`** — iterates `$localScopeFields`, returns `true` only if every scoped field's `$localMeta.errors()` is empty. Inherited parent fields are ignored.

**`$touch: "$all"`** — touches only fields in `$localScopeFields`, not inherited fields. A nested form's submit button won't touch parent form fields.

**`$resetLocal: "$scope"`** — resets only fields in `$localScopeFields`. Same scoping behaviour.

Nested `$localState` declarations get their own `$localScopeFields`, which is correct for sub-forms and multi-step wizards. Parent scope fields remain accessible by name via `$local`, `$valid`, `$error`, and `$touched`.

### `match` rule scope and reactivity

The `match` rule (e.g. `{ "rule": "match", "field": "password" }`) resolves against the **merged** `$local` map — it can reference fields from parent scopes, not just the current `$localState`. This is intentional: password and confirmPassword may be in the same scope, but a child scope may need to match a parent field.

**Cross-field reactivity:** The validation engine runs inside a `createMemo` that reads signal accessors from the merged `$local` map. When the `match` rule reads `$local["password"]()`, Solid automatically tracks this as a dependency. So when `password` changes, `confirmPassword`'s error memo re-evaluates. No special wiring required.

### `$resetLocal` behaviour

Calls `$localMeta[field].reset()` for each field in `$localScopeFields`. Each `reset()` closure captures the field's setter and initial value, so it resets the value signal and clears the touched signal. Does not affect inherited parent scope fields.

### Handler array composition

Handler arrays (`onClick: [{ $touch: "$all" }, { $action: ... }]`) are composed into a single sequential handler in the **SchemaRenderer**, not the dispatcher. The dispatcher is framework-agnostic and shouldn't know about DOM event semantics.

The composition happens during prop assignment: when an `on*` prop resolves to an array, the SchemaRenderer composes it into a single sequential handler that skips non-function entries:

```ts
// Detection: on* prop + array result
if (key.startsWith('on') && key[2] === key[2].toUpperCase() && Array.isArray(resolved)) {
  return (...args: unknown[]) => {
    for (const fn of resolved) {
      if (typeof fn === 'function') fn(...args);
    }
  };
}
```

Skipping non-functions is critical: a `$if` without an `else` branch resolves to `undefined` when the condition is false (e.g. `$formValid` is false → action branch becomes `undefined`). The composed handler must tolerate this gracefully.

Non-`on*` arrays (e.g. children lists) pass through unchanged.

### Non-validated fields

Fields without a `validate` array get a minimal `$localMeta` entry with `rules: []` and `errors: () => []`. This means:

- `$valid: "fieldWithoutValidate"` → `true` (no rules to fail)
- `$error: "fieldWithoutValidate"` → `""` (no errors)
- `$touched: "fieldWithoutValidate"` → `false` (touched signal exists but never set)
- `$formValid` → non-validated fields don't block form validity (empty errors array)

## Implementation

### Files to modify

| File                                                            | Changes                                                                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `schema-system/shared/src/types.ts`                             | `ValidationRule` union type, extend `LocalStateField` with `validate`                                      |
| `schema-system/shared/src/zodSchemas.ts`                        | Zod schemas for rules and new tokens                                                                       |
| `schema-system/shared/src/validation.ts`                        | Validation engine: `(value, rules, allFieldAccessors) → string[]` pure function                            |
| `schema-system/shared/src/propResolvers/local.ts`               | `$error`, `$valid`, `$touched`, `$formValid` resolvers                                                     |
| `schema-system/shared/src/propResolvers/dispatcher.ts`          | Wire new tokens into dispatch chain                                                                        |
| `schema-system/frameworks/solid/src/SchemaRenderer.tsx`         | Create derived validation signals, `$touch` and `$resetLocal` handlers, set `$localScopeFields` on context |
| `schema-system/shared/tests/propResolvers.test.ts`              | Unit tests for all resolvers                                                                               |
| `schema-system/shared/tests/zodSchemas.test.ts`                 | Validation of token/rule shapes                                                                            |
| `app-framework/src/shared/schemas/tests/SchemaTokens.schema.ts` | Visual integration tests                                                                                   |

### Implementation order

1. Types and Zod schemas (pure data, no runtime)
2. Handler array composition in dispatcher/renderer (prerequisite for `$touch` + `$action` patterns)
3. Validation engine — `validation.ts`: pure function `(value, rules, allFieldAccessors) → string[]`. Reads cross-field signals for `match` rule.
4. SchemaRenderer signal creation (derive `$error`, `$valid`, `$touched` signals from rules; set `$localScopeFields`)
5. Resolvers (`$error`, `$valid`, `$touched`, `$formValid`, `$touch`, `$resetLocal`)
6. Wire into dispatcher
7. Unit tests
8. Visual integration test section in SchemaTokens
9. Migrate boot screen `passwordError` to use `$error` (stretch goal)

## Resolved questions

1. **`$touch` auto-fire on blur?** — **No.** Keep it explicit. The boilerplate is one line (`onBlur: { $touch: "name" }`), and implicit behaviour creates confusion when a schema author wants to NOT touch on blur (e.g. typeahead fields that should only validate on submit). Explicit is safer for AI-authored schemas too — the pattern is unambiguous.

2. **Event handler arrays** — **Prerequisite confirmed.** The renderer does NOT support handler arrays today. The dispatcher produces `[fn1, fn2]` which is passed as-is — Solid/the DOM expects a single function. **Fix:** Handler array composition in SchemaRenderer (see "Handler array composition" section). Implemented in step 2, before validation work begins.

3. **`$resetLocal` after async** — **Sync-only by design.** Handler arrays don't await async actions, so `$resetLocal` fires immediately. For async actions, the schema author should call reset from the action's success path (e.g. `store.submit()` calls setters on completion). The "Reset after success" example is annotated with this caveat.
