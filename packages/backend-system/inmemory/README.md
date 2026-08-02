# @we/backend-inmemory

An in-memory implementation of `@we/backend-shared`, over plain JS arrays.

```ts
const backend = createInMemoryBackend({
  id: 'demo',
  tables: { Post: [{ id: '1', title: 'Hello' }] },
  relations: { Post: { author: { type: 'hasOne', target: 'Agent', foreignKey: 'authorId' } } },
});

render(() => <SchemaRenderer node={template} stores={backend.stores} registry={registry} />);
```

## Why it exists

Two reasons, and the second is the one that pays daily.

**It is the reference adapter.** A thin `QueryAdapter` over the neutral engine — `compileQuery` →
`executeQueryIR` — with an honest capability profile. It exercises the same renderer path the AD4M
adapter does, so a change that breaks the contract breaks here first, loudly and in milliseconds.

**It makes stores testable without a running executor.** Anything that only needs `DataSource` can be
tested against this instead of booting an executor and waiting on a perspective.

## Consolidation

There were three near-copies of this: one in the portable-ui playground, one in `schema-solid`'s
tests, and a third inline. They had already drifted — the playground's routed queries through the
shared QueryIR engine while the test copy reimplemented filtering, ordering and hydration by hand, so
the two disagreed about what the contract meant. The QueryIR version won; the hand-rolled one is
gone.
