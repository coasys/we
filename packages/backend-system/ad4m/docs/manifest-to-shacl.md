# Manifest extras → AD4M SHACL: gap table

Which `EntityManifest` fields WE hands to AD4M, and which it still keeps for itself.
Both compilers (core codegen `scripts/generateClasses.mjs`, runtime
`src/manifestCompiler.ts`) go through the AD4M SDK decorators — nothing here builds
SHACL by hand.

| extra                  | where used                                                                        | AD4M term                                                   | status                                                                                                                                                                                                                                                                                                      | AD4M task   |
| ---------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `options`              | 8 props / 6 classes (7 emitted — `TaskBlock.status` suppressed, see `vocabulary`) | `sh:in`                                                     | written by both compilers. The executor enforces `sh:in` on a validated scalar instance write. That does not cover every raw-link or legacy SDK write. `shapeIsStale` does not compare `sh:in`, so an existing space keeps its stored shape until we#432 registers shapes again                             | A1          |
| `abstract`             | `WeNode` (manifest only) + module/community entities                              | `ad4m://abstract`                                           | written by the runtime compiler. Hand-written `WeNode.ts` stays `@Model` without `abstract`: the manifest says abstract, the class is concrete, and children of `WeNode` therefore take the concrete path. Changing the class would change classification and creation                                      | none        |
| `extends`              | module/community entities only (0 core uses)                                      | `sh:node`                                                   | written for both kinds of parent. A concrete parent is TypeScript `extends`, which emits `sh://node`. An abstract parent keeps `implements` (the name check) and the compiled shape also calls `addParentShape` with the parent's shape URI. Flattening stays: the child still carries the parent's members | A2          |
| `default`              | 41 classes / 256 props                                                            | `sh:defaultValue`                                           | not written by the manifest compilers (`shapeCodec` writes it for space shapes)                                                                                                                                                                                                                             | A2, then W2 |
| `description`          | 15 entity descriptions                                                            | `sh:description` / `rdfs:comment`                           | not written                                                                                                                                                                                                                                                                                                 | A2, then W2 |
| `control`              | 13 classes / 19 props                                                             | `shui:editor` (DASH `dash:editor` today in `shapeCodec`)    | not written                                                                                                                                                                                                                                                                                                 | A2, then W2 |
| `display`              | 5 classes                                                                         | `shui:propertyRole` + `sh:order`                            | not written                                                                                                                                                                                                                                                                                                 | A2, then W2 |
| `authoring`            | 16 classes                                                                        | `sh:order` + `sh:group`                                     | not written                                                                                                                                                                                                                                                                                                 | A2, then W2 |
| `format` (viewer side) | 8 classes / 10 props                                                              | `shui:ImageViewer` / `HyperlinkViewer`                      | `resolve_language` written; no viewer hint term                                                                                                                                                                                                                                                             | A2, then W2 |
| `vocabulary`           | `TaskBlock.status`                                                                | none — per-space value set; a fixed `sh:in` would reject it | deliberately not written; candidate: per-space `sh:in` shapes                                                                                                                                                                                                                                               | T1          |
| `blockable`            | 15 classes                                                                        | none (WE `we://blockable`)                                  | not written                                                                                                                                                                                                                                                                                                 | A2, then W2 |
| `extractable`          | 3 classes                                                                         | none (WE `we://extractable`)                                | not written                                                                                                                                                                                                                                                                                                 | A2, then W2 |
| `composed`             | `CollectionBlock`                                                                 | `shui:DetailsEditor`                                        | not written                                                                                                                                                                                                                                                                                                 | A2, then W2 |

Rows and "where used" counts from `mapping/manifest-extras.md` (42 entities, 265
properties). `shapeCodec.ts` still writes the annotation links. On a shape WE
marked, a missing annotation is filled from the native field when the value is
one the manifest can say: string options, a number whose text converts exactly,
`abstract: true`, and one parent URI that matches a generated class. Labels, an
ambiguous numeric string, several parents, or an unknown parent stay
non-editable when a save would drop them.

## Note on `sh:in` values, and what reaches existing spaces

An `sh:in` entry is `{ value: string }` — the SDK's `PropertyOptions.options`
type requires the string form. A _number_ property stores its values as
`literal:number:2` (`valueToLiteralIri` → `Literal.from(2).toUrl()`), while its
option is `{ value: '2' }` — the decoded scalar's string form. A URI-valued
option (`task://todo`) stores the URI itself, so one rule covers both: **A1
compares `String(term)` against `value`, where `term` is
`Literal.fromUrl(target).get()` for a `literal:` target and the target itself
otherwise.**

`sh:in`, and `sh:node` from a runtime-compiled `extends`, reach a space when its
shapes are registered. `shapeIsStale` (`src/sdnaEntities.ts`) compares property
paths, counts, identity and hints. It does not compare `sh:in` or `sh:node`, so
a space that already holds the shape keeps the old one. Registering the new
links in existing spaces is we#432 together with ad4m#1666. This delta does not
add another staleness check.

A stored `ad4m://auto_accept` link is not a manifest field. The pinned SDK
(`@coasys/ad4m@0.13.1-staging.10`) has no `auto_accept` on the shape, and
ad4m#1710 is not a prerequisite for this mapping. A save that does not write
the predicate leaves the shape non-editable, so the link is not removed.

## Note on `extends` for a concrete parent

The child class is declared `class Child extends Parent`, so the SDK emits
`ChildShape → sh://node → ParentShape`. An abstract parent cannot be that
superclass: the child stays `extends Ad4mModel`, `implements` checks the names,
and `addParentShape` adds the same `sh://node` from the parent's
`nodeShapeUri`. Inherited members are **also** still flattened onto the child,
so the property decorators on the parent are re-applied on the child — the SDK
tolerates re-decoration of an inherited property (last decorator wins), and
`sh:node` is informational rather than a substitute for the child's own
declarations. If a future SDK reads `sh:node` as _exclusive_ inheritance,
flattening can be dropped.

`WeNode` is the exception already in the tree. `WE_NODE_ENTITY` says
`abstract: true`. `WeNode.ts` does not. A child of `WeNode` therefore extends
the concrete class and gets `sh://node` from the prototype, not from
`addParentShape`. The class stays concrete on purpose.
