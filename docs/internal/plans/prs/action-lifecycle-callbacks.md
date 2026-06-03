# `$action` Lifecycle Callbacks — Async Form Handling

Extend `$action` with `onSuccess`, `onError`, and `onFinally` callback arrays so schemas can react to async store actions completing — enabling modals that close after submission, error messages, post-creation navigation, and loading state management without coupling async logic into the store.

---

## Problem

Schema `onClick` action arrays are fire-and-forget. When a button dispatches `$action: 'adamStore.createSpace'`, every other action in the array fires synchronously — before the async work resolves. This means:

- Modals close immediately on click, losing the loading indicator
- There's no way to show an error message if the action fails
- Post-success navigation (e.g. go to newly created space) can't reference the action's return value
- Workarounds (moving state into the store, adding synthetic flags) leak presentation concerns into store logic

**Concrete case:** `CreateSpaceModal` — the modal closes before `createSpace` finishes, so the `loading` spinner on the button never renders.

---

## Proposed API

### Basic close-on-success

```ts
{
  $action: 'adamStore.createSpace',
  args: [...],
  onSuccess: [
    { $setLocal: 'createSpaceModalOpen', value: false },
  ],
}
```

### With error handling

```ts
{
  $action: 'adamStore.createSpace',
  args: [...],
  onSuccess: [
    { $setLocal: 'createSpaceModalOpen', value: false },
  ],
  onError: [
    { $setLocal: 'errorMessage', from: '$result.message' },
  ],
}
```

### Post-creation navigation using `$result`

```ts
{
  $action: 'adamStore.createSpace',
  args: [...],
  onSuccess: [
    { $setLocal: 'createSpaceModalOpen', value: false },
    { $action: 'routeStore.navigate', args: [{ $concat: ['/space/', '$result.uuid'] }] },
  ],
}
```

### `$result` token

Within `onSuccess` / `onError` / `onFinally` action arrays, a new context variable `$result` is available:

- `onSuccess`: the resolved return value of the action
- `onError`: the caught error object (with `.message`, `.code`, etc.)
- `onFinally`: not available (undefined)

---

## Implementation

### 1. Type changes — `@we/schema-shared`

Extend `ActionToken` to accept lifecycle arrays:

```ts
type ActionToken = {
  $action: string;
  args?: unknown[];
  onSuccess?: ActionArray;
  onError?: ActionArray;
  onFinally?: ActionArray;
};
```

### 2. Renderer — `resolveActionProp` in `action.ts`

When dispatching an action, check if the result is a `Promise`. If so, attach `.then` / `.catch` / `.finally` handlers that execute the respective action arrays with `$result` injected into context:

```ts
const result = handler(...resolvedArgs);
if (result instanceof Promise) {
  result
    .then((resolved) => {
      if (token.onSuccess) dispatchActions(token.onSuccess, { ...context, $result: resolved });
    })
    .catch((err) => {
      if (token.onError) dispatchActions(token.onError, { ...context, $result: err });
    })
    .finally(() => {
      if (token.onFinally) dispatchActions(token.onFinally, context);
    });
}
```

Non-promise actions run synchronously as today — fully backwards compatible.

### 3. `dispatchActions` helper

Extract action dispatch into a shared helper so it can be called both from the initial onClick handler and from lifecycle callbacks. Takes an action array and a context object.

### 4. `$result` token resolver

Add a resolver for `$result` context references (similar to `$local` but reads from `context.$result`). Used within `args` inside lifecycle callback actions.

---

## Files Affected

| File                                                        | Change                                               |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| `packages/schema-system/shared/src/propResolvers/action.ts` | Core lifecycle dispatch logic                        |
| `packages/schema-system/shared/src/propResolvers/types.ts`  | `ActionToken` type extension                         |
| `packages/schema-system/shared/src/index.ts`                | Export `$result` resolver                            |
| `packages/schema-system/shared/tests/propResolvers.test.ts` | Tests for lifecycle callbacks                        |
| `packages/schema-system/OPERATORS.md`                       | Document `onSuccess`/`onError`/`onFinally`/`$result` |

---

## First Consumer — `CreateSpaceModal`

Once implemented, update `CreateSpaceModal.ts`:

