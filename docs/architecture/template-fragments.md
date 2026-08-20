# Template Fragments

How reusable pieces of UI are shared between templates — today as authoring-time helpers, and where
that is going once fragments are things a community can extract, publish and install.

Read this before adding to `@we/template-kit`, before proposing a new layer-4 component, and before
building anything that puts fragments in the marketplace.

---

## The invariant

**The runtime never knows fragments exist.**

A fragment is an authoring-time construct. What ships, renders, syncs and gets published is plain
expanded JSON — indistinguishable from JSON written by hand. `@we/template-kit`'s exports are
functions returning `SchemaNode`s; they run when the template is built and leave nothing behind.

Everything good about the design follows from that one rule:

|                                                       | Because                                                           |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| No renderer change, ever                              | there is nothing to resolve at render time                        |
| A template outlives the kit                           | it carries its own nodes; the package is not a runtime dependency |
| The visual editor drills into everything              | there is no opaque node to stop at                                |
| An AI reads and edits it                              | it sees ordinary nodes, not an indirection it has to understand   |
| An installed fragment can't break your template later | you own your copy of the expansion                                |
| Portable to a future renderer                         | the artifact is the schema, not the toolchain                     |

The cost is the one property expansion cannot give you: **editing a fragment does not update the
places it was already used.** For WE's own templates that cost is zero — they are built from the TS
helpers, so a fix reaches every core template on the next release. It is only real for templates a
user has saved. See _Where this is going_ for how that is repaid without giving up the invariant.

---

## Fragment, component, or operator?

The question that decides where a new piece of UI goes. It is not "is it repeated" — repetition
argues for extracting _something_, not for extracting it into code.

> **Code owns only what data cannot express.** Everything above that line is arrangement, and
> arrangement stays data.

Concretely, code means: behaviour and focus management, accessibility semantics, browser APIs,
measurement, performance-critical rendering. That is the whole list.

| Wants to be                           | When                                                              | Examples                                        |
| ------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| **A primitive** (`@we/primitives`)    | focus traps, top layer, keyboard, ARIA                            | `we-modal`, `we-popover`, `we-input`            |
| **A component** (`@we/components`)    | measurement, layout maths, third-party libs                       | `AvatarStack`, `CollapsedContent`, `CodeEditor` |
| **A fragment** (`@we/template-kit`)   | arrangement, even when repeated fourteen times                    | `gatePrompt`, `cardList`, `agentByline`         |
| **An operator** (`@we/schema-shared`) | the repetition is _schema boilerplate_ **and** component-agnostic | `$in` rather than `$filter`+`$count`+`$gt`      |

**Why the line sits there and not somewhere more convenient.** A prop is a customisation somebody
predicted, implemented and shipped; a node tree is every customisation, including the ones nobody
thought of. Asked to make the icon on an empty state smaller, a fragment's answer is "edit that
node"; a component's answer is "wait for a release that adds `iconSize`", and the follow-up ("put the
icon on the right") has no answer at all. Trading that away to deduplicate would give up the property
the whole project exists for.

So the pairs come apart in a way that looks odd until the rule is applied: `AvatarStack` is a
component and the count beside it is a fragment; `we-modal` is a primitive and the confirm dialog
inside it is a fragment.

**What all-data costs, and what pays for it.** Consistency entropy is real — forty independently
editable prompts will drift into forty slightly different prompts. The answer is not opacity, it is
the layers that already exist: tokens and themes carry the global look, lints catch structural drift,
and provenance (below) tells a deliberate fork from an accidental one. And because most instances
will be untouched copies of the first expansion forever, **the seed matters more than a default
would**: a fragment ships as a starting distribution, not as something that can be fixed later for
everyone.

### One vocabulary, two grammars

Fragments serve schema-land; the editor and app-shell chrome are TSX. That is not a duplication
problem, because nothing is expressed twice: **components and primitives are the single-source
vocabulary, and above them sit two arrangement grammars** — fragments compose the vocabulary for
schemas, JSX composes the same vocabulary for code. Fragments never re-implement a component
(`sectionCard` uses `Card`; `peopleRow` uses `AvatarStack`), and TSX never re-implements a
primitive (the dev rule: DS components, not raw HTML). Tokens and themes carry visual identity
into both worlds from one definition.

