# WE specifications

Normative specifications of WE's portable formats: what another implementation has to do to read,
validate and run the same data WE does, and get the same answer. They describe formats, not this
repository's code. Where a spec and the code disagree, one of them is wrong, and the fix is a change
to whichever is.

This directory is laid out to move to its own repository whole. Links between its files are
relative and stay inside it. Links out to the implementation in this repository appear only in the
"Implemented by" and "Pinned by" footer at the end of each section, so the specs read on their own
once those footers are dropped or rewritten.

## The specs

| Spec                                        | What it covers                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Operations](operations/README.md)          | Declared operations: named, parameterised compound writes over records, the steps they are built from, how they run, and the expression subset they compute with.                                                                                                |
| [Capability profiles](profiles/README.md)   | The host state and actions a template relies on beyond records, queries and operations: five named, versioned profiles (navigation, view state, presence, identity, space settings), their members and change events, and what is host-only.                     |
| [Template format, core](template/README.md) | The template format's stable core: nodes and their child positions, block types, values, the template expression language, queries, handlers and local state, routing, panels, degradation and versioning, the safety rules, catalogs, and the renderer vectors. |

## Conventions

**Keywords.** The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
RECOMMENDED, MAY and OPTIONAL are to be interpreted as described in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)
when, and only when, they appear in all capitals. Each is used only where it is meant: a sentence
without one is description, not a requirement.

**Normative and not.** Every section is normative unless it is marked otherwise. Three kinds of text
are set apart and are not:

- _Rationale_, in a block quote starting **Why**, says why a rule is the way it is. Short; the
  rule stands without it.
- _Planned_, in a block quote starting **Planned**, names behaviour the format already leaves room
  for and an implementation does not yet have to provide. A planned item becomes normative only
  when a later version of the spec says so.
- _Examples_ illustrate a rule. Where an example and the rule seem to disagree, the rule wins.

**Versions.** Each spec carries its own version, stated at the top of its README, as
`major.minor`. A minor version adds to the format without changing what a valid document already
means; a major version may. The data a spec describes carries its own format version too (an
operations manifest's `version`, a template's `schemaVersion`, a bundle's `formatVersion`), which is a different number with
its own rules, given in each spec's versioning section.

**Conformance suites.** A spec comes with a suite of language-neutral vectors: inputs and the
outputs a conforming implementation produces from them. The suite is authoritative where the prose
and the suite disagree, and a disagreement is a bug in one of them, to be fixed in whichever is
wrong rather than lived with. An implementation conforms when it passes every vector of the suite
for the spec version it claims, and does what the prose requires where no vector reaches.

**Terms.** _An implementation_ is anything that reads or runs a format: a host running a WE
template, a backend holding records, a runner of operations. _The host_ is the implementation that
loads a document and decides what it may do. _A backend_ is the implementation that stores records
and answers reads and writes on them.
