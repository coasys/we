# Distribution — how a contribution reaches a stranger

The plan for the marketplace, rewritten around the one question it turns on: **what may arrive from
somebody you have never met, and be used, without a merge into this repository?**

The previous version of this document (August 2026, "Module Marketplace — Design Conclusions")
answered that question with `import()`. Blocks and components were to be compiled ESM bundles
stored as `FILE_STORAGE_LANGUAGE` expressions, fetched and imported at install time. That plan
predates [`templateSurface.ts`](../../../packages/app-shell/src/shared/registries/templateSurface.ts)
and reads as if it does not exist. A `registerBlock` display component is Solid code running in the
host's context; imported from a stranger, it is total compromise, and nothing in the capability
model covers code. The plan was not amendable — it needed rewriting around a different premise.

The premise now: **every contribution type sits on one rung of a ladder, ordered by how much has to
be trusted, and the design work is to move types down the ladder** so that fewer of them ever need
the rungs that trust code.

---

## The ladder

| Rung                                    | What arrives                                                                                                                                                | What has to be trusted                                                                                             | Status                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Pure data**                        | JSON a renderer walks; CSS and token overrides                                                                                                              | Nothing. The trust boundary does the work: an ungranted reference is absent, a malformed schema is refused.        | **Built.** Templates, themes, views.                                                                                                                                                                                                                                                        |
| **2. Declared data + fragments**        | A manifest stating what a thing _is_, plus schema fragments stating how it is arranged                                                                      | Nothing, once the host can _render from a declaration_.                                                            | **Half built.** Entities are declared (`EntityManifest`, shapes-in-space). A form derives from a declaration (`recordStore.recordDraft`) and, since this plan, so does a display (`recordStore.displays`, `EntitySchema.display`). No bundled view renders a foreign type through it yet.   |
| **3. Sandboxed embed**                  | An application in an iframe, with declared permissions                                                                                                      | The browser's origin isolation. The app reaches the host's agent through the ports it is granted and nothing else. | **Built.** `ModuleDefinition.embed`. Safe, shallow.                                                                                                                                                                                                                                         |
| **4. Host-provided capability kernels** | A module that _declares_ the imperative capability it needs — media capture, a transcription port, a peer channel — and ships no imperative code of its own | The host's implementation of each capability, which is ours.                                                       | **Kernels built; the factory is still code.** A module names its kernels (`requires.kernels`), the registry hands its store only those, and `moduleCapabilities` derives the install statement from them. What remains is that `createStore` is JavaScript running in the host — see below. |
| **5. Code**                             | JavaScript that runs in the host's context                                                                                                                  | The author. Entirely.                                                                                              | **Merge only.** By decision, not by omission.                                                                                                                                                                                                                                               |

Rung 5 is not a marketplace rung and will not become one. Anything that needs it ships by merging
into this repository, where review is the trust mechanism. The whole point of the ladder is that
this is a smaller set every year.

---

## Where each surface sits

The nineteen surfaces from [`docs/contributing/surfaces.md`](../../contributing/surfaces.md), placed.
Where a surface can move, the rung it should reach and what moves it.