When one pattern is genuinely needed identically on both sides there are exactly two moves, both
with precedent — demote it to a component (`SignalControl`), or mount a schema island in TSX via
`RenderSchema`, which is how the entire shell already works. Never a second copy.

And the boundary for which app surfaces are schemas at all: **surfaces a deployment should be able
to white-label or replace are schemas; tools are code.** The editor stays TSX — the tool must keep
working while the schema it is editing is broken, and rebuilding tool UI as schemas would generate
exactly the operator-language pressure named under the falsifiers. The full policy lives in
`packages/design-system/CONVENTIONS.md`.

---

## When to extract

- **Three real uses of the same shape.** Two is a coincidence. Three is a fragment.
- **Or: the divergence is a bug.** Fourteen card lists where five explained an empty result and nine
  rendered blank; four participant stacks where one seeded avatars correctly and three did not.
  Those are not style differences, and one call site can only be wrong once.
- **Not when serving the third call site would cost the fragment three options.** The presence row in
  `SpaceHeader` and two compact bylines were left hand-written for exactly this reason. An
  over-parameterised fragment is worse than the duplication it replaced, because it also hides it.

---

## Two packages

```
@we/schema-kit          (schema-system/kit)   — names no store
  states/     emptyState · emptyNote · gatePrompt · skeletonList
  layout/     pageShell · sectionCard · attributeRow · statChip · railShell · railGroup · railItem
  lists/      gridWrapper · cardShell · cardList · kanbanBoard · loadMore · pickerRow
  overlays/   composerModal · confirmModal · peopleTooltip · pickerPopover
  input/      field

@we/template-kit        (templates/kit)       — names WE's stores; re-exports all of the above
  lists/      channelRail · collectionFeed · commentThread · mediaGrid   (spaceStore.mutedDids)
  we/         agentByline · peopleRow · adminSection · installedList · marketplaceList
```

**The tier is the package.** It was two directories in one package, which was fine while templates
were the only consumer — and wrong the moment a feature module wanted a shape, because the kit sat
under `templates/` and `modules → templates` is the sideways edge the dependency rules forbid. The
call module hand-copied `peopleTooltip` rather than take that edge, which is duplication caused by
packaging rather than by design.

That split is not decoration. **The WE tier's real dependency is the host's store surface, and
`package.json` cannot express it** — a fragment naming `spaceStore.members` resolves to nothing on a
deployment without that store, silently. Keeping the tiers apart is how a consumer can tell which
fragments will work for them, and it is the reason the store contract (below) matters.

**A module may depend on `@we/schema-kit`, and only at compile time.** The fragments run during the
module's build and what ships in its `dist` is the expanded data, so there is no runtime coupling, no
version for host and module to agree on, and a module built against one version of a fragment keeps
rendering when that fragment changes. Hence a devDependency in a module, never a peer — unlike
`@we/module-shared` and `@we/schema-shared`, which are genuinely runtime contracts.

**Enforcement is a test, because it cannot be a manifest.** `kit.test.ts` reads every file in
`@we/schema-kit`, comments stripped, and fails on a `$store:` or `'$agent'`. The expansion walk beside
it only covers fragments a fixture exists for — and the four collection fragments above, which all
filter on `spaceStore.mutedDids`, were moved into the portable package during this split and caught
by nothing until the source check existed.

### The ambient-scope contract

Fragments here are **not pure functions of their props**. They read up the tree and write into it:

| Fragment                     | Requires in scope                                                 | Writes                                      |
| ---------------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| `cardShell`, `gridWrapper`   | `$local: 'displayMode'`                                           | —                                           |
| `railItem`, `railGroup`      | `$local: 'expanded'`, `'collapsedGroups'` (both from `railShell`) | `railGroup` writes `collapsedGroups`        |
| `cardList`                   | —                                                                 | `$local: '<as>Rows'`                        |
| `emptyState({ searchable })` | `$local: 'searchText'`                                            | —                                           |
| `marketplaceList`            | —                                                                 | `$local: 'search'`, `'sort'`, `'<as>Items'` |
| `confirmModal`               | the `openLocal` / `busyLocal` booleans                            | —                                           |

