# @we/schema-kit

Portable schema fragments — named shapes that expand to plain nodes, naming no store.

Every export is a function returning `SchemaNode`s. It runs when a template or a module is built and
leaves nothing behind: what ships is plain JSON, indistinguishable from JSON written by hand. That
is the one architectural rule the whole fragment layer rests on — **the runtime never knows fragments
exist** — and it is what lets a template outlive the kit it was built from.

```ts
import { emptyState, cardList } from '@we/schema-kit';

const list = cardList({
  query: { entity: 'CollectionBlock', where: { type: 'root' }, limit: 20 },
  as: 'post',
  empty: emptyState({ icon: 'newspaper', label: 'posts', searchable: true }),
  children: [/* the card, once, as nodes */],
});
```

## Portable means it may not name a store

This package is the lower of the two fragment tiers:

| Tier      | Package                              | May reference                                                           |
| --------- | ------------------------------------ | ----------------------------------------------------------------------- |
| Portable  | **`@we/schema-kit`** (this one)      | components, primitives, `$local` contracts it documents                 |
| WE-domain | `@we/template-kit` (`templates/kit`) | WE's stores (`profileStore`, `spaceStore`, `runtimeStore`) and `$agent` |

The split is the kit's honest dependency declaration, and it is enforced rather than trusted:
`kit.test.ts` in `@we/template-kit` reads this package's source to make sure nothing here names a
store. A fragment naming `spaceStore.members` resolves to nothing on a deployment without that store
— _silently_, since an unresolvable path is `undefined` — and `package.json` has no way to say so.

`@we/template-kit` re-exports everything here, so a template importing that package sees one
combined surface and never has to think about which tier a fragment came from.

## Who imports this directly

**Feature modules.** The tier became a package boundary when one needed a fragment: the kit lived
under `templates/`, `modules → templates` is a forbidden sideways edge, and so the call module
copied `peopleTooltip` by hand rather than importing it. A module now depends on this package
directly — as a **devDependency**, since fragments expand at build time and leave no runtime
dependency behind.

**Anything targeting a second host.** A fragment here composes registry keys (`Column`, `we-button`)
rather than imports, so it renders on any framework whose renderer registers those keys, against any
deployment — including one that has never heard of WE's stores.

## Authoring rules

They live in **[`../../templates/kit/CONVENTIONS.md`](../../templates/kit/CONVENTIONS.md)**, which
governs both tiers: the extraction threshold (three real uses, or a divergence that is already a
bug), the single-options-object API rule, the body style that keeps a fragment readable as the tree
it emits, semantic colour roles, and the duty to document every `$local` a fragment reads from or
writes to its ancestors.

The architecture story — why fragments exist at all, and where the layer is going — is
[`docs/architecture/template-fragments.md`](../../../docs/architecture/template-fragments.md).
Where fragments sit among the other contribution surfaces is
[`docs/contributing/surfaces.md`](../../../docs/contributing/surfaces.md).

## Working here

- Everything is plain data and pure functions. No framework imports, anywhere.
- `pnpm --filter @we/template-kit test` covers both packages — it asserts each fragment's expansion,
  and holds the no-store rule above.
- `pnpm --filter @we/schema-kit typecheck` for types alone.
- When an expansion changes materially, update its recipe in
  `packages/ai-context/src/fragments/patterns.ts`. The recipe and the fragment are two renderings of
  one decision; a drifted recipe teaches the AI a shape the codebase stopped using.
