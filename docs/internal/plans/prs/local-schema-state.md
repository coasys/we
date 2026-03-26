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

Extend `SchemaNode` with an optional `$localState` field:

```ts
interface LocalStateField {
  type: 'string' | 'boolean' | 'number';
  initial: string | boolean | number;
}

interface SchemaNode {
  // ... existing fields
  $localState?: Record<string, LocalStateField>;
}
```

### 2. Local state resolver

**File:** `packages/schema-system/shared/src/propResolvers/local.ts` (new)

```ts
// resolveLocalProp: { $local: "name" } → signal accessor from local state context
// resolveSetLocalProp: { $setLocal: "name", from: "..." } → event handler that calls setter
```

### 3. Wire into prop dispatcher

**File:** `packages/schema-system/shared/src/propResolvers/dispatcher.ts`

Add `$local` and `$setLocal` cases alongside existing `$store` / `$action` handling.

### 4. Schema renderer creates local context

**File:** `packages/schema-renderer/solid/src/RenderSchema.tsx` (or equivalent)

When a node has `$localState`:

1. Create `createSignal()` for each field
2. Wrap children in a context provider (or pass via the existing context/stores mechanism)
3. Make signals available to `$local` / `$setLocal` resolvers

### 5. Register in resolver pipeline

Ensure the resolver order is: `$local` → `$store` → `$action` → `$setLocal` → other tokens.

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

## Open Questions

- **Nested access:** Should `$local` support dot paths for object-typed state (e.g. `{ "$local": "form.name" }`)?
- **Cross-node sharing:** Should child components be able to declare their own `$localState` independent of parents? (Probably yes — each `$localState` scope nests.)
- **Derived local state:** Should there be a `$derived` or `$computed` local field (e.g. `"isValid": { "$derived": { "$and": [{ "$local": "name" }, ...] } }`)?

## Form Validation: `$validate`

Form validation is the single most common reason developers reach for a custom store. Since validation rules are inherently declarative, they fit naturally into the schema system as a companion to `$localState`.

### Declaration

Add a `$validate` object alongside any `$local`-bound prop:

```json
{
  "type": "we-input",
  "props": {
    "value": { "$local": "email" },
    "onInput": { "$setLocal": "email", "from": "$event.target.value" },
    "$validate": {
      "required": true,
      "pattern": "^[^@]+@[^@]+$",
      "message": "Valid email required"
    }
  }
}
```

### Available rules

| Rule                      | Type             | Description                    |
| ------------------------- | ---------------- | ------------------------------ |
| `required`                | `boolean`        | Field must be non-empty        |
| `pattern`                 | `string` (regex) | Value must match regex         |
| `minLength` / `maxLength` | `number`         | String length constraints      |
| `min` / `max`             | `number`         | Numeric range constraints      |
| `message`                 | `string`         | Error message shown on failure |

### Renderer behavior

When a node has `$validate`:

1. The renderer tracks `touched` and `dirty` state per field automatically
2. Validation runs on blur (not on every keystroke) and on form submission
3. Error state is exposed as `$errors.fieldName` (readable via `$local`)
4. Components receive an `error` prop with the message string (or `null`)
5. A parent `$action` with `"validate": true` checks all child validations before executing — if any fail, the action is blocked

### Example: validated form

```json
{
  "type": "Column",
  "$localState": {
    "name": { "type": "string", "initial": "" },
    "email": { "type": "string", "initial": "" }
  },
  "children": [
    {
      "type": "we-input",
      "props": {
        "label": "Name",
        "value": { "$local": "name" },
        "onInput": { "$setLocal": "name", "from": "$event.target.value" },
        "$validate": { "required": true, "message": "Name is required" }
      }
    },
    {
      "type": "we-input",
      "props": {
        "label": "Email",
        "value": { "$local": "email" },
        "onInput": { "$setLocal": "email", "from": "$event.target.value" },
        "$validate": {
          "required": true,
          "pattern": "^[^@]+@[^@]+$",
          "message": "Valid email required"
        }
      }
    },
    {
      "type": "we-button",
      "props": {
        "text": "Submit",
        "disabled": { "$not": { "$and": [{ "$local": "name" }, { "$local": "email" }] } },
        "onClick": {
          "$action": "someStore.submit",
          "validate": true,
          "args": [{ "$local": "name" }, { "$local": "email" }]
        }
      }
    }
  ]
}
```

### Implementation

- Validation resolver lives alongside `$local` / `$setLocal` in `propResolvers/local.ts`
- Each `$validate` creates a validation signal (error string or null) derived from the bound local state + touched flag
- Components that support validation should accept an `error?: string` prop
- The `$action` `"validate": true` flag collects all descendant validation signals and aborts if any are non-null

## Scope

This PR adds the core `$localState` / `$local` / `$setLocal` system **and** the `$validate` companion. Together they eliminate the two most common reasons to reach for a custom store: form state and form validation. Derived state and nested scopes can follow incrementally.