| Surface            | Today                                                            | Reachable                  | What moves it                                                                                                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theme              | 1                                                                | —                          | —                                                                                                                                                                                                                                                                                   |
| Shell template     | 1                                                                | —                          | —                                                                                                                                                                                                                                                                                   |
| View               | 1                                                                | —                          | —                                                                                                                                                                                                                                                                                   |
| Portable fragment  | 5 (an export from `@we/schema-kit`)                              | 1                          | A fragment is an authoring-time helper that _expands to nodes_. Distributed, it is the nodes: a template section. Section-level remixing is already the thesis; a "fragment" in the marketplace is a section somebody published.                                                    |
| WE-domain fragment | 5 (`@we/template-kit`)                                           | 1                          | Same.                                                                                                                                                                                                                                                                               |
| Design token       | 5 (`@we/tokens`)                                                 | 1                          | A token is a theme override with a name. New _categories_ of token are code; new values are a theme.                                                                                                                                                                                |
| Model              | 5 (`@we/entities` manifest) for core; **2** for community shapes | 2                          | Done for community models. Core models stay merge-only because the app's own stores are written against them.                                                                                                                                                                       |
| Block type         | 5 (model + Solid display + Solid input)                          | **2**                      | **Declared rendering** — see below. The model half is already a manifest; the two components are the only code-shaped part.                                                                                                                                                         |
| Schema operator    | 5                                                                | 5 → _retired as a surface_ | The expression layer closes the grammar. A new capability at the value layer is a **library function**, which is code and sits on rung 5 unless a host provides it — but the _grammar_ stops being a contribution surface at all.                                                   |
| Store              | 5                                                                | 5                          | A store is the host's own API. Not a contribution.                                                                                                                                                                                                                                  |
| Primitive          | 5 (Lit)                                                          | 5                          | Browser APIs, focus, measurement — the definition of what data cannot express.                                                                                                                                                                                                      |
| Component          | 5 (Solid)                                                        | 5                          | Same.                                                                                                                                                                                                                                                                               |
| Widget             | 5                                                                | 5                          | Same, and currently empty by design.                                                                                                                                                                                                                                                |
| Feature module     | 5 — as a package a deployment names in its seed                  | **4**                      | The kernels are declared and gated (done, September 2026). The store factory is the last code: a module ships as a package, a deployment adds it to `we-seed.json` and rebuilds, and the registry is generated from the list. Rung 4 proper is sandboxing that factory — see below. |
| Embedded app       | 3                                                                | —                          | Already the safe answer for an application that _is_ code.                                                                                                                                                                                                                          |
| Graph plugin       | 5                                                                | 5                          | An expander or a layout is an algorithm over data; it is code.                                                                                                                                                                                                                      |
| Globe layer        | 5                                                                | 5                          | Same.                                                                                                                                                                                                                                                                               |
| Seed               | deployment                                                       | —                          | Not a marketplace object. A deployment chooses from what exists.                                                                                                                                                                                                                    |
| Backend adapter    | 5                                                                | 5                          | Not a marketplace object.                                                                                                                                                                                                                                                           |
| Platform host      | 5                                                                | 5                          | Not a marketplace object.                                                                                                                                                                                                                                                           |

Read down the "reachable" column: **the marketplace's data categories are templates, themes, views,
sections and content types.** Modules are the one code-shaped thing that has a plausible path to
being safe, and it is the hard path. Everything else that is code stays code and merges.

---

## Rung 2 — declared rendering

The strategic move, and the one the previous plan did not have.

A content type today is three things: a model (declared — a manifest or a shape), a display
component (Solid code), and an input component (Solid code). The two components are the only reason
a block type cannot arrive from a stranger. If a content type's display and input could be _derived
from its declaration_ — the way `recordStore.recordDraft` already derives a working form from a
model's own properties, for a model nobody wrote a form against — then a new content type is
manifest + fragments, crosses the trust boundary for free, and the marketplace's "blocks" category
becomes a data category.

What exists: the manifest carries `type`, `required`, `options`, `control` and `format: 'file'` per
property, and `authoring` names the fields a person fills in. `recordDraft` reads all of that. The
read side has no counterpart: nothing turns a declaration into a display.

What rung 2 adds, in order:

1. **A declared display.** _Done._ `recordDisplay.ts` derives, for any declared model, which
   property is the title, the summary and the media, and the fields to list with a display `kind`
   (text, longText, number, boolean, date, datetime, color, url, image, file, json) — the same rules
   `recordDraft` uses on the way in. `recordStore.displays` publishes one per creatable model, keyed
   by entity, and the generated reference carries the pattern that renders one with ordinary `$each`
   and `$if` ("A record of any type"). Deliberately a pattern rather than a kit export: the kit's
   rule is that a fragment merges with its call sites, and no bundled view lists foreign records yet.
2. **Display hints on the manifest.** _Done._ `EntitySchema.display` — `title`, `summary`, `media`,
   `fields` — optional, overriding the guess where it is wrong, exactly as `control` does on a
   property.
3. **Blocks re-expressed.** The bundled block types keep their components — the composer needs
   editing behaviour a declaration cannot express — but a _foreign_ content type installed from the
   marketplace renders through the declared display, in the feed, on a board, in a card. That is the
   proving ground: the day a community-defined content type renders in the default template's feed
   without anybody writing a component for it, rung 2 is real. The first call site turns the pattern
   into `recordCard` in `@we/template-kit`.

Not in scope for rung 2: composer editing of a declared type inside a post. That is where a
declaration runs out and a component begins, and it is the honest limit of the rung.

---

## Rung 4 — capability kernels

Half of it is built; the half that remains is recorded so it is not started speculatively.

