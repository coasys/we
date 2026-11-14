# Manifest extras → AD4M SHACL: gap table

Which `EntityManifest` fields WE hands to AD4M, and which it still keeps for itself.
Both compilers (core codegen `scripts/generateClasses.mjs`, runtime
`src/manifestCompiler.ts`) go through the AD4M SDK decorators — nothing here builds
SHACL by hand.

| extra                  | where used                                                                        | AD4M term                                                        | status after W1                                                                                                                                                                                                           | AD4M task   |
| ---------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `options`              | 8 props / 6 classes (7 emitted — `TaskBlock.status` suppressed, see `vocabulary`) | `sh:in`                                                          | written by both compilers; reaches only spaces created after this PR — `shapeIsStale` does not compare `sh:in`, so an existing space keeps its stored shape until it goes stale another way; not enforced by the executor | A1          |
| `abstract`             | `WeNode` (manifest only) + module/community entities                              | `ad4m://abstract`                                                | written by the runtime compiler; hand-written `WeNode.ts` unchanged — it is decorated `@Model` without `abstract`, so references resolve to a concrete class (structural match, createable)                               | none        |
| `extends`              | module/community entities only (0 core uses)                                      | `sh:node`                                                        | written: concrete parent → `sh://node` link via TS `extends`; abstract parent → `implements:` (declaration-time structural check, no link). Flattening kept — the child still carries the parent's members                | A2          |
| `default`              | 41 classes / 256 props                                                            | `sh:defaultValue`                                                | not written by the manifest compilers (`shapeCodec` writes it for space shapes)                                                                                                                                           | A2, then W2 |
| `description`          | 15 entity descriptions                                                            | `sh:description` / `rdfs:comment`                                | not written                                                                                                                                                                                                               | A2, then W2 |
| `control`              | 13 classes / 19 props                                                             | `shui:editor` (DASH `dash:editor` today in `shapeCodec`)         | not written                                                                                                                                                                                                               | A2, then W2 |
| `display`              | 5 classes                                                                         | `shui:propertyRole` + `sh:order`                                 | not written                                                                                                                                                                                                               | A2, then W2 |
| `authoring`            | 16 classes                                                                        | `sh:order` + `sh:group`                                          | not written                                                                                                                                                                                                               | A2, then W2 |
| `format` (viewer side) | 8 classes / 10 props                                                              | `shui:ImageViewer` / `HyperlinkViewer`                           | `resolve_language` written; no viewer hint term                                                                                                                                                                           | A2, then W2 |
| `vocabulary`           | `TaskBlock.status`                                                                | none — per-space value set; `sh:in` would be wrong once enforced | deliberately not written; candidate: per-space `sh:in` shapes                                                                                                                                                             | T1          |
| `blockable`            | 15 classes                                                                        | none (WE `we://blockable`)                                       | not written                                                                                                                                                                                                               | A2, then W2 |
| `extractable`          | 3 classes                                                                         | none (WE `we://extractable`)                                     | not written                                                                                                                                                                                                               | A2, then W2 |
| `composed`             | `CollectionBlock`                                                                 | `shui:DetailsEditor`                                             | not written                                                                                                                                                                                                               | A2, then W2 |

Rows and "where used" counts from `mapping/manifest-extras.md` (42 entities, 265
properties). `shapeCodec.ts` annotation links are out of scope for W1 — task W2
decides their fate.

## Note on `sh:in` values, and what reaches existing spaces

An `sh:in` entry is `{ value: string }` — the SDK's `PropertyOptions.options`
type requires the string form. A _number_ property stores its values as
`literal:number:2` (`valueToLiteralIri` → `Literal.from(2).toUrl()`), while its
option is `{ value: '2' }` — the decoded scalar's string form. A URI-valued
option (`task://todo`) stores the URI itself, so one rule covers both: **A1
compares `String(term)` against `value`, where `term` is
`Literal.fromUrl(target).get()` for a `literal:` target and the target itself
otherwise.**

`sh:in`, and `sh:node` from a runtime-compiled `extends`, reach only spaces
created after this PR. `shapeIsStale` (`src/sdnaEntities.ts`) compares a stored
shape's property paths, counts, identity and hints — none of which the new links
change — so a space holding the shape from before keeps it until it goes stale
for another reason. Re-installing shapes in every existing space is a separate
decision.

## Note on `extends` for a concrete parent

The child class is declared `class Child extends Parent`, so the SDK emits
`ChildShape → sh://node → ParentShape`. Inherited members are **also** still
flattened onto the child at the manifest level, so the property decorators on the
parent are re-applied on the child — the SDK tolerates re-decoration of an
inherited property (last decorator wins), and `sh:node` is informational rather
than a substitute for the child's own declarations. If a future SDK reads
`sh:node` as _exclusive_ inheritance, flattening can be dropped.
