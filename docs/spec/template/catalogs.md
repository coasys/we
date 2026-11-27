# Template format: catalogs

This spec defines the format: how a template is read. What a template names inside the format (its
components, their props, the store members it reads and calls, the host functions it uses) is a
**catalog**: a named, versioned list a host provides. A catalog's contents are listed by reference
here and specified by the catalog itself, so each can move under its own version without changing
the format ([How the format evolves](degradation-and-versioning.md#how-the-format-evolves)).

## The core catalog

The vocabulary every host provides, all of it. A template that names only the core catalog draws the
same on every conforming host.

| Part                          | What it holds                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Layout components             | `Column`, `Row`, `Grid`, `Card`, `Canvas` and the other components of the design system's component layer. |
| Controls and primitives       | `we-button`, `we-input`, `we-select`, `we-text`, `we-icon` and every other `we-` element.                  |
| Design-system props           | The layout and style props every component and primitive takes (`gap`, `p`, `width`, `tone`, `*UpProps`).  |
| Tokens and colour roles       | The spacing, radius, type, colour and motion scales, and the roles a theme maps colours to.                |
| Theme parameters and families | What a node's `theme` and a theme may set.                                                                 |
| Transitions                   | The effects of `enterTransition` and `exitTransition` ([Transitions](blocks.md#transitions)).              |

Where each part is listed today is in the footer of this section. The design-system props and the
tokens have vectors of their own (`style.json`, `tokens/*.json`, [Conformance](conformance.md#the-files)).

**The core catalog's names keep `we-`.** `we-button` is the name in the format, not an alias for a
neutral one; another host provides an element of that name. The prefix is the core catalog's
namespace: a `we-` type that neither the catalog nor anything the host has loaded defines is unknown,
and draws the missing marker until something defines it
([Degradation](degradation-and-versioning.md#degradation)).

> **Why keep the prefix.** It is honest about where the vocabulary comes from, it is already in every
> template there is, and renaming it would be a migration of every one of them for no change in
> meaning. The operations spec, which is about data rather than UI, names no WE vocabulary at all.

The core catalog's machine-readable listing is begun in
[`catalog/`](../../../packages/schema-system/conformance/catalog), beside the vectors: today it holds
[`node-props.json`](../../../packages/schema-system/conformance/catalog/node-props.json), which props
of which component hold a node ([Node props](nodes.md#node-props)), generated from the components'
declarations.

> **Planned.** The rest of the core catalog the same way, as a document of its own with its own
> semantic version, in place of the implementation files below.

---

Listed in: [`componentRegistry.tsx`](../../../packages/app-shell/src/frameworks/solid/registries/componentRegistry.tsx)
and each component's `.types.ts` in [`4-components`](../../../packages/design-system/4-components/)
(layout components); [`custom-elements.json`](../../../packages/design-system/3-primitives/custom-elements.json),
the primitives' Custom Elements Manifest (controls and primitives);
[`design-utils`](../../../packages/design-system/utils/src/index.ts) (design-system props);
[`1-tokens`](../../../packages/design-system/1-tokens/src/) (tokens and roles);
[`presets.ts`](../../../packages/design-system/2-themes/src/presets.ts) (`ThemeOverrides`);
[`node-props.json`](../../../packages/schema-system/conformance/catalog/node-props.json) (node props).

## Extension catalogs

Everything else a template may name belongs to an extension catalog, which a host MAY provide:

- **Modules** — a feature module's store (`modules.<id>.<member>`), its parts (`$part`), its panels
  (`meta.panels` entries naming `module`) and its components. Each module is a catalog of its own.
- **Engines** — a graph's expanders and layouts, a globe's layers: the names a component's
  configuration props accept.
- **Host functions** — computation a host registers ([Host functions](expressions.md#host-functions)).
- **Foreign elements** — custom elements outside `we-` that a deployment names (a library's chart).
- **Block content types** — the kinds of content a composer stores and draws.

Each is named and versioned, and a host implements the extension catalogs it chooses. What a host
does with a template naming one it lacks is [degradation](degradation-and-versioning.md#degradation):
the parts that need it draw the missing marker or no value, and the rest of the template draws.

## Declaring what a template requires

A template MAY declare in `meta.requires` what it needs of a host beyond the core catalog, records
and operations:

```json
"requires": { "profiles": ["navigation", "view-state"], "modules": ["call"] }
```

| Key        | Value                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `profiles` | The [capability profiles](../profiles/README.md) whose members it names, by id (`navigation`, `view-state`, `appearance`). |
| `modules`  | The modules whose store (`modules.<id>.<member>`), parts (`$part`) or panels (`meta.panels` naming `module`) it names.     |

`requires` holds these two keys only; any other is an error, since a host cannot tell an extension it
may skip from one the template cannot work without.

**Absent, nothing is promised.** A template with no `requires` is written for one host (in WE, WE's
own), may name whatever that host offers, and is checked as before.

**Written, it is a promise a host reads before drawing.** A validator MUST then report as an error:

- a module the template names that `modules` does not list;
- when `profiles` is written, a profile whose namespace the template names that `profiles` does not
  list, and an id in `profiles` that is not a profile.

**Writing `profiles` declares the template portable**: it runs on any host that provides those
profiles and modules. A validator SHOULD warn about every [host-only](../profiles/README.md#we-host-only)
member such a template uses, since it would not run elsewhere. `profiles: []` is a template that
needs no profile at all, only records and operations. `modules` written alone keeps the older
meaning — a template for its own host saying which modules it leans on — and does not declare the
template portable.

A host that lacks a module a template's `modules` lists:

- at **install** (a person adding the template, alone or in a bundle), MUST refuse it and say which
  module is missing, in words, or offer the module where it has a way to add one;
- when **drawing** a template already installed, MUST still draw it, and MUST tell the person which
  module is missing rather than leave its parts blank.

A validator that knows the deployment's modules reports a listed module it lacks.

> **Why declare.** A host can walk the component types a template mounts, but a module named inside
> an expression or a part is invisible to that walk, and a profile member reads as no value on a host
> without the profile. A template that says what it needs lets a host refuse or warn before anything
> is drawn, instead of degrading part by part, and lets a validator hold a shared template to what it
> claims.

> **Planned.** Versions in `profiles` (each profile at the version the template was written
> against, once profiles leave draft), and `requires` for the other extension catalogs: engines, host
> functions, foreign elements.

---

Implemented by: [`types.ts`](../../../packages/schema-system/shared/src/types.ts) (`TemplateMeta.requires`),
[`semanticValidation.ts`](../../../packages/schema-system/shared/src/semanticValidation.ts) (`checkRequires`,
required modules), [`requires.ts`](../../../packages/schema-system/shared/src/profiles/requires.ts)
(`catalogsNamedBy`), [`templateAcceptance.ts`](../../../packages/app-shell/src/shared/templateAcceptance.ts)
(refusal at install), [`templateElements.ts`](../../../packages/schema-system/shared/src/templateElements.ts)
(`isUndefinedWeElement`).
Pinned by: validate vectors `validate.requires.*`;
[`semanticValidation.test.ts`](../../../packages/schema-system/shared/tests/semanticValidation.test.ts);
[`templateAcceptance.test.ts`](../../../packages/app-shell/tests/templateAcceptance.test.ts).

## Profiles

A **profile** is the part of a host's bag that is neither a store of a module nor the core library:
the host state and actions a template reaches beyond records, queries and operations. Seven are
specified, each a versioned member list with change events, in
[Capability profiles](../profiles/README.md): `navigation`, `view-state`, `layout`, `presence`,
`identity`, `space-settings` and `appearance`. A template writes each profile's members under the
profile's namespace (`navigation.params`, `viewState.openPanel`, `spaceSettings.currentSpace`), never
under a store. Each member keeps the [capability group](safety.md#capability-grants) that grants it.

Beside them are the host values every host provides by name (`me`, the person viewing;
`currentDataset`, the dataset on screen; the person's profile as `$agent` binds it) and the actions on
records (`record.*`), specified with the format itself. A member a host offers outside every profile
is [host-only](../profiles/README.md#we-host-only): a template naming one depends on that host, and a
validator says so.

---

Implemented by: [`profiles.ts`](../../../packages/schema-system/shared/src/profiles/profiles.ts),
[`semanticValidation.ts`](../../../packages/schema-system/shared/src/semanticValidation.ts)
(`withHostOnlyReport`).
Pinned by: the profile vectors (`navigation.*`, `view-state.*` and the rest, in
[`profiles.json`](../../../packages/schema-system/conformance/vectors/profiles.json)),
[`profilesCoverage.test.ts`](../../../packages/schema-system/conformance/tests/profilesCoverage.test.ts).
