# Template format: block types

A node whose `type` starts with `$` is a block type: structure the renderer provides, rather than a
component it looks up. The set is closed. This version defines `$each`, `$if`, `$single`, `$animate`,
`$routes`, `$surface`, `$slot`, `$part`, `$panels` and `$agent`, and `$ref`
([Shared shapes](nodes.md#shared-shapes-defs-and-ref)). Any other `$`-type is unknown and draws the
[missing marker](degradation-and-versioning.md#the-missing-marker).

A block type's props are read as this file says, not handed to a component. Props a block type does
not list are ignored by the renderer and reported by a validator.

**Bindings.** Several block types bind a name for the nodes under them: `$each`'s item, `$single`'s
record, `$agent`'s profile, `$surface`'s box. A bound name is visible to every expression in the
block's subtree and shadows the same name bound further out, and a store of the same name. The name
is the `as` prop, text; a missing or empty `as` is the default the block type gives.

## `$each`

```json
{ "type": "$each", "props": { "items": { "$": "local.posts" }, "as": "post" }, "children": [ … ] }
```

| Prop    | Value                                                                                                    |
| ------- | -------------------------------------------------------------------------------------------------------- |
| `items` | REQUIRED. An expression, or a `$query` token ([Queries](query.md)). Anything that is not a list is `[]`. |
| `as`    | The name the item is bound to. Default `item`.                                                           |

`$each` draws **all of its children, in order, once per item**, with three names bound for each row:

- the `as` name — the item;
- `index` — the row's position, from 0;
- `prev` — the item before it, and no value on the first row.

An `$each` with no children is invalid. A nested `$each` shadows `index` and `prev` as it does its
item, so the inner `index` restarts at 0; the outer item stays reachable by its own `as` name.

The rows follow the list: when it changes, the rows drawn are the list as it now is.

**Row identity.** When every item is an object with an `id` of its own and no two share one, a row is
identified by its `id`: a row whose item changes is updated in place, and keeps its local state and
anything typed into it. Otherwise a row is identified by the item itself, so a list rebuilt from new
objects draws every row afresh. A row is drawn afresh when its `index` or `prev` changes. The rows of
a `$query` are always identified by `id`.

> **Why `prev`.** It is what makes grouping expressible: a run of messages from one author shows one
> byline because a row can ask whether the row before it has the same author. Absent on the first row,
> so that row keeps its byline.

---

Implemented by: [`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx)
(the `$each` branch), [`keptRows.ts`](../../../packages/schema-system/frameworks/solid/src/keptRows.ts).
Pinned by: render vectors `render.each.items`, `render.each.default-as`, `render.each.index-prev`,
`render.each.prev-plain`, `render.each.empty`, `render.each.only-first-child`,
`render.each.several-children-keyed`, `render.each.several-children-plain`, `render.each.nested`,
`render.each.live`, `render.each.comprehension`, `render.local.per-row`.

## `$if`

```json
{ "type": "$if", "props": { "condition": { "$": "local.open" }, "then": { … }, "else": { … } } }
```

| Prop                                | Value                                                        |
| ----------------------------------- | ------------------------------------------------------------ |
| `condition`                         | REQUIRED. An expression, or a literal used as it is.         |
| `then`                              | REQUIRED. A node, drawn while the condition is truthy.       |
| `else`                              | A node, drawn while it is falsy. Absent: nothing.            |
| `enterTransition`, `exitTransition` | How a side appears and leaves ([Transitions](#transitions)). |

Truthiness is the expression language's ([Truthiness](expressions.md#truthiness)): no value, `null`,
`false`, `0`, NaN and `''` are false, and everything else is true, **an empty list and an empty
object included**.

Only the side drawn is mounted. When the condition changes, the side leaving is unmounted (after its
exit transition) and its local state is gone; the side arriving is mounted afresh.

`then` and `else` are the node's content. **A `$if` with `children` is invalid**, and a renderer
draws none of them.

This is the node-level `$if`. The `$if` between handlers is a token with the same name and a
different shape ([Handler `$if`](handlers.md#handler-if)); a conditional value is a ternary in an
expression.

---

Implemented by: [`ConditionalRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/ConditionalRenderer.tsx),
[`zodSchemas.ts`](../../../packages/schema-system/shared/src/zodSchemas.ts) (`zSchemaNode`).
Pinned by: render vectors `render.if.then`, `render.if.else`, `render.if.no-else`, `render.if.toggles`,
`render.if.absent`, `render.if.literal`, `render.if.children-ignored`, `render.if.children-not-drawn`;
[`semanticValidation.test.ts`](../../../packages/schema-system/shared/tests/semanticValidation.test.ts).

## `$single`

```json
{ "type": "$single", "props": { "item": { "$query": { … } }, "as": "profile" }, "children": [ … ] }
```

| Prop   | Value                                             |
| ------ | ------------------------------------------------- |
| `item` | REQUIRED. A `$query` token ([Queries](query.md)). |
| `as`   | The name the record is bound to. Default `item`.  |

Draws all of its children, in order, with the query's first row bound, and draws nothing while the
query has no row. The row follows the record: a change to it updates what is drawn in place.

---

Implemented by: [`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx)
(the `$single` branch).
Pinned by: render vector `render.single.no-backend`.

> **Planned.** Vectors for `$single` with an answer, which need a data source in the renderer suite.

## `$animate`

```json
{ "type": "$animate", "props": { "condition": { "$": "!local.collapsed" }, "enterTransition": { "type": "reveal" } }, "children": [ … ] }
```

| Prop                                | Value                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `condition`                         | An expression. When present it is the only trigger: the enter transition plays while it is truthy, the exit while it is falsy. |
| `scrollReveal`                      | `true`, or a number of pixels (negative is earlier): the enter transition plays when the box enters the viewport.              |
| `scrollLeave`                       | Likewise, for the exit transition when it leaves.                                                                              |
| `scrollPast`                        | Text, the DOM id of a sentinel: enter once the sentinel has scrolled above the box's top edge, exit when it comes back.        |
| `enterTransition`, `exitTransition` | [Transitions](#transitions). An absent exit transition is the enter transition, mirrored.                                      |

`$animate` draws **all of its children, always mounted**: only the transition follows the trigger. A
child keeps its local state, its scroll position and its subscriptions whatever the condition is.
`condition` excludes the three scroll triggers, and `scrollPast` excludes the other two. With no
trigger, the enter transition plays once on mount. The first frame already matches the condition, so
a node that starts closed never shows its content first.

Where the exit leaves the box closed without a `reveal`, it does not take pointer events.

---

Implemented by: [`AnimateRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/AnimateRenderer.tsx).
Pinned by: render vectors `render.animate.condition`, `render.animate.mount`,
`render.animate.several-children`, `render.animate.several-children-reveal`.

### Transitions

A transition is one effect or a list of effects, each `{ type, duration?, easing?, delay?, direction?,
distance?, axis? }`. `type` is `fade` (opacity), `slide` or `scale` (transform), `reveal` (the box's
size, opening to what its content wants, along `axis` `block` or `inline`) or `pulse` (a loop that
runs while entered). `duration` and `delay` are milliseconds; `easing` is a CSS easing.

The effects and their defaults are the design system's catalog; how they look is not part of this
spec, and a renderer MAY draw them differently or not at all. What is normative is when they play,
and that a node with an exit transition stays mounted until the longest effect has finished.

> **Planned.** Vectors for transition timing.

## `$routes`

The outlet where the matched route is drawn. See [Routing](routing.md#the-routes-outlet).

## `$surface`

```json
{ "type": "$surface", "props": { "as": "pane" }, "children": [ … ] }
```

A responsive boundary: a box its subtree measures itself against. Draws its children inside a box,
and binds under `as` (default `surface`) an object holding `width`, the box's width in CSS pixels, and
`tier`, one of `base`, `sm`, `md`, `lg`. The tier thresholds are the design system's catalog. The
innermost surface answers, both for the bound name and for every responsive prop below it.

A host MUST place a surface wherever it mounts a template's tree (the template area, each route, each
panel), so `surface` is bound everywhere without a template declaring one.

---

Implemented by: [`SurfaceRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SurfaceRenderer.tsx),
[`createSurface.ts`](../../../packages/schema-system/frameworks/solid/src/createSurface.ts).
Pinned by: render vector `render.surface.scope`.

## `$slot`

```json
{ "type": "$slot", "props": { "anchor": "call-controls" } }
```

Where contributions to a named anchor are drawn, in module chrome: a module declares the anchor, and
marks with `$slot` where what other modules contribute to it lands, in order, drawing nothing when
nothing is contributed. `anchor` is REQUIRED non-empty text.

**A `$slot` belongs to module chrome only.** A template MUST NOT contain one: a validator reports a
`$slot` in a template as invalid, and a renderer that meets one in a template draws the
[missing marker](degradation-and-versioning.md#the-missing-marker). A fragment judged alone may hold
one, since it may be a module's chrome.

> **Why.** The anchors are the host's and the modules': which contributions exist depends on which
> modules a deployment ships. A template is about one space's interface, and naming another module's
> anchor from it would make it depend on that module without saying so.

---

Implemented by: [`slotRegistry.ts`](../../../packages/app-shell/src/shared/registries/slotRegistry.ts)
(resolved in module chrome only), [`semanticValidation.ts`](../../../packages/schema-system/shared/src/semanticValidation.ts).
Pinned by: render vector `render.slot.in-template`.

## `$part`

```json
{
  "type": "$part",
  "props": { "id": "transcribe.feed", "subject": { "$": "post.id" }, "inputs": { "tile": { "$": "participant" } } }
}
```

Places a part: a named fragment a module publishes, or one of the host's own chrome pieces.

| Prop      | Value                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`      | REQUIRED. `<module>.<part>` for a module's part; `host.<piece>` for a host chrome piece, which only a template of `role: 'app'` may place. |
| `subject` | An expression: what the part is about, in place of the one it declares.                                                                    |
| `inputs`  | An object of name to value: the names the part reads that nothing around it binds.                                                         |

The part's node is drawn where the `$part` stands, with its declared subject expression replaced by
`subject` wherever it appears as a whole token, and each input bound for the part's subtree. It is
drawn inside a box-less frame that names the part, so a tool can tell what was placed.

A part the host does not have (its module not installed, or no such part) MUST draw the
[missing marker](degradation-and-versioning.md#the-missing-marker) naming it, and its siblings still
draw. A `$part` with no `id` is invalid and draws nothing. Which parts exist is the module catalogs'
([Catalogs](catalogs.md)); a template naming a module's part SHOULD list the module in
`meta.requires`.

---

Implemented by: [`moduleParts.ts`](../../../packages/app-shell/src/shared/registries/moduleParts.ts)
(`resolveParts`), [`semanticValidation.ts`](../../../packages/schema-system/shared/src/semanticValidation.ts).
Pinned by: render vectors `render.degrade.unknown-part`, `render.degrade.part-no-id`.

## `$panels`

```json
{ "type": "$panels", "props": { "lane": "inspector", "resize": "start", "width": 320 } }
```

The outlet of a home lane: where the panels whose declaration says `home: '<lane>'` are drawn, in
the template's own flow. `lane` is REQUIRED non-empty text. A `$panels` MUST NOT be inside a panel's
node. See [Home lanes](panels.md#home-lanes).

---

Implemented by: [`moduleParts.ts`](../../../packages/app-shell/src/shared/registries/moduleParts.ts)
(rewritten to the host's lane), [`PanelLane.tsx`](../../../packages/app-shell/src/frameworks/solid/components/PanelLane.tsx).
Pinned by: render vector `render.panels.outlet`.

## `$agent`

```json
{ "type": "$agent", "props": { "did": { "$": "post.author" }, "as": "author" }, "children": [ … ] }
```

| Prop  | Value                                                          |
| ----- | -------------------------------------------------------------- |
| `did` | REQUIRED. An expression giving a person's identifier, as text. |
| `as`  | The name the profile is bound to. Default `agent`.             |

Asks the host for the profile of the person `did` names, and draws all of its children, in order,
with it bound once it has arrived. Draws nothing while `did` is not text or the profile has not
arrived. What a profile holds is the identity profile's ([Catalogs](catalogs.md#profiles)).

---

Implemented by: [`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx)
(the `$agent` branch).
Pinned by: render vector `render.agent.profile`.
