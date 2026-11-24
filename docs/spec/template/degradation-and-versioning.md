# Template format: degradation and versioning

Four things carry versions, and they move independently:

| What                | Where                                                                                     | Changes when                                              |
| ------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| This spec           | The top of the [README](README.md)                                                        | The format or its semantics change.                       |
| A template's format | The root's `schemaVersion`                                                                | A template uses something an older reader cannot read.    |
| A catalog           | The catalog's own version ([Catalogs](catalogs.md))                                       | Its components, props, members or functions change.       |
| A bundle file       | The bundle's `formatVersion` ([Operations: bundles](../operations/versioning.md#bundles)) | The bundle carries something an older reader cannot read. |

A template's `templateVersion`, a count of its author's edits, is not a format version, and nor is a
theme's own `schemaVersion`, which numbers the theme's parameters.

## The format version

Every template root carries `schemaVersion`, the template format it is written in. This spec defines
format `1`.

- A reader MUST check `schemaVersion` before anything else, and MUST refuse a template whose
  `schemaVersion` is not a format it reads, reporting only that (the version found and the versions
  it reads), and nothing about the rest of the template: a newer format is free to change the very
  shape the rest of the checks would judge.
- A `schemaVersion` that is not a whole number from 1 is refused the same way.
- A template stored without one is read as format `1`. A writer MUST write it, and a validator
  SHOULD warn about a template without it.
- A fragment carries none: it takes the format of the template it is composed into.

> **Why first, and alone.** A host meeting a template written for a newer format can only guess
> which parts it understands, and a guess renders a template that looks right and is quietly missing
> what the newer format added. Refused with the reason, the person knows to update the host.

---

Implemented by: [`templateFormat.ts`](../../../packages/schema-system/shared/src/templateFormat.ts)
(`TEMPLATE_SCHEMA_VERSION`, `TEMPLATE_SCHEMA_VERSIONS`, `templateVersionProblem`, `readTemplate`),
[`validators.ts`](../../../packages/schema-system/shared/src/validators.ts) (`validateStructure`),
[`semanticValidation.ts`](../../../packages/schema-system/shared/src/semanticValidation.ts) (`validateSchema`).
Pinned by: [`templateFormat.test.ts`](../../../packages/schema-system/shared/tests/templateFormat.test.ts);
[`semanticValidation.test.ts`](../../../packages/schema-system/shared/tests/semanticValidation.test.ts)
(the version is judged before shared shapes are expanded).

## How the format evolves

The rules follow AT Protocol Lexicon's for evolving a schema, as the operations spec's do
([Operations: versioning](../operations/versioning.md)): once published, a meaning is not changed
under the same version.