Reading up rather than taking a prop is deliberate — the display toggle belongs to the page, and
threading it through every list and card would add a prop to each whose only job is to be passed on.
The cost is that **a missing ambient value fails silently**: `$local` warns to the console and
resolves to `undefined`, so the UI renders confidently wrong.

Inside one repo that is manageable, and the contracts are documented on each fragment. It is _not_
manageable once fragments are installable by strangers — which is why declared requirements are a
prerequisite for the marketplace, not a nicety. See below.

---

## Where this is going

Nothing here is built. It is written down so the current shape stays compatible with it, and so that
deferring it is a decision rather than an oversight.

### Three scopes for a definition

| Scope               | Definition lives                                 | Purpose                                                                         |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| **Kit**             | shipped by WE, or installed from the marketplace | shared vocabulary, versioned                                                    |
| **Template-local**  | in the template, in a root `fragments` map       | _your_ card, edited once, updated across your template — no external dependency |
| **Module-provided** | exported by a feature module                     | the module knows what a good instance of its own thing looks like               |
| **Detached**        | nowhere; it is just nodes                        | one-off customisation                                                           |

Template-local is what makes "edit my card once, update everywhere in my template" possible without
installing anything, and it is what the extract-a-subtree operation produces.

Module-provided already exists in practice: `@we/module-graph` ships `fragments.ts` — "ready-made
graphs, as schema fragments… an LLM asked to _make me a knowledge map_ composes far better from one
working example than from a list of props." That was arrived at independently, in the same two API
shapes the kit uses (a static node, and a function taking parameters). Independent convergence is the
best evidence available that the shape is right.

### An instance carries its provenance

```jsonc
{
  "type": "Column",
  "$fragment": { "id": "we/emptyState", "version": "1.2.0",
                 "props": { "icon": "newspaper", "label": "posts" } },
  "props": { … }, "children": [ … ]   // the real, editable expansion
}
```

The tag is metadata the renderer ignores; the nodes are the truth. Two sources of truth exist
(definition + expansion) — the same cost generated code has, payable because expansion is
**deterministic**: re-expand from `props`, compare, and you know whether a human touched it.

Provenance is **best-effort**. An AI rewriting a subtree will drop the tag; that must degrade to a
plain detached subtree and never to incorrect behaviour.

### Four operations

1. **Insert** — pick a fragment, fill params, expand into the tree.
2. **Push to definition** — promote an edit made in place, and re-expand every non-drifted instance.
   Edit-then-promote rather than "go find the abstraction", because that is the affordance people
   actually reach for.
3. **Detach** — drop the tag. Permanently local.
4. **Update** — a kit fragment moved version; re-expand, diff, apply or decline.

### Drift semantics

- **Param edits stay clean.** Changing a value the fragment declared as a parameter is normal use,
  not customisation — the definition never owned it. Recorded on the tag; the instance keeps
  receiving updates.
- **Structural edits drift.** Adding, moving, removing or rewrapping a node forks that instance. It
  is excluded from propagation and marked, with three exits: detach, revert, or push.
- **v1 has no merging.** A drifted instance simply stays behind, visibly.
- **Later, optionally: props-granular.** If a fresh expansion and the instance have the _same tree
  shape_, differing prop values can be treated as per-property overrides that survive updates
  (override wins), while everything else keeps syncing. Requires no stored-format change — overrides
  are derived by diffing, never written — so it is a behaviour change in the editor with zero
  migration.
- **Structural merging is out of scope permanently.** Three-way tree merges over freely-restructured
  nodes is the corner where silent corruption lives. Structure is yours; forking it is the point.

