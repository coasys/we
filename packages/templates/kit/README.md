# @we/template-kit

The shapes WE's templates are built from, as data.

Every export is a function returning `SchemaNode`s. It runs when a template is built and leaves
nothing behind: what ships is plain JSON, indistinguishable from JSON written by hand. That is the
package's one architectural rule — **the runtime never knows fragments exist** — and everything
worth having follows from it: no renderer change, templates that outlive the kit, a visual editor
that can drill into every node, an AI that reads ordinary trees, and installed patterns that can
never break a template after the fact because the template owns its copy of the expansion.

```ts
import { emptyState, cardList } from '@we/template-kit';

const postsList = cardList({
  query: { entity: 'CollectionBlock', where: { type: 'root' }, limit: 20 },
  as: 'post',
  empty: emptyState({ icon: 'newspaper', label: 'posts', searchable: true }),
  children: [/* the card, once, as nodes */],
});
```

## Why fragments exist

WE's thesis is that an interface is data a community owns, not code an app ships. That leaves a gap
between the two contribution rungs: components are code (high barrier, opaque to the editor), and
templates are whole artifacts (shareable, but not composable). Fragments are the middle rung — a
named, parameterised _shape_ that expands into editable nodes. Today they serve WE's own templates;
the same shapes ship as JSON recipes in the generated AI reference, so an author in the browser
produces the same trees this package does. Where this goes next — extraction in the editor,
provenance tags, marketplace sharing — is designed in
[docs/architecture/template-fragments.md](../../../docs/architecture/template-fragments.md).

## Two tiers, two packages

| Tier      | Package                              | May reference                                                             |
| --------- | ------------------------------------ | ------------------------------------------------------------------------- |
| Portable  | `@we/schema-kit` (schema-system/kit) | components, primitives, `$local` contracts it documents                   |
| WE-domain | `@we/template-kit` (this one)        | WE's stores (`profileStore`, `datasetStore`, `runtimeStore`) and `$agent` |

The split is the kit's honest dependency declaration. A fragment naming `spaceStore.members` resolves
to nothing on a deployment without that store — silently — and `package.json` cannot say so. Nothing
in `@we/schema-kit` may name a store, and `kit.test.ts` reads its source to make sure.

It became a package boundary when a feature module needed a fragment: the kit sat under `templates/`,
`modules → templates` is a forbidden sideways edge, so the call module copied `peopleTooltip` by hand.
A module imports `@we/schema-kit` directly — as a devDependency, since fragments expand at build time
and leave no runtime dependency behind. This package re-exports all of it, so a template importing
`@we/template-kit` sees exactly what it always did.

## What belongs here

Code owns only what data cannot express: behaviour, focus, accessibility semantics, browser APIs,
measurement. Everything above that line is arrangement, and arrangement belongs here — because a
prop is a customisation somebody predicted, while a node tree is every customisation, including the
ones nobody thought of. The full decision rule, and the rules for writing a fragment, are in
[CONVENTIONS.md](./CONVENTIONS.md).
