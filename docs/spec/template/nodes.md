# Template format: nodes

## A node's keys

A node is a JSON object with these keys, all optional. The set is closed: a node carrying any other
key is invalid.

| Key                        | Value                                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                     | What to draw ([The type](#the-type)). Absent: a fragment, which draws its children and no element of its own.                                                                 |
| `props`                    | An object of prop name to value ([Values](values.md)).                                                                                                                        |
| `children`                 | A list of text, expression tokens and nodes ([Children](#children)).                                                                                                          |
| `slots`                    | An object of slot name to node: content a component places by name ([Slots](#slots)).                                                                                         |
| `slot`                     | Text: the name of the web-component slot this node is drawn into.                                                                                                             |
| `routes`                   | A list of routes ([Routing](routing.md)).                                                                                                                                     |
| `$localState`              | Local state this node declares ([Local state](handlers.md#local-state)).                                                                                                      |
| `$queries`                 | Queries this node hoists ([Hoisted queries](query.md#hoisted-queries-queries)).                                                                                               |
| `$defs`                    | Shared shapes. Root only ([Shared shapes](#shared-shapes-defs-and-ref)).                                                                                                      |
| `id`                       | The node's identity ([Ids](#ids-and-keys)).                                                                                                                                   |
| `key`                      | Text naming the node among its siblings ([Ids](#ids-and-keys)).                                                                                                               |
| `theme`                    | Theme parameters scoped to this subtree. Their vocabulary is the theme catalog's ([Catalogs](catalogs.md)).                                                                   |
| `styles`                   | An object of CSS property to text or number, applied to a box the renderer puts around the node. An escape hatch; the design system's props come first.                       |
| `forkedFrom`, `forkedPart` | Editing bookkeeping: the shared shape or the module part this node was copied from. They carry no rendering meaning; a reader MUST preserve them when it rewrites a document. |

A route is a node with three more keys, `path`, `redirect` and `keepAlive`
([Routing](routing.md#routes)). The root is a node with the [root keys](README.md#the-document).

---

Implemented by: [`types.ts`](../../../packages/schema-system/shared/src/types.ts) (`SchemaNode`,
`RouteSchema`), [`zodSchemas.ts`](../../../packages/schema-system/shared/src/zodSchemas.ts)
(`zSchemaNode`, `zRouteSchema`).
Pinned by: [`zodSchemas.test.ts`](../../../packages/schema-system/shared/tests/zodSchemas.test.ts);
render vectors `render.node.component`, `render.node.fragment`, `render.node.nested`.

## The type

`type` is text, and its spelling says what kind of thing it names:

| Spelling                         | Names                                                                                                | Drawn as                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| starts with `$`                  | A block type ([Blocks](blocks.md)), or `$ref` ([below](#shared-shapes-defs-and-ref)).                | What that block type says.                                   |
| starts with an upper-case letter | A component in the host's catalog (`Column`, `Card`).                                                | The component, given the resolved props, children and slots. |
| contains `-`                     | A custom element: one of the core catalog's `we-` elements, or a foreign element a deployment names. | The element, with each resolved prop set as a property.      |
| lower case, no `-`               | A native element, when it is on the [element allowlist](safety.md#elements-and-urls).                | The element, with each resolved prop as an attribute.        |

A type the host cannot draw is [degraded](degradation-and-versioning.md#degradation), never dropped
in silence and never fatal to the rest of the tree. A native element off the allowlist is the one
exception: it is refused and draws nothing ([Safety](safety.md#elements-and-urls)).

A node's type is fixed when it is drawn. A renderer MAY redraw a node whose type changes, and is not
required to update one in place.

---

Implemented by: [`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx)
(`RenderNode`), [`templateElements.ts`](../../../packages/schema-system/shared/src/templateElements.ts).
Pinned by: render vectors `render.node.component`, `render.node.custom-element`, `render.node.native`,
`render.degrade.unknown-component`, `render.degrade.unknown-element`,
`render.degrade.unknown-element-in-list`, `render.degrade.foreign-element`, `render.safety.native-tags`.

## Children

`children` is a list, drawn in order. Each entry is one of:

- **Text** — a string, drawn as text exactly as written. A string is never a reference, whatever it
  starts with: `"$item.name"` draws those ten characters.
- **An expression token** — `{ "$": "…" }`, drawn as its value converted to text
  ([To text](../operations/expressions.md#conversions)), and as nothing when it is no value or `null`.
  It follows the data it reads.
- **A node.**

How an entry is told apart: a string is text; an object with a `type` or an `id` is a node, whatever
else it carries; any other object whose keys all start with `$` is a token; any other object is a
node. Any other token (a query, a handler) in `children` is invalid, and a validator refuses it.

A list entry that is neither a string nor an object is invalid.

> **Why only the expression.** A child is drawn inside the render, where a query's subscription has
> no owner and a handler has no event. A question for the backend is hoisted into `$queries` and
> read back through `local` ([Queries](query.md#hoisted-queries-queries)).

---

Implemented by: [`treeUtils.ts`](../../../packages/schema-system/shared/src/treeUtils.ts)
(`isSchemaChild`), [`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx)
(`renderChildren`).
Pinned by: render vectors `render.node.text-children`, `render.node.expression-child`,
`render.node.reactive-prop`; [`zodSchemas.test.ts`](../../../packages/schema-system/shared/tests/zodSchemas.test.ts)
(the tokens a child refuses).

## Slots

`slots` maps a name to a node. A component that takes named content receives each slot's node drawn,
under its name, beside its children. Which names a component takes is the catalog's to say; a slot
the component does not take is not drawn.

`slot` on a node is different: it names the slot of the enclosing custom element (the web-components
`slot` attribute) the node is drawn into.

---

Implemented by: [`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx).
Pinned by: render vectors `render.node.slots`, `render.node.slot-attribute`.

## Ids and keys

`id` is the node's identity: text, unique among the nodes of the document as written (a shared
shape's nodes are one set of ids however many places use it), and permanent. An editor addresses a
node by it, and a patch to a template names the node it changes by it. A reader MUST preserve every
`id` it reads. A document need not carry ids; a writer that adds them gives every node one.

`key` is text the author gives a node to name it among its siblings. A host that derives ids for a
document that carries none (a template built into the host) MAY use it, so that a node keeps its
derived id when its siblings are reordered.

Neither changes what is drawn.

---

Implemented by: [`nodeIdentity.ts`](../../../packages/schema-system/shared/src/nodeIdentity.ts),
[`indexer.ts`](../../../packages/schema-system/shared/src/indexer.ts) (`ensureNodeIds`,
`findNodeById`).
Pinned by: [`nodeIdentity.test.ts`](../../../packages/schema-system/shared/tests/nodeIdentity.test.ts),
[`indexer.test.ts`](../../../packages/schema-system/shared/tests/indexer.test.ts).

## Child positions

A node holds other nodes at exactly these positions, visited in this order:

1. **`children`** — each entry of `children` that is a node ([Children](#children)). Every node
   entry is part of the tree.
2. **`routes`** — each entry of `routes`. A route is always a node.
3. **`slots`** — the node under each name in `slots`.
4. **`props`** — the value of each _node prop_. A node prop is a prop its type declares as taking a
   node: `then` and `else` of a [`$if`](blocks.md#if), and each prop a component's catalog entry
   declares as taking one ([Node props](#node-props)).
5. **`panels`** — the `node` of each `meta.panels` entry. The entry itself is configuration.
6. **`$defs`** — each value of `$defs`. Root only.

Nothing else is a node position. In particular, **a node-shaped value in any other prop is data**: it
is handed to the component as the JSON it is, not drawn, not judged as a node, and not given an id. A
node inside a handler's arguments, an option list or a transition config is data the same way.

A walk of the tree **as drawn** visits positions 1–5, and meets a shared shape at each `$ref` that
names it (or walks the tree with every `$ref` [expanded](#shared-shapes-defs-and-ref)). A walk of the
**document** (giving ids, copying, stripping) visits all six.

> **Why one answer.** Every tool that walks a template (the renderer, the validator, the id writer,
> the editor's layers tree, the audits) has to agree on what a node's children are. When each
> decided for itself they disagreed, and each disagreement was silent: nodes in a panel with no ids,
> a component in a panel invisible to an uninstall check, a route outlet in a prop reported missing.

---

Implemented by: [`treeUtils.ts`](../../../packages/schema-system/shared/src/treeUtils.ts)
(`NODE_PROPS`, `CHILD_POSITIONS`, `RENDERED_POSITIONS`, `forEachChild`, `childrenOf`, `mapChildren`).
Pinned by: [`childPositions.test.ts`](../../../packages/schema-system/shared/tests/childPositions.test.ts)
(one template with a node at every position and a non-node beside each, every walk checked against
it); render vector `render.node.prop-node-is-data`.

## Node props

A component's catalog entry says which of its props take a node: in the core catalog, `FlipCard`'s
`front` and `back`, and `GraphView`'s `emptyAction`. A component declares one by giving the prop an
element as its type; nothing about the value a template writes makes a prop a node prop.

- **Drawn.** A renderer draws the node in a declared node prop, in the scope of the node that holds
  it (its `$localState`, its bound names, the template root's locals), and hands the component what
  it drew under the prop's name, as it hands a [slot](#slots). Text in a node prop is drawn as text.
  A token there is invalid, and a validator refuses it.
- **A child.** The node is at a [child position](#child-positions) like any other: it carries an id,
  an edit reaches it, and a validator judges it as a node.
- **Only where declared.** The same prop name on a component that does not declare it holds data.

A node prop and a slot of the same name reach the component the same way. A node prop is checked
against the catalog; a slot's name is the component's to accept or ignore.

---

Implemented by: [`componentNodeProps.ts`](../../../packages/schema-system/shared/src/generated/componentNodeProps.ts)
(`COMPONENT_NODE_PROPS`, generated from each component's declaration by
[`generate.ts`](../../../packages/ai-context/src/generate.ts)), [`treeUtils.ts`](../../../packages/schema-system/shared/src/treeUtils.ts)
(`NODE_PROPS`), [`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx)
(`RenderNode`), [`semanticValidation.ts`](../../../packages/schema-system/shared/src/semanticValidation.ts)
(`checkProps`).
Pinned by: [`childPositions.test.ts`](../../../packages/schema-system/shared/tests/childPositions.test.ts),
[`semanticValidation.test.ts`](../../../packages/schema-system/shared/src/semanticValidation.test.ts);
render vectors `render.node.component-node-prop`, `render.node.component-node-prop-scope`,
`render.node.prop-node-is-data`.

## Shared shapes: `$defs` and `$ref`

The root MAY carry `$defs`, an object of name to node: shapes the template uses more than once. A
`$ref` node stands at each place one is used:

```json
{ "type": "$ref", "props": { "def": "d1" } }
```

A `$ref` draws exactly what a copy of the named shape, written in its place, would draw: the same
nodes, reading the same context. A shape MAY contain `$ref`s to other shapes. A `$ref` carries an
`id` like any node, and the copy it stands for takes its place in the tree.

- **Expansion.** A reader MAY expand every `$ref` before doing anything else with a template, and
  the result means the same as the template. A validator MUST judge a template as expanded, so a
  mistake inside a shape is reported at each use.
- **A missing shape** (a `def` naming nothing in `$defs`, or a `$ref` in a document with no `$defs`)
  and **a cycle** (a shape that reaches itself through `$ref`s) MUST draw the
  [missing marker](degradation-and-versioning.md#the-missing-marker) saying which, at the `$ref` where
  it occurs. A reader MUST NOT recurse without bound on a cycle. A validator reports both as errors.
- **Where.** `$defs` is root only: a `$defs` on any other node is invalid. A `$ref` may stand at any
  node position of the root's own tree.

Shapes are an encoding, not a commitment: whether two identical shapes are stored once or twice is
invisible to everything that reads the template. A writer MAY hoist identical shapes into `$defs`,
and MAY write a use back out as a copy.

A `$ref` in a route body or a panel's node names the root's shapes like any other, though those are
drawn as passes of their own ([Scope across passes](handlers.md#scope-across-passes)).

> **Why inside the document.** A template that cited shapes kept elsewhere could not be read as the
> thing it will be, and could not be judged before it runs. Kept in `$defs`, everything that will
> render is still in the document, said once.

---

Implemented by: [`definitions.ts`](../../../packages/schema-system/shared/src/definitions.ts)
(`REF_TYPE`, `expandDefinitions`, `compactDefinitions`),
[`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx)
(`RenderSchema`), [`semanticValidation.ts`](../../../packages/schema-system/shared/src/semanticValidation.ts)
(`validateSchema`, which expands first).
Pinned by: [`definitions.test.ts`](../../../packages/schema-system/shared/src/definitions.test.ts);
render vectors `render.node.ref`, `render.node.ref-nested`, `render.node.ref-missing`,
`render.node.ref-no-defs`, `render.node.ref-cycle`, `render.node.ref-cycle-through`, `render.routes.ref`,
`render.routes.ref-missing`, `render.panels.root-scope`.
