# Plan: Ad4mModel Property Default Improvements

> Eliminate redundant class field initializers by inferring type and default value from the `initial` decorator option.

---

## Problem

Current pattern requires three-way duplication:

```typescript
@Property({ through: 'we://status', initial: 'todo' })
status: string = 'todo';
//      ^type    ^value (redundant — initial already declares both)
```

- `initial: 'todo'` — DB default (creates link on save)
- `= 'todo'` — class field default (type hint for hydration + in-memory fallback)
- `string` — TypeScript type annotation

The class field value is redundant when `initial` is set, but required because hydration uses `typeof instance[propName]` for type coercion.

---

## Proposed Changes

### 1. Infer type from `initial` value

In the `@Property` decorator, store `typeof initial` in the property metadata. Use this in `hydratePropertyValue()` instead of `typeof instance[propName]` when available.

```typescript
// In applyPropertyMetadata:
const inferredType = opts.initial !== undefined ? typeof opts.initial : undefined;
propertyRegistry.get(ctor)![key as string] = { ...opts, writable, inferredType } as any;

// In hydrateFromLinks:
const expectedType = propMeta.inferredType ?? typeof instance[propName];
```

### 2. Auto-set class field from `initial`

In the decorator, assign the `initial` value to the instance field so the class default matches:

```typescript
function applyPropertyMetadata(opts: PropertyOptions) {
  return function <T>(target: T, key: keyof T) {
    // ... existing metadata registration ...

    if (opts.initial !== undefined) {
      Object.defineProperty(target, key, {
        configurable: true,
        writable: true,
        value: opts.initial,
      });
    }
  };
}
```

### 3. Result

```typescript
// Before (three-way duplication)
@Property({ through: 'we://status', initial: 'todo' })
status: string = 'todo';

// After (single source of truth)
@Property({ through: 'we://status', initial: 'todo' })
status: string;
```

TypeScript annotation is still required for compile-time type safety, but the runtime value is declared once.

---

## Scope

- Changes are in `@coasys/ad4m` core: `decorators.ts`, `hydration.ts`
- Backwards compatible — existing models with explicit class defaults continue to work
- No changes needed in consuming code (WE models etc.) — they just become eligible for cleanup
