# The template format: stable core

**Spec version 1.0.** Template format version: the root's `schemaVersion`, `1`
([Degradation and versioning](degradation-and-versioning.md)).

A template is a user interface written as JSON data: a tree of nodes, each naming a component to
draw, the values it is drawn with, and what happens when somebody presses it. It is read against a
catalog of components and a set of named capabilities the host provides, and it holds no code: every
value is a literal or an expression in a small, total language, and every effect is one of a closed
set of handler verbs. Because it is data, a template can be inspected, forked, themed and patched,
and installed from a stranger without running anything the host did not provide.

This spec says what every host must read identically: the shape of a document, what each part of a
node means, how values, expressions, queries and handlers resolve, how a template routes and declares
its panels, what a host does with what it does not understand, and the safety rules that make a
stranger's template safe to render. It does not list the components a host provides, the members of
its stores, or the functions it registers beyond the core library; those are [catalogs](catalogs.md),
named and versioned on their own.

> **Why.** A format defined only by its implementation holds its promises only inside that
> implementation. Written down, with vectors another renderer can run, the template a community
> keeps outlives any one host, and the safety claim travels with the format rather than with one
> renderer.

## Contents

| File                                                        | What it specifies                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [This file](#the-document)                                  | The document, its root keys, conformance classes, terms.                                                                                               |
| [Nodes](nodes.md)                                           | A node's keys, how its `type` is read, text and expression children, slots, ids, the canonical child positions, `$defs` and `$ref`.                    |
| [Blocks](blocks.md)                                         | The `$`-types: `$each`, `$if`, `$single`, `$animate`, `$routes`, `$surface`, `$slot`, `$part`, `$panels`, `$agent`.                                    |
| [Values](values.md)                                         | What a prop holds: literals, the expression token, the query token, handler tokens, how tokens nest; validation rules.                                 |
| [Expressions](expressions.md)                               | The template expression language: the operations subset plus the template's names, namespaces, call-time roots and host functions.                     |
| [Queries](query.md)                                         | `$query` and `$queries`: the where-object, `include`, projections, `scope`, `select`, `when`, order and limits, unresolved operands, the absent value. |
| [Handlers and local state](handlers.md)                     | Event props, `$invoke` and its lifecycle, the local-state verbs, handler-position `$if`, `$localState` with `syncParam` and `persist`.                 |
| [Routing](routing.md)                                       | `routes`, paths and params, the `$routes` outlet, relative paths.                                                                                      |
| [Panels](panels.md)                                         | `meta.panels` as a suggestion, the three-rung resolution, home lanes.                                                                                  |
| [Degradation and versioning](degradation-and-versioning.md) | The format version, how the format and its catalogs evolve, and what a host does with each thing it does not know.                                     |
| [Safety](safety.md)                                         | Capability grants, gesture-only actions, protected pieces, host-drawn confirmation, element and URL allowlists, and the refusals that pin each.        |
| [Catalogs](catalogs.md)                                     | The core catalog and extension catalogs, `meta.requires`.                                                                                              |
| [Conformance](conformance.md)                               | The vector families: their files, how another renderer runs them, how outputs are compared, which are core.                                            |

## The document

A template is a JSON object: a [node](nodes.md) that also carries the root keys below. A _fragment_
is a node meant to be composed into a template, and carries none of them.

| Key                                         | Value                                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                             | REQUIRED. A whole number from 1: the template format the document is written in. This version of the spec defines format `1`.                                    |
| `meta`                                      | REQUIRED. What the template is and how it is listed: below.                                                                                                      |
| `$defs`                                     | Optional. Shapes the template uses more than once ([Shared shapes](nodes.md#shared-shapes-defs-and-ref)). Root only.                                             |
| `id`, `author`, `templateVersion`, `source` | Optional bookkeeping: the template's own id, who wrote it, a count of its author's edits, and the bundle it was installed from. They carry no rendering meaning. |

A reader MUST check `schemaVersion` before anything else
([The format version](degradation-and-versioning.md#the-format-version)).

**`meta`** holds `name`, `description` and `icon` (all REQUIRED text), and optionally:

| Key                               | Meaning                                                                                                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role`                            | What the template is: `shell` (the default: a whole interface, its chrome and route table), `view` (one section inside a shell), `app` (the chrome around every space), or `page` (a page of an app's own). |
| `segment`, `keepAlive`            | For a `view`: the URL segment it suggests, and whether it stays mounted when a sibling is shown ([Routing](routing.md#keepalive-and-redirect)).                                                             |
| `panels`                          | The panels the interface has ([Panels](panels.md)).                                                                                                                                                         |
| `requires`                        | What the template depends on that a host might not have ([Catalogs](catalogs.md#declaring-what-a-template-requires)).                                                                                       |
| `themeId`, `themeIds`             | A theme the template is designed to be seen in, or several with the default first. A suggestion, never a setting.                                                                                           |
| `draws`, `recordViews`            | For a record's own page: the entity (and kind) a view draws, and how this template draws one record by type.                                                                                                |
| `chromeReserve`, `frame`, `edges` | Room a shell's or an app's own chrome holds, for panels to keep clear of.                                                                                                                                   |
| `stores`, `components`            | Informative lists of what the template names. A host MUST NOT grant anything because of them.                                                                                                               |

`meta` is closed: a key not listed here makes the template invalid. The meaning of `role`, `draws`,
`recordViews`, `chromeReserve`, `frame` and `edges` beyond this table is the host's: they say where a
template sits among a host's surfaces, which is not something another host has to share.

> **Planned.** A host-neutral description of `app`, `page` and record views, the three roles that
> exist because of how WE arranges its own surfaces.

---

Implemented by: [`types.ts`](../../../packages/schema-system/shared/src/types.ts) (`TemplateSchema`,
`TemplateMeta`), [`zodSchemas.ts`](../../../packages/schema-system/shared/src/zodSchemas.ts)
(`zTemplateSchema`, `zTemplateMeta`),
[`templateFormat.ts`](../../../packages/schema-system/shared/src/templateFormat.ts).
Pinned by: [`zodSchemas.test.ts`](../../../packages/schema-system/shared/tests/zodSchemas.test.ts),
[`templateFormat.test.ts`](../../../packages/schema-system/shared/tests/templateFormat.test.ts).

## Conformance classes

An implementation claims one or more of these, for a spec version:

- **A validator** reads a document and judges it: it checks the format version first, refuses a
  document that breaks the structure this spec gives, and reports what the semantic rules here call
  invalid. It renders nothing.
- **A renderer** draws a template: nodes, block types, values, expressions, local state, handlers and
  routing, as this spec says, and degrades as [Degradation](degradation-and-versioning.md#degradation)
  says. It MUST apply the element and URL refusals of [Safety](safety.md#elements-and-urls), which
  are the renderer's to enforce whatever host it runs in. A renderer that does not handle events (a
  static or server renderer) MAY claim to be a _static renderer_: everything except handlers and
  steps.
- **A host** is a renderer that loads templates and decides what they may do. It MUST provide every
  host duty of [Safety](safety.md) and [Panels](panels.md). A host that renders a template it did not
  write itself (one installed, synced or shared from somebody else) MUST conform as a host.

Each class is tested by the vector families [Conformance](conformance.md#which-families-a-class-runs)
names for it.

## Terms

The terms of [the specs' conventions](../README.md#conventions) apply. Also:

- **A node** is a JSON object in a node position ([Child positions](nodes.md#child-positions)).
- **A token** is a JSON object whose keys start with `$` and which stands for something computed or
  done: an expression, a query, or a handler ([Values](values.md)).
- **The bag** is what a template's expressions and handlers can name: the stores, the module stores
  and the host values the host grants it ([Capability grants](safety.md#capability-grants)).
- **The context** is the names the nodes above a position have bound: `$localState` fields,
  `$each`'s item, `index` and `prev`, the event inside a handler. "Above" is lexical: a route's body
  is below the node that lists it and a panel's node below the root, wherever each is drawn
  ([Scope across passes](handlers.md#scope-across-passes)).
- **No value** is the absence of a value, as in the expression language
  ([Values](../operations/expressions.md#values)). JSON has no spelling for it; a key that is left out
  is no value.