A feature module is a **manifest** (data) + **contributions** — entities, parts, panels, blocks,
views, functions, settings, activities (all data) — + an optional `createStore(deps)`, a factory the
host calls with injected reactivity and with **only the kernels the manifest named**. The
second-runtime hazard the old plan worried about is solved by the injection: a store written against
`deps.signal` never imports Solid. The enumeration this section used to call for was done in
September 2026, and sorted as it predicted:

- **Signals over queries** — the notes module's first store was exactly this, and it went: the host
  owns its panel's openness and the panel is a `$queries` declaration. Data. (Notes has a store again
  since notes became compositions in the personal space — for writing documents and for sharing one
  into a space, neither of which is a signal over a query.)
- **Calls into ports** — became the **kernels** (`records`, `agentData`, `presence`, `ephemeral`,
  `media`, `peerConnection`, `transcription`, `languageModel`, `interpretation`, `secrets`). A
  module declares which it reaches; the registry refuses one naming a kernel the host lacks, hands
  the store no other, and the install screen lists them. The vocabulary is closed and small.
- **Algorithms** — the WebRTC mesh, the transcript assembler, a vote that finds the one it replaces.
  Code, and still the module's. The call's mesh runs over the `peerConnection` and `media` kernels
  rather than the browser directly, which is what makes it testable, but it is a module's own code.

What that leaves is the honest residue: `createStore` is JavaScript running in the host's context
with the kernels it asked for. That is smaller than "arbitrary code with the host's ports" — a
store that declared only `records` cannot reach a microphone — but it is not a sandbox. **Rung 4
proper** is running that factory somewhere it cannot exceed its declaration: a worker with the
kernels bridged over a message port is the obvious shape, and every kernel is already an interface
of promises and callbacks for that reason. Not started, and not to be started until a module
from outside this repository actually wants to run without a deployment's review.

Until then a module ships as a **package a deployment names in its seed** and rebuilds with — a
rung-5 artifact, distributed by a deployment's choice rather than a marketplace's. The catalogue
(`@we/ai-context`'s `extractModules`) and the validator learn it the same way they learn a bundled
one, so an outside module is a first-class citizen of the tooling before it is of the marketplace.

---

## What survives from the previous plan

The infrastructure half was right and stays:

- **A dedicated marketplace neighbourhood**, pointed to from the global neighbourhood and named in
  `we-seed.json`, with its own governance. Built — `datasetStore.marketplaceDataset`.
- **Entries as expressions** carrying id, type, name, description, icon, screenshots, author DID,
  version, compatibility range, content URL, tags, licence, dependencies. Ratings and reviews as
  triples on the entry, aggregated client-side. Templates and themes use this today.
- **A developer on-ramp** — `we-module create | build | publish` — for the rungs that have a build
  step, which after this rewrite is a smaller set than it was.
- **Depth-first dependency install**, lockfile later.
- **The browser, My Modules and the publisher dashboard** as described.

What changes in the entry metadata: `type` is derived from the surfaces list, not a four-value
enum, and every entry carries its **rung**, so an install screen can say what is being trusted.
For rungs 1 and 2 that is "nothing — this is data"; for rung 3 it is the permissions the iframe
asked for; there is no rung-5 entry.

---

## Rules that follow

- **Nothing `import()`s a bundle from an expression.** Not for blocks, not for components, not as a
  "phase 1". A rung-5 artifact does not become safe by being fetched from a neighbourhood instead of
  npm.
- **A contribution type gets a marketplace category when it reaches rung 3 or lower**, not before.
  Listing a category with no safe path invites exactly the plan this replaces.
- **Move types down before building rungs up.** Rung 2 for content types comes before any work on
  rung 4 for modules, because it removes the larger number of things that would otherwise need it.
- **Install screens name the rung.** "This template can read and write the content of this space"
  is what the capability groups already say for rung 1; a rung-3 entry says what the iframe may do.

---

## Build order

1. **Rung 2, step 1** — the declared display and `recordCard`. Small, and the proof that a
   declaration can be rendered, not only edited.
2. **Rung 2, steps 2–3** — display hints on the manifest; a foreign content type renders in the
   default feed. This is the marketplace's "content types" category becoming real.
3. **Entry metadata carries `rung` and a surface-derived `type`.** The install screen shows the
   rung's trust statement.
4. **Rung 1 for sections** — a published fragment is a section a template can pull in. Mostly
   already possible; needs a category and a way to reference a published section from a template.
5. ~~**Rung 4 enumeration**~~ — done (September 2026): the kernels exist, the notes panel store is gone,
   and the residue is named above. The next step on this rung is the worker sandbox, when a module
   from outside the repository needs it.