Telling a param edit from a structural one requires a **source map from expansion** — which node and
prop each parameter landed on. The same map is what lets push-to-definition put the `$param` tokens
back before promoting, instead of baking one call site's label into every instance. That inverse step
is the fiddliest thing in the plan and worth prototyping on one fragment before committing to the
four-operation surface.

### What it costs in code

Small, and all optional-by-default:

- `SchemaNode.$fragment?` — one field. Zod is `.strict()`, so it must be declared. `updateSchema`
  already preserves unknown fields (it spreads `{...node}`).
- `TemplateSchema.fragments?` — a root map. Inert at runtime, but the validator, indexer,
  `getScopeAtNode` and the ai-context generator all walk templates and must know to skip or use it.
- A `$param` token valid **only inside a definition body, only during expansion**. It never reaches
  the renderer, which is what keeps the invariant intact.
- `requires: { local: [...], context: [...] }` on a definition, checked at insert against
  `getScopeAtNode` — which already exists, for the visual editor's value pickers. This is where the
  silent-`$local` failure class finally gets caught.
- Editor: the four operations and a drift indicator.

Nothing in `@we/schema-solid`, nothing in the backend, nothing in the module contract.

### Prerequisites before the marketplace accepts fragments

1. **Declared scope requirements**, checked at insert. Without this, installing a fragment is a coin
   flip that fails silently.
2. **An eject/detach operation** in the editor, so a tagged instance is never a dead end.
3. **Action disclosure at install.** Expansion makes installed fragments inert — they cannot act
   until inserted — but insert is the moment `$action`s enter your template, and an installed
   fragment runs with the template's full ambient authority. "It's data, so it's safe" is true of
   presentation and false of actions.

---

## Sequencing

Done:

1. The kit, and both of WE's own template packages built from it.
2. Loud failures — `$map` select lints, hoisted-query write checks, the previously unchecked
   `$toggleLocal`/`$callLocal`, all with tests.
3. Form wiring — landed as the `field` _fragment_ rather than the operator this document first
   assumed: which event carries a control's value is design-system knowledge, and an operator would
   have to smuggle that table into the schema resolver. A worked example of the boundary.
4. Recipes in `@we/ai-context` — the kit's shapes in the in-app AI's prompt, with a hand-sync rule
   in the kit's CONVENTIONS.
5. The design-system counterpart: arrangement-in-code components deleted, the
   one-vocabulary-two-grammars policy in `design-system/CONVENTIONS.md`.

Next: the component explorer and fragment palette
(`docs/internal/plans/prs/COMPONENT_EXPLORER_AND_FRAGMENT_PALETTE_PLAN.md`) — node insertion for
the editor and the AI through one checked pipeline, whose fragment manifests are the substrate the
provenance system lands on.

The property worth protecting at every step: **the artifact is always plain JSON, so no step commits
you to the next one.**

---

## Deferred obligations, and what triggers each

Deliberately not built yet — deferring is the decision, and these are its tripwires. The failure
mode this table exists to prevent is calcifying by accident: the contract becoming whatever the
first hundred templates happened to depend on, versioned under pressure as archaeology.

| Obligation                                                                                                                             | Trigger to build it                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$fragment` provenance + editor machinery (insert/push/detach/update, drift)                                                           | A second serious template exists, or someone actually asks to extract-and-reuse across templates                                                                                                                             |
| Store-contract versioning (the template↔store surface as a declared, versioned API)                                                    | Store churn visibly slows, or the first _external_ template author appears. Until then the validator's store-path lints are the dev-mode form: they keep churn safe and become the contract's enforcement when it is written |
| Compatibility constitution becomes binding (registry append-only, shipped prop semantics frozen, deprecated components render forever) | The first persisted templates we are unwilling to break — marketplace beta at the latest. Pre-1.0, breaking freely is policy, which is why the dead-component deletion happened _now_                                        |
| Action capabilities + outbound-src filtering for untrusted templates                                                                   | The marketplace accepts contributions from strangers. Disclosure at insert is necessary but is not containment                                                                                                               |

Each row is cheap to honour early and ruinous to retrofit late; the trigger is the latest safe
moment, not the recommended one.
