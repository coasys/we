# PR Plan: Ad4mModel Static Subscribe API

## Summary

Add subscription support to Ad4mModel's static query methods (`findAll`, `findOne`, `count`) so live queries don't require the query builder.

## Motivation

Currently, one-shot and live queries have different calling conventions:

```ts
// One-shot — clean static method
const posts = await TextBlock.findAll(perspective, { where: { status: 'published' } });

// Live — requires query builder
const builder = TextBlock.query(perspective, { where: { status: 'published' } });
await builder.subscribe((results) => setData(results));
// must remember to call builder.dispose()
```

This split is accidental — both are the same query, just one-shot vs live. The builder is unnecessary ceremony for the common case.

## Proposed API

### Option A: Callback overload

```ts
// Without callback → one-shot, returns results (unchanged)
const posts = await TextBlock.findAll(perspective, query);

// With callback → live subscription, returns dispose function
const dispose = await TextBlock.findAll(perspective, query, (results) => { ... });
// later: dispose()
```

Same pattern for `findOne`:

```ts
const post = await TextBlock.findOne(perspective, query);
const dispose = await TextBlock.findOne(perspective, query, (result) => { ... });
```

### Option B: Options object

```ts
const dispose = await TextBlock.findAll(
  perspective,
  { where: { status: 'published' } },
  { subscribe: (results) => setData(results) },
);
```

**Option A is preferred** — simpler, the overload signature is unambiguous (callback vs no callback), and it mirrors common patterns in other reactive data libraries.

## Scope

- Add callback overload to `findAll`, `findOne`, `count` on Ad4mModel
- Internally, delegate to `ModelQueryBuilder.subscribe()` / `.countSubscribe()`
- Return a `dispose` function (wraps `builder.dispose()`)
- Existing signatures unchanged — purely additive

## Location

`ad4m/core/src/model/Ad4mModel.ts` — upstream AD4M change.

## Priority

Low — the query builder works fine as-is. This is a DX improvement, not a blocker. The WE `$query` service abstracts over whichever API exists, so this change would simplify the service internals but isn't required for it.
