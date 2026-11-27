# Template format: routing

A template routes itself: it declares which screens it has, by path, and marks where the matched one
is drawn. The host owns the address above the template's root and hands the template everything
below it.

## Routes

A node MAY carry `routes`, a list of routes. A route is a node (its `type`, `props`, `children` and
the rest are what it draws) with three more keys:

| Key         | Value                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `path`      | REQUIRED. The route's pattern, relative to the route it is in ([Patterns](#patterns)).                                     |
| `redirect`  | A path the route sends the address to instead of drawing anything ([`keepAlive` and `redirect`](#keepalive-and-redirect)). |
| `keepAlive` | `true`: the route stays mounted, hidden, while a sibling is shown.                                                         |

A route with `routes` of its own is a **layout**: it stays drawn while the address moves among its
child routes, and draws the matched child at its own `$routes` outlet. Two routes of one list MUST
NOT have the same `path`.

---

Implemented by: [`types.ts`](../../../packages/schema-system/shared/src/types.ts) (`RouteSchema`),
[`buildRoutes.tsx`](../../../packages/app-shell/src/frameworks/solid/utils/buildRoutes.tsx),
[`semanticValidation.ts`](../../../packages/schema-system/shared/src/semanticValidation.ts) (duplicate
paths).
Pinned by: render vectors `render.routes.outlet`, `render.routes.start`, `render.routes.nested`.

## The `$routes` outlet

`{ "type": "$routes" }` marks where the matched route is drawn. A node with `routes` MUST have an
outlet in its drawn tree, and SHOULD have one only (its children, slots and node props, to any depth, but not
inside another node's `routes`); an outlet with no `routes` on any node above it is invalid. An
outlet behind a `$if` draws the route once the `$if` draws it. An address matching no route draws
nothing at the outlet.

---

Implemented by: [`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx)
(`$routes`), [`semanticValidation.ts`](../../../packages/schema-system/shared/src/semanticValidation.ts)
(`hasRoutesOutlet`).
Pinned by: render vectors `render.routes.outlet`, `render.routes.outlet-in-if`, `render.routes.no-match`.

## Patterns

A `path` is segments separated by `/`. A segment is literal text, `:name` (any one segment, its text
bound as the param `name`), or `*` or `*name` (the rest of the address, at the end only). `/` and an
empty path are the route's parent itself.

When more than one route of a list matches, the more specific wins: a literal segment over a param, a
param over the rest of the address.

**Params** are readable by expressions through the
[navigation profile](../profiles/members.md#navigation) (`routeStore.params.<name>`), with the
address's query parameters beside them, as text.

**A record's id belongs in the query, not the path.** A writer SHOULD put a record's id in a query
parameter (`?id=…`), never in a path segment: an id may itself contain `/` and `:`, and a path
segment holding one would not match the route meant.

---

Implemented by: [`buildRoutes.tsx`](../../../packages/app-shell/src/frameworks/solid/utils/buildRoutes.tsx),
[`routeMatching.ts`](../../../packages/schema-system/shared/src/routeMatching.ts).
Pinned by: render vector `render.routes.params`; [`routeMatching.test.ts`](../../../packages/schema-system/shared/src/routeMatching.test.ts).

## `keepAlive` and `redirect`

A route with `redirect` draws nothing: arriving at it sends the address to `redirect`, which is
resolved relative to the route's parent when it starts `./` or `../`, and joined to the parent's path
otherwise.

A route with `keepAlive` that has no `routes` and no `redirect` is mounted once and kept, hidden,
while its siblings are shown, so whatever it holds (a scene, a map) is not rebuilt on return. A
`view` template's `meta.keepAlive` becomes its route's `keepAlive`.

## A route's scope

A route body is drawn where its parent's `$routes` outlet is, but its scope is where it is written:
it sees the `$localState` and `$queries` of the node that lists it and of every node above that one,
the template's root first, and draws the root's shared shapes
([Scope across passes](handlers.md#scope-across-passes)). It does not see what is declared or bound
between that node and its outlet, which it is not inside. What a route receives from the host besides
is the [surface](blocks.md#surface) it is drawn in and its own position in the address, for
[relative paths](#relative-paths). A validator warns when a route reads a local declared on the way to its
outlet, and says to move it to the node with `routes` ([Scope is where a body is
written](values.md#scope-is-where-a-body-is-written)).

---

Implemented by: [`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx)
(`RenderSchema`, `PassScope`), [`buildRoutes.tsx`](../../../packages/app-shell/src/frameworks/solid/utils/buildRoutes.tsx),
[`semanticValidation.ts`](../../../packages/schema-system/shared/src/semanticValidation.ts) (`checkRoutes`).
Pinned by: [`semanticValidation.test.ts`](../../../packages/schema-system/shared/src/semanticValidation.test.ts)
(local scope across a route boundary); render vectors `render.routes.root-local`,
`render.routes.nested-local`, `render.routes.outlet-scope-not-lexical`, `render.routes.ref`,
`render.routes.ref-missing`; validate vector `validate.scope.route-not-outlet-advice`.

## The template's root

The host mounts a template under an address of its own choosing (in WE, `/space/<id>`). A template
MUST NOT depend on what that prefix is: its routes are relative to its root, positions in the address
are read relative to its root, and its links are written relative or from `~/`.

---

Implemented by: [`buildRoutes.tsx`](../../../packages/app-shell/src/frameworks/solid/utils/buildRoutes.tsx).
Pinned by: render vectors `render.routes.start`, `render.routes.nested`.

## Relative paths

One rule decides where every path a template writes leads, for a navigation and a link's `href`
alike:

- **Relative to the route the node is drawn in.** `.` (or nothing) is that route itself, `..` the
  route above it, `./board` a page below it.
- **`~/board`** is from the template's root, from anywhere in it; `~/` is the root.
- **`?sort=new`** is the page on screen, with that query.
- **An absolute path or a URL** is left as written: it leaves the template.
- **Template chrome**, drawn outside every route, counts as the root. **`..` never climbs above the
  root**: it stops there.

A validator SHOULD warn about `.` inside a route (a control that goes to the page it is on), and
about more `..` than the route is deep.

A query value a navigation writes is encoded so that it reads back exactly, `:` and `/` left
readable. A path's query parameters are remembered per path for a session: navigating back to a path
without a `?` restores them, and an explicit `?` wins.

> **Why relative.** A section is mounted wherever a space puts it. Links to its own pages, written
> relative, are right wherever that is; `~/` means the same in a header as inside a page, so a
> fragment can move between them without its links changing meaning.

---

Implemented by: [`navigationPaths.ts`](../../../packages/schema-system/shared/src/navigationPaths.ts)
(`resolvePath`, `isRelativePath`).
Pinned by: `paths.json`; `navigation.json` (`nav.relative-*`, `nav.template-root`, `nav.query-only`,
`nav.absolute`, `nav.query-encoding`, `nav.remembered-query`, `nav.explicit-query-wins`);
[`navigationPaths.test.ts`](../../../packages/schema-system/shared/src/navigationPaths.test.ts).
