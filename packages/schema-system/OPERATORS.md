# Schema Operators Reference

This document describes the operators available in the schema system for declarative UI logic.

## Table of Contents

- [Data Access Operators](#data-access-operators)
- [Transformation Operators](#transformation-operators)
- [Action Operators](#action-operators)
- [Conditional Operators](#conditional-operators)
- [Comparison Operators](#comparison-operators)
- [Logical Operators](#logical-operators)
- [Security](#security)

---

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

Evaluate JavaScript expressions with context variables.

**Syntax:**

```typescript
{
  $expr: '<javascript-expression>';
}
```

**Examples:**

```typescript
// Template literals
{
  $expr: '`/space/${space.uuid}`';
}

// Calculations
{
  $expr: 'count * 2 + 1';
}

// Conditionals
{
  $expr: 'user.role === "admin" ? "Edit" : "View"';
}
```

**Notes:**

- Has access to context variables
- Returns evaluated result
- Use with caution - errors return `undefined`

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
    $action: 'modalStore.openModal',
    args: ['settings']
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
      { $expr: 'context.id' } // Dynamic value
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

### `$if`

Conditional rendering based on boolean condition.

**Syntax:**

```typescript
{
  $if: {
    condition: <boolean-expression>,
    then: <schema-node>,
    else?: <schema-node>
  }
}
```

**Example:**

```typescript
{
  type: '$if',
  props: {
    condition: { $store: 'modalStore.isOpen' },
    then: {
      type: 'we-modal',
      props: { ... },
      children: [ ... ]
    },
    else: {
      type: 'we-text',
      children: ['Modal closed']
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
{ $and: [{ $store: 'userStore.isAdmin' }, { $not: { $store: 'appStore.isLocked' } }] }

// Multiple conditions
{ $and: [
  { $store: 'userStore.isLoggedIn' },
  { $ne: [{ $store: 'userStore.role' }, 'guest'] },
  { $store: 'featureStore.isEnabled' }
] }
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
{ $or: [{ $store: 'userStore.isAdmin' }, { $store: 'userStore.isModerator' }] }

// With nested operators
{ $or: [
  { $eq: [{ $store: 'userStore.role' }, 'admin'] },
  { $and: [
    { $store: 'userStore.isVerified' },
    { $eq: [{ $store: 'userStore.role' }, 'editor'] }
  ] }
] }
```

**Notes:**

- Both `$and` and `$or` take an array of operands
- Operands can be any resolvable value (literals, `$store`, `$not`, `$eq`, `$ne`, nested `$and`/`$or`)
- Short-circuit evaluation: `$and` stops on the first falsy value, `$or` stops on the first truthy value
- Preferred over `$expr` for compound boolean logic (safe for untrusted schemas)

---

## Composing Operators

Operators can be composed together for complex logic:

```typescript
{
  type: 'PopoverMenu',
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
3. **Keep expressions simple** - complex logic should be in stores
4. **Leverage composition** - combine operators for complex scenarios
5. **Handle edge cases** - operators return safe defaults (empty arrays, undefined, etc.)

---

## Error Handling

- **Missing store/property**: Returns `undefined`
- **Invalid `$expr`**: Returns `undefined` and logs error
- **Non-array/object in `$map`**: Returns `[]`
- **Missing action store/method**: Returns `undefined` and logs warning
- **Invalid `$arg` path**: Returns `undefined`

---

## Security

### `$expr` — Trusted Schemas Only

The `$expr` operator uses `new Function()` to evaluate JavaScript expressions at runtime. This means **any schema containing `$expr` has the ability to execute arbitrary code** in the user's browser context.

This is safe when schemas come from trusted sources:

- Bundled schema files in the application (`*.schema.ts`)
- Schemas authored by the app developer

This is **not safe** for schemas from untrusted sources:

- User-submitted or community-generated schemas
- Schemas received from external agents or peers
- Schemas loaded from shared neighbourhoods without validation

**Current status:** All schemas in WE are authored internally and bundled at build time. The `$expr` operator is safe in this context. If schemas from untrusted sources are ever loaded at runtime, `$expr` must be gated behind an allowlist or disabled entirely for those schemas.

**Alternatives to `$expr` for untrusted schemas:**

- `$if` / `$eq` / `$ne` / `$not` / `$and` / `$or` — declarative conditionals (safe)
- `$map` / `$pick` — declarative transformations (safe)
- `$store` — reactive data access (safe, scoped to registered stores)
