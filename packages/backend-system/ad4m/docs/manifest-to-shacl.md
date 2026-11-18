# Manifest extras → AD4M SHACL: gap table

Which `EntityManifest` fields WE hands to AD4M, and which it still keeps for itself.
Both compilers (core codegen `scripts/generateClasses.mjs`, runtime
`src/manifestCompiler.ts`) go through the AD4M SDK decorators — nothing here builds
SHACL by hand.

Each status separates three things. **Compilers** are `scripts/generateClasses.mjs` and
`src/manifestCompiler.ts`. **Codec** is an annotation `src/shapeCodec.ts` already writes.
**Proposal** is a SHACL UI term. Nothing in this tree reads a proposal.

| extra                  | where used                                                                        | AD4M term                                                                    | status                                                                                                                                                                                                                                                                                                                                                                                                                      | AD4M task   |
| ---------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `options`              | 8 props / 6 classes (7 emitted — `TaskBlock.status` suppressed, see `vocabulary`) | `sh:in`                                                                      | Compilers: both write `sh:in`. Codec: `we://options` keeps the author's values, their order, and number versus string. Executor: enforces `sh:in` on a validated scalar instance write. That does not cover every raw-link or legacy SDK write. `shapeIsStale` does not compare `sh:in`, so an existing space keeps its stored shape until we#432 and ad4m#1666 register shapes again                                       | A1          |
| `abstract`             | `WeNode` (manifest only) + module/community entities                              | `ad4m://abstract`                                                            | Compilers: the runtime compiler writes `ad4m://abstract`. Codegen forwards a declared `abstract: true` into `@Model`. Codec: `dash:abstract`. Hand-written `WeNode.ts` stays `@Model` without `abstract`: the manifest says abstract, the class is concrete, and children of `WeNode` take the concrete path. Changing the class would change classification and creation                                                   | none        |
| `extends`              | module/community entities only (0 core uses)                                      | `sh:node`                                                                    | Compilers: both write `sh://node`. A concrete parent is TypeScript `extends`. An abstract parent keeps `implements`, and `addParentShape` uses the parent's shape URI, read when the child shape is generated. Codegen forwards a declared `extends` and imports that parent. `def.base` is the fallback when `extends` is absent. Codec: `rdfs:subClassOf`. Flattening stays: the child still carries the parent's members | A2          |
| `default`              | 41 classes / 256 props                                                            | proposal: compilers do not emit `sh:defaultValue`                            | Compilers: not written. Codec: writes `sh:defaultValue` on a space shape. Proposal: emitting `sh:defaultValue` from the compilers is not a reader this change adds                                                                                                                                                                                                                                                          | A2, then W2 |
| `description`          | 15 entity descriptions                                                            | proposal: `sh:description`. Codec writes `rdfs:comment`                      | Compilers: not written. Codec: writes `rdfs:comment`. Proposal: `sh:description` is not an implemented reader                                                                                                                                                                                                                                                                                                               | A2, then W2 |
| `control`              | 13 classes / 19 props                                                             | proposal: `shui:editor`. Codec writes `dash:editor`, or `we://control`       | Compilers: not written. Codec: writes `dash:editor` for a known control, otherwise `we://control`. Proposal: `shui:editor` is not an implemented reader                                                                                                                                                                                                                                                                     | A2, then W2 |
| `display`              | 5 classes                                                                         | proposal: `shui:propertyRole` + `sh:order`. Codec writes `dash:propertyRole` | Compilers: not written. Codec: writes `dash:propertyRole`, `sh:order` for declaration order, and `we://display_order` for a card's key fields, or one `we://display` when roles cannot say the card. Proposal: `shui:propertyRole` is not an implemented reader                                                                                                                                                             | A2, then W2 |
| `authoring`            | 16 classes                                                                        | proposal: `sh:order` + `sh:group`. Codec writes `we://authoring`             | Compilers: not written. Codec: writes `we://authoring`. Proposal: `sh:order` + `sh:group` as the authoring mapping is not an implemented reader. `sh:order` is already written for declaration order, not for authoring groups                                                                                                                                                                                              | A2, then W2 |
| `format` (viewer side) | 8 classes / 10 props                                                              | proposal: `shui:ImageViewer` / `HyperlinkViewer`                             | Compilers: `resolve_language` is written for a file property. Codec: no viewer-hint annotation. Proposal: `shui:ImageViewer` / `HyperlinkViewer` are not implemented readers                                                                                                                                                                                                                                                | A2, then W2 |
| `vocabulary`           | `TaskBlock.status`                                                                | none — per-space value set; a fixed `sh:in` would reject it                  | Compilers: deliberately no `sh:in`. Codec: writes `we://vocabulary`. Proposal: a per-space `sh:in` shape is not implemented                                                                                                                                                                                                                                                                                                 | T1          |
| `blockable`            | 15 classes                                                                        | none. Codec writes `we://blockable`                                          | Compilers: not written. Codec: writes `we://blockable`. No SHACL term is proposed as a reader                                                                                                                                                                                                                                                                                                                               | A2, then W2 |
| `extractable`          | 3 classes                                                                         | none. Codec writes `we://extractable`                                        | Compilers: not written. Codec: writes `we://extractable`. No SHACL term is proposed as a reader                                                                                                                                                                                                                                                                                                                             | A2, then W2 |
| `composed`             | `CollectionBlock`                                                                 | proposal: `shui:DetailsEditor`. Codec writes `we://composed`                 | Compilers: not written. Codec: writes `we://composed`. Proposal: `shui:DetailsEditor` is not an implemented reader                                                                                                                                                                                                                                                                                                          | A2, then W2 |

Rows and "where used" counts from `mapping/manifest-extras.md` (42 entities, 265
properties). On a shape WE marked, a missing annotation is filled from the native
field when the value is one the manifest can say: string options, a bare string
or finite number, `{ value }` of either, a number whose text converts exactly,
`abstract: true`, and one parent URI that matches a generated class. Labels, an
unknown field on an entry, an ambiguous numeric string, several parents, or an
unknown parent stay non-editable when a save would drop them. Repeated
unlabelled copies of one value are the same set as one copy.

## Note on `sh:in` values, and what reaches existing spaces

An `sh:in` entry the compilers write is `{ value: string }` — the SDK's
`PropertyOptions.options` type requires the string form. A stored list may
instead be bare strings, bare numbers, or `{ value: number }`. Comparison uses
the scalar text, as a set. A label or any other field is compared beside that
set. A save that would drop one stays read-only.
A _number_ property stores its values as
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
`nodeShapeUri`. That URI is read when the child shape is generated, after
every class in the manifest is compiled, so a relation on the parent can name
the child or a class compiled later. Inherited members are **also** still flattened onto the child,
so the property decorators on the parent are re-applied on the child — the SDK
tolerates re-decoration of an inherited property (last decorator wins), and
`sh:node` is informational rather than a substitute for the child's own
declarations. If a future SDK reads `sh:node` as _exclusive_ inheritance,
flattening can be dropped.

`WeNode` is the exception already in the tree. `WE_NODE_ENTITY` says
`abstract: true`. `WeNode.ts` does not. A child of `WeNode` therefore extends
the concrete class and gets `sh://node` from the prototype, not from
`addParentShape`. The class stays concrete on purpose.