**A minor version of this spec** adds to the format without changing what any valid template already
means: a new block type, a new key with a default that keeps today's meaning, a new core function. A
reader of an older minor version meets the addition as something it does not know, and
[degrades](#degradation). **No syntax is added to the expression language in a minor version.**

**A new format version** (`schemaVersion` 2) is needed for any change a format 1 reader would read
wrongly rather than degrade on: a key whose meaning changes, a default that changes, a value that was
text becoming something else. A writer MUST stamp the lowest format that holds what the template
uses, so a template that uses nothing new stays readable by every host that reads its format.

**Catalogs** carry semantic versions of their own. A minor version is additive only, and the test is
applied both ways: a change MUST NOT tighten what an author may write (a prop removed, a value
narrowed, a required argument added) nor loosen what a reader must handle (a new value of an existing
prop that an older component would misread). Anything else is a major version, and comes with a
migration a host can apply to a stored template.

## Degradation

What a host does with each thing it does not know or cannot provide. The rule throughout: **a
visible placeholder that says why, never a silent blank, and never a crash** of anything but the one
node.

| What                                                                        | Result                                                                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A format version it does not read                                           | The template is refused, with the reason ([above](#the-format-version)).                                                                    |
| A template that breaks the structure (a key no node has, a malformed token) | The template is refused, with the errors. Nothing of it is drawn.                                                                           |
| An unknown component (an upper-case type the catalog lacks)                 | The [missing marker](#the-missing-marker), naming the type. Its siblings draw.                                                              |
| An unknown `$`-type                                                         | The missing marker.                                                                                                                         |
| An unknown `we-` custom element (one the core catalog does not define)      | The missing marker, replaced by the element if one of that name is defined later.                                                           |
| A foreign custom element (a hyphenated type outside `we-`)                  | Mounted as the element it names. Whether it is defined is the deployment's ([Catalogs](catalogs.md)).                                       |
| A native element off the allowlist                                          | Nothing: refused ([Safety](safety.md#elements-and-urls)). Not a marker, since the marker is for what is missing, not for what is forbidden. |
| A missing or cyclic `$ref`                                                  | The missing marker, saying which ([Shared shapes](nodes.md#shared-shapes-defs-and-ref)).                                                    |
| A module part the host does not have                                        | The missing marker, naming the part ([`$part`](blocks.md#part)).                                                                            |
| A `$slot` in a template                                                     | The missing marker ([`$slot`](blocks.md#slot)).                                                                                             |
| An unknown prop on a known component                                        | Reported by a validator. A renderer passes it to the component or drops it, and MUST NOT fail.                                              |
| A store member, a module or a host value outside the bag                    | No value; an action does nothing ([Capability grants](safety.md#capability-grants)).                                                        |
| A host function the host does not provide                                   | No value ([Host functions](expressions.md#host-functions)).                                                                                 |
| An expression that does not parse, or reads something absent                | No value where it stands.                                                                                                                   |
| A query the backend cannot run                                              | Refused: `[]`, and the reason reported ([Refusal](query.md#refusal)).                                                                       |
| A catalog the template requires and the host lacks (`meta.requires`)        | The template is drawn, with the parts that need the catalog degrading as above, and the host reports what is missing.                       |

### The missing marker

A box drawn in the node's place that says what could not be drawn and why: the type, and the reason.
It takes no state and opens no subscription. Its look is the host's; that it is visible, says why,
and leaves its siblings drawn is normative.

| Reason               | What could not be drawn                                                            |
| -------------------- | ---------------------------------------------------------------------------------- |
| `unknown-component`  | A type the host has nothing for: a component, a `$`-type, a `$slot` in a template. |
| `unknown-element`    | A `we-` custom element nothing defines.                                            |
| `missing-definition` | A `$ref` whose `def` names no shape in `$defs`.                                    |
| `cyclic-definition`  | A `$ref` to a shape already being drawn above it.                                  |

In the render vectors it is `{ "missing": "<type>", "reason": "<reason>" }`
([Conformance](conformance.md#render-trees)).

> **Why never blank.** An unmatched read that looks exactly like an empty one is this format's most
> expensive failure: it is not reported, so it is not fixed. The marker is what makes "a module is
> not installed here" and "the type is misspelt" visible to whoever can act on them.

---

Implemented by: [`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx)
(`MissingMarker`, the component lookup), [`templateElements.ts`](../../../packages/schema-system/shared/src/templateElements.ts),
[`definitions.ts`](../../../packages/schema-system/shared/src/definitions.ts),
[`moduleParts.ts`](../../../packages/app-shell/src/shared/registries/moduleParts.ts),
[`templateAcceptance.ts`](../../../packages/app-shell/src/shared/templateAcceptance.ts).
Pinned by: render vectors `render.degrade.unknown-component`, `render.degrade.unknown-element`,
`render.degrade.unknown-element-in-list`, `render.degrade.foreign-element`,
`render.degrade.unknown-part`, `render.degrade.part-no-id`, `render.degrade.failing-expression`,
`render.node.ref-missing`, `render.node.ref-no-defs`, `render.node.ref-cycle`,
`render.node.ref-cycle-through`, `render.slot.in-template`,
`render.handler.missing-method`; [`templateAcceptance.test.ts`](../../../packages/app-shell/tests/templateAcceptance.test.ts).