```ts
// Before
onClick: [
  { $touch: '$all' },
  { $setLocal: 'createSpaceModalOpen', value: false },   // ← premature close
  { $if: { condition: { $formValid: '$scope' }, then: { $action: 'adamStore.createSpace', args: [...] } } },
]

// After
onClick: [
  { $touch: '$all' },
  {
    $if: {
      condition: { $formValid: '$scope' },
      then: {
        $action: 'adamStore.createSpace',
        args: [...],
        onSuccess: [{ $setLocal: 'createSpaceModalOpen', value: false }],
        onError: [{ $setLocal: 'submitError', from: '$result.message' }],
      },
    },
  },
]
```

The modal now stays open with the loading spinner until `createSpace` resolves, then closes on success or shows an error on failure.

---

## Implementation Notes & Corrections

### 1. Context key must be `result`, not `$result`

The plan shows `{ ...context, $result: resolved }` but this is wrong. The dispatcher's string resolver strips the leading `$` when doing context lookup:

```ts
const contextKey = value.slice(1, dotIndex); // '$result.uuid' → 'result'
if (contextKey in context) { ... }
```

So inject as `{ ...context, result: resolved }` (no `$`). The `$` in `'$result.uuid'` is just the reference syntax, not the key name. This applies to both `onSuccess` and `onError`.

### 2. `from: '$result.message'` in `$setLocal` does NOT work

`from` in `$setLocal` uses `extractFromPath(event, from)` where `event` is the function call argument — it's `$event`-based, not context-based. `resolveSetLocalProp` never calls `resolvePropFn` on the `value` or `from` fields.

**What works** — `$result` in `args` of a `$action` inside a lifecycle callback:

```ts
onSuccess: [{ $action: 'routeStore.navigate', args: [{ $concat: ['/space/', '$result.uuid'] }] }];
```

This works because `resolveActionProp` calls `resolvePropFn` on each arg, and the string resolver reads `context.result.uuid`.

**What doesn't work** — using `$result` in `$setLocal`'s `value` field:

```ts
onError: [{ $setLocal: 'errorMessage', from: '$result.message' }]; // BROKEN
onError: [{ $setLocal: 'errorMessage', value: '$result.message' }]; // also BROKEN — stored as literal string
```

**V1 approach**: Only support literal `value:` in `onError` / `onSuccess` `$setLocal` tokens. To store a dynamic error message, use a `$action` calling a store method:

```ts
onError: [{ $action: 'adamStore.setError', args: ['$result.message'] }];
```

### 3. Silent rejections when `onError` is absent

If `onError` is not provided and the action throws, the promise rejection is swallowed silently. Always log a fallback:

```ts
.catch((err) => {
  if (token.onError) {
    dispatchActions(token.onError, { ...context, result: err });
  } else {
    console.error(`[$action] ${(value as { $action: string }).$action} failed:`, err);
  }
});
```

### 4. `dispatchActions` is a local helper, not an export

It needs `stores` and `memo` from the surrounding closure in `resolveActionProp` — it can't be a standalone exported function without additional params. Define it inline:

```ts
function dispatchActions(actions: unknown[], ctx: Props): void {
  for (const item of actions) {
    const fn = resolvePropFn(item, stores, ctx, memo);
    if (typeof fn === 'function') fn();
  }
}
```

### 5. Everything else is solid

- The `instanceof Promise` check is the correct hook point — inside the closure returned by `resolveActionProp`, after `method.apply`.
- `$localSetters` (needed by `$setLocal`) are shallow-copied through the context spread and remain live references. ✅
- `$local` signal accessors in context are function references — they read current state when called, so async callbacks always get fresh local state values. ✅
- Non-promise actions are unaffected — `.then/.catch/.finally` simply aren't attached. ✅
- Nested `$action` inside `onSuccess`/`onError` goes through the same `resolveActionProp` pipeline and can itself carry lifecycle callbacks. ✅
- `$if`-wrapped `$action` tokens in lifecycle arrays work — `resolveIfProp` resolves `then` to the `$action` token which then hits `resolveActionProp` with its `onSuccess` intact. ✅

---

## Considerations

- **Concurrent submissions:** While `creatingSpace` is true the submit button is `disabled`, so double-dispatch isn't a concern for this case. For future forms without a loading guard, the renderer should be stateless — callers are responsible for disabling re-submission.
- **Non-promise actions:** Behaviour is unchanged — lifecycle callbacks are simply ignored if the action returns a non-promise value.
- **Nested `$action` in lifecycle:** `onSuccess` / `onError` actions go through the same `resolveActionProp` pipeline, so they can themselves be async with their own lifecycle callbacks.
- **`$result` scope:** Only injected into the lifecycle callback arrays, not into the parent onClick array, to avoid confusing scope bleed.
