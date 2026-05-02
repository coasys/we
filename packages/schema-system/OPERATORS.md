# Schema Operators Reference

This document describes the operators available in the schema system for declarative UI logic.

## Table of Contents

- [Prop-Level vs Renderer-Level Operators](#prop-level-vs-renderer-level-operators)
- [Data Access Operators](#data-access-operators)
- [Transformation Operators](#transformation-operators)
- [Action Operators](#action-operators)
- [Conditional Operators](#conditional-operators)
- [Comparison Operators](#comparison-operators)
- [Logical Operators](#logical-operators)
- [Composing Operators](#composing-operators)
- [Renderer Operators](#renderer-operators)
- [Best Practices](#best-practices)
- [Error Handling](#error-handling)
- [Security](#security)

---

## Prop-Level vs Renderer-Level Operators

The schema system has **two categories** of operators:

**Prop-level operators** (resolved by `resolveProp` in `@we/schema-shared`) — these appear inside `props` and produce a value:

- `$store`, `$concat`, `$action`, `$map`, `$pick`, `$if` (prop), `$eq`, `$ne`, `$in`, `$not`, `$and`, `$or`
- Context reference strings: `$item.name`, `$space.uuid` (resolved inline by the dispatcher)

**Renderer-level operators** (handled by the framework-specific renderer) — these appear as the `type` field and control rendering structure:

- `$if` (node), `$each`, `$routes`, and fragment (no `type`)

### Dual-Use: `$if`

The `$if` operator has two distinct forms:

|                 | Node-Level                                          | Prop-Level                                               |
| --------------- | --------------------------------------------------- | -------------------------------------------------------- |
| **Appears in**  | `{ type: '$if', props: { condition, then, else } }` | `{ $if: { condition, then, else } }` inside a prop value |
| **Returns**     | Rendered DOM nodes                                  | A resolved value                                         |
| **Transitions** | Supports `enterTransition`/`exitTransition`         | No                                                       |
| **Handled by**  | Framework renderer (`SchemaRenderer`)               | `resolveProp()` in shared                                |

**Node-level** — conditionally renders entire subtrees:

```typescript
{
  type: '$if',
  props: {
    condition: { $store: 'userStore.isLoggedIn' },
    then: { type: 'we-text', children: ['Welcome!'] },
    else: { type: 'we-button', props: { label: 'Log In' } }
  }
}
```

**Prop-level** — conditionally resolves a value:

```typescript
{
  type: 'we-text',
  props: {
    variant: { $if: { condition: { $store: 'appStore.isDark' }, then: 'light', else: 'dark' } }
  }
}
```

## Data Access Operators

### `$store`

Access reactive store values.

**Syntax:**

```typescript
{
  $store: 'storeName.propertyPath';
}
```

**Examples:**

```typescript
// Simple property access
{
  $store: 'userStore.name';
}

// Nested property access
{
  $store: 'userStore.profile.email';
}

// Array access
{
  $store: 'templateStore.templates';
}
```

**Notes:**

- Returns an accessor (function) for reactive updates
- Cannot access entire store (must specify property)
- Automatically unwraps nested accessors

---

## Transformation Operators

### `$map`

Transform arrays or single objects by selecting/reshaping properties.

**Syntax:**

```typescript
{
  $map: {
    items: <source>,
    select: { <key>: '<value>' | '$item.<path>' }
  }
}
```

**Examples:**

**Transform array:**

```typescript
{
  $map: {
    items: { $store: 'templateStore.templates' },
    select: {
      id: '$item.id',
      name: '$item.meta.name',
      icon: '$item.meta.icon'
    }
  }
}
// Input: [{ id: '1', meta: { name: 'Default', icon: 'home' } }, ...]
// Output: [{ id: '1', name: 'Default', icon: 'home' }, ...]
```

**Transform single object:**

```typescript
{
  $map: {
    items: { $store: 'templateStore.currentTemplate' },
    select: {
      id: '$item.id',
      name: '$item.meta.name',
      icon: '$item.meta.icon'
    }
  }
}
// Input: { id: 'default', meta: { name: 'Default', icon: 'home' } }
// Output: { id: 'default', name: 'Default', icon: 'home' }
```

**With constants:**

```typescript
{
  $map: {
    items: [{ id: 1 }, { id: 2 }],
    select: {
      id: '$item.id',
      type: 'template',  // constant value
      active: true
    }
  }
}
// Output: [{ id: 1, type: 'template', active: true }, ...]
```

**Notes:**

- Use `$item.<path>` to reference properties from source items
- Supports both arrays and single objects
- Returns accessor if source is an accessor
- Nested property paths supported: `$item.user.profile.email`

---

### `$pick`

Extract specific properties from an object.

**Syntax:**

```typescript
{
  $pick: {
    from: <source>,
    props: ['<prop1>', '<prop2>', ...]
  }
}
```

**Example:**

```typescript
{
  $pick: {
    from: { $store: 'userStore.profile' },
    props: ['name', 'email']
  }
}
// Input: { name: 'Alice', email: 'alice@example.com', id: '123', role: 'admin' }
// Output: { name: 'Alice', email: 'alice@example.com' }
```

**Use Cases:**

- Simple property extraction (subset of object)
- For transformation/reshaping, use `$map` instead

---

### `$expr`

> **Removed.** Use context reference strings (`"$space.name"`) for simple property access and `$concat` for string building. See [Context Reference Strings](#context-reference-strings) and [`$concat`](#concat) below.

---

### `$concat`

Join multiple parts into a single string.

**Syntax:**

```typescript
{ $concat: [<part1>, <part2>, ...] }
```

**Examples:**

```typescript
// Build a route path
{
  $concat: ['/space/', '$space.uuid'];
}
// → "/space/abc123"

// Mix static and dynamic parts
{
  $concat: ['Hello, ', '$user.name', '!'];
}
// → "Hello, Alice!"

// Parts can be any resolvable value
{
  $concat: ['/space/', { $store: 'appStore.currentId' }];
}
```

**Notes:**

- Each part is resolved via `resolveProp` (supports `$store`, context strings, etc.)
- `null`/`undefined` parts become empty strings
- Returns a reactive accessor when used with a memo function

---

### Context Reference Strings

Plain strings starting with `$` followed by a key present in the context resolve to context values. This is the primary way to access iteration variables in `$each` children.

**Syntax:**

```typescript
'$<contextKey>'; // Whole context value
'$<contextKey>.<path>'; // Dot-path into context value
```

**Examples:**

```typescript
// Simple property access
'$item.name'; // → context.item.name
'$space.uuid'; // → context.space.uuid

// Deep path
'$item.meta.icon'; // → context.item.meta.icon

// Whole value
'$item'; // → context.item
```

**Notes:**

- The context key (between `$` and first `.`) must exist in context — otherwise returned as a plain string
- `$each` injects items via the `as` prop (default: `'item'`), so `$item.name` works by default
- For nested `$each` loops, use distinct `as` values: `as: 'team'` → `$team.name`

---

## Action Operators

### `$action`

Call store methods, with support for argument extraction from callbacks.

**Syntax:**

```typescript
{
  $action: 'storeName.methodName',
  args?: [<arg1>, <arg2>, ...]
}
```

**Examples:**

**Simple action:**

```typescript
{
  onClick: {
    $action: 'adamStore.navigate',
    args: ['/settings']
  }
}
```

**Extract property from callback argument:**

```typescript
{
  onSelect: {
    $action: 'templateStore.switchTemplate',
    args: ['$arg.id']  // Extract .id from first callback argument
  }
}
// When onSelect is called with { id: 'abc', name: 'Template' }
// Calls: templateStore.switchTemplate('abc')
```

**Deep property extraction:**

```typescript
{
  onSubmit: {
    $action: 'userStore.updateEmail',
    args: ['$arg.user.profile.email']
  }
}
```

**Pass entire argument:**

```typescript
{
  onChange: {
    $action: 'formStore.updateField',
    args: ['$arg']  // Pass entire first argument
  }
}
```

**Mixed arguments:**

```typescript
{
  onUpdate: {
    $action: 'store.update',
    args: [
      '$arg.id',              // Extract from callback
      'static-value',         // Static value
      { $concat: ['/item/', '$arg.id'] } // Dynamic value
    ]
  }
}
```

**Notes:**

- `$arg` - passes entire first callback argument
- `$arg.<path>` - extracts property from first callback argument
- Automatically extracts `event.target.value` from DOM events
- Supports relative path navigation for `routeStore.navigate`

---

## Conditional Operators

### `$if` (Prop-Level)

Conditional value resolution — resolves to `then` or `else` value based on condition.

> **Note:** This is the prop-level form. For conditionally rendering entire DOM subtrees, use [node-level `$if`](#if-node-level-conditional) in the Renderer Operators section.

**Syntax:**

```typescript
{
  $if: {
    condition: <boolean-expression>,
    then: <value>,
    else?: <value>
  }
}
```

**Example:**

```typescript
{
  type: 'we-text',
  props: {
    variant: {
      $if: {
        condition: { $store: 'appStore.isDark' },
        then: 'light',
        else: 'dark'
      }
    }
  }
}
```

**Notes:**

- `else` branch is optional
- Automatically unwraps accessors in condition

---

### `$not`

Logical NOT operator.

**Syntax:**

```typescript
{ $not: <boolean-expression> }
```

**Example:**

```typescript
{
  condition: {
    $not: {
      $store: 'userStore.isLoggedIn';
    }
  }
}
```

---

## Comparison Operators

### `$eq`

Equality comparison.

**Syntax:**

```typescript
{ $eq: [<value1>, <value2>] }
```

**Example:**

```typescript
{
  condition: {
    $eq: [{ $store: 'userStore.role' }, 'admin'];
  }
}
```

---

### `$ne`

Not equal comparison.

**Syntax:**

```typescript
{ $ne: [<value1>, <value2>] }
```

**Example:**

```typescript
{
  condition: {
    $ne: [{ $store: 'templateStore.currentId' }, 'default'];
  }
}
```

---

### `$in`

Set membership — returns `true` if a value is present in an array.

**Syntax:**

```typescript
{ $in: [<value>, <array>] }
```

The first element is the value to search for; the second is the array to search in. Both are resolved before the check.

**Examples:**

```typescript
// Check whether the current perspective UUID is a system perspective
{
  condition: {
    $in: [{ $store: 'spaceStore.uuid' }, { $store: 'adamStore.systemPerspectiveUuids' }];
  }
}

// Check whether the user's role is one of several privileged roles
{
  condition: {
    $in: [{ $store: 'userStore.role' }, ['admin', 'moderator', 'owner']];
  }
}
```

**Notes:**

- Returns `false` (not an error) if the second operand is not an array
- Uses strict equality (`===`) for membership checks
- Both operands can be tokens, store references, context refs, or literals

---

## Logical Operators

### `$and`

Logical AND — returns `true` if all operands are truthy. Short-circuits on the first falsy value.

**Syntax:**

```typescript
{ $and: [<condition1>, <condition2>, ...] }
```

**Examples:**

```typescript
// Both must be true
{
  $and: [{ $store: 'userStore.isAdmin' }, { $not: { $store: 'appStore.isLocked' } }];
}

// Multiple conditions
{
  $and: [
    { $store: 'userStore.isLoggedIn' },
    { $ne: [{ $store: 'userStore.role' }, 'guest'] },
    { $store: 'featureStore.isEnabled' },
  ];
}
```

---

### `$or`

Logical OR — returns `true` if any operand is truthy. Short-circuits on the first truthy value.

**Syntax:**

```typescript
{ $or: [<condition1>, <condition2>, ...] }
```

**Examples:**

```typescript
// Either condition
{
  $or: [{ $store: 'userStore.isAdmin' }, { $store: 'userStore.isModerator' }];
}

// With nested operators
{
  $or: [
    { $eq: [{ $store: 'userStore.role' }, 'admin'] },
    { $and: [{ $store: 'userStore.isVerified' }, { $eq: [{ $store: 'userStore.role' }, 'editor'] }] },
  ];
}
```

**Notes:**

- Both `$and` and `$or` take an array of operands
- Operands can be any resolvable value (literals, `$store`, `$not`, `$eq`, `$ne`, nested `$and`/`$or`)
- Short-circuit evaluation: `$and` stops on the first falsy value, `$or` stops on the first truthy value
- Preferred over `$expr` (removed) for compound boolean logic (safe for untrusted schemas)

---

## Composing Operators

Operators can be composed together for complex logic:

```typescript
{
  type: 'DropdownMenu',
  props: {
    // Transform array of templates
    options: {
      $map: {
        items: { $store: 'templateStore.templates' },
        select: {
          id: '$item.id',
          name: '$item.meta.name',
          icon: '$item.meta.icon'
        }
      }
    },
    // Transform single template object
    selectedOption: {
      $map: {
        items: { $store: 'templateStore.currentTemplate' },
        select: {
          id: '$item.id',
          name: '$item.meta.name',
          icon: '$item.meta.icon'
        }
      }
    },
    // Extract id from selected option and pass to action
    onSelect: {
      $action: 'templateStore.switchTemplate',
      args: ['$arg.id']
    }
  }
}
```

---

## Best Practices

1. **Use `$map` for transformation**, `$pick` for simple extraction
2. **Use `$arg.<path>` to extract properties** in action callbacks
3. **Keep logic simple** - complex logic should be in stores
4. **Leverage composition** - combine operators for complex scenarios
5. **Handle edge cases** - operators return safe defaults (empty arrays, undefined, etc.)

---

## Error Handling

- **Missing store/property**: Returns `undefined`
- **Non-array/object in `$map`**: Returns `[]`
- **Missing action store/method**: Returns `undefined` and logs warning
- **Invalid `$arg` path**: Returns `undefined`
- **Non-existent context key in `$item.*` string**: Returns the string as-is

---

## Renderer Operators

Renderer operators are handled by the framework-specific renderer (e.g. `@we/schema-solid`). They appear as the `type` field on a `SchemaNode` and control rendering structure rather than resolving values.

### `$if` (Node-Level Conditional)

Conditionally renders entire subtrees based on a boolean condition.

**Syntax:**

```typescript
{
  type: '$if',
  props: {
    condition: <boolean-expression>,
    then: <SchemaNode>,
    else?: <SchemaNode>,
    enterTransition?: TransitionConfig,
    exitTransition?: TransitionConfig
  }
}
```

**Examples:**

```typescript
// Simple conditional render
{
  type: '$if',
  props: {
    condition: { $store: 'adamStore.bootState' },
    then: {
      type: 'we-modal',
      props: { title: 'Settings' },
      children: [{ type: 'we-text', children: ['Modal content'] }]
    },
    else: {
      type: 'we-text',
      children: ['Modal closed']
    }
  }
}

// With transitions
{
  type: '$if',
  props: {
    condition: { $store: 'sidebarStore.isVisible' },
    then: { type: 'we-sidebar', children: [...] },
    enterTransition: { type: 'fade', duration: 200 },
    exitTransition: { type: 'fade', duration: 150 }
  }
}
```

**Transition types:** `fade`, `slide`, `scale` — configured via `TransitionConfig` (`type`, `duration`, `easing`, `delay`).

**Notes:**

- Delegates to `ConditionalRenderer` which uses Solid's `<Show>` component
- Without transitions, switches instantly; with transitions, manages opacity and delayed unmounting
- `else` branch is optional
- Automatically unwraps reactive accessors in condition

---

### `$each`

Iterate over an array and render a template for each item.

**Syntax:**

```typescript
{
  type: '$each',
  props: {
    items: <array-source>,
    as?: '<context-key>'  // Default: 'item'
  },
  children: [<template-SchemaNode>]
}
```

**Examples:**

```typescript
// Render a list of cards
{
  type: '$each',
  props: {
    items: { $store: 'templateStore.templates' },
    as: 'template'
  },
  children: [{
    type: 'Column',
    props: {
      bg: 'neutral-0',
      r: '400',
      border: '1px solid neutral-200',
      p: '400',
      gap: '300'
    },
    children: [
      { type: 'we-text', props: { variant: 'heading-sm' }, children: ['$template.meta.name'] }
    ]
  }]
}
```

**How it works:**

1. Resolves `items` prop (can be `$store`, literal array, etc.) and ensures it's an array
2. For each item, creates a new context with the item available under the `as` key (default: `"item"`)
3. Renders the first child node as the template for each item
4. Uses Solid's `<For>` for efficient reactive list rendering
5. Children access the current item via context reference strings (e.g. `"$template.meta.name"`)

---

### `$routes`

Placeholder for routed content. Marks where child route content should be inserted in a layout.

**Syntax:**

```typescript
{
  type: '$routes';
}
```

**Example:**

```typescript
// Layout shell with routed content area
{
  type: 'we-layout',
  children: [
    { type: 'we-navbar', props: { title: 'My App' } },
    { type: '$routes' },  // Route content renders here
    { type: 'we-footer' }
  ]
}
```

**Notes:**

- Returns whatever `children` are passed to `RenderSchema` by the host component
- The actual routing logic is external — the renderer just inserts the routed content at this marker

---

### Fragment (No `type`)

Renders children without a wrapper DOM element.

**Syntax:**

```typescript
{
  // No type property
  children: [<SchemaNode>, ...]
}
```

**Example:**

```typescript
// Group multiple nodes without a wrapper div
{
  children: [
    { type: 'we-text', children: ['Hello'] },
    { type: 'we-text', children: ['World'] },
  ];
}
```

**Notes:**

- Detected when `node.type` is absent or falsy
- Rendered as a JSX fragment (`<>...</>`)
- Useful for conditional groups or organizing layout without extra DOM nodes

---

### HTML Element Passthrough

Native HTML elements can be used directly via lowercase tag names.

**Syntax:**

```typescript
{
  type: 'div' | 'span' | 'button' | ...,
  props: { /* HTML attributes */ },
  children: [...]
}
```

**Example:**

```typescript
{
  type: 'div',
  props: { class: 'container', style: 'padding: 16px' },
  children: [
    { type: 'we-text', children: ['Inside a plain div'] }
  ]
}
```

**Resolution order:**

1. Check component registry (PascalCase names, `we-*` web components)
2. If not found, check if lowercase — passed through as native HTML element
3. If neither, throws error: `Schema node has unknown type`

---

## Security

The `$expr` operator has been removed. All remaining operators are safe for use with untrusted schemas — they resolve structured tokens without executing arbitrary code.

- `$store` / `$action`: Only access stores and methods explicitly provided in the `stores` object
- `$concat`: String concatenation only — no code execution
- Context strings (`$item.*`): Read-only access to the context object
- All comparison/logical operators: Pure boolean operations

**Current status:** All schemas in WE are authored internally and bundled at build time. The `$expr` operator is safe in this context. If schemas from untrusted sources are ever loaded at runtime, `$expr` must be gated behind an allowlist or disabled entirely for those schemas.

**Alternatives to `$expr` for untrusted schemas:**

- `$if` / `$eq` / `$ne` / `$not` / `$and` / `$or` — declarative conditionals (safe)
- `$map` / `$pick` — declarative transformations (safe)
- `$store` — reactive data access (safe, scoped to registered stores)
