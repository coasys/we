# Component Explorer & Fragment Palette — Plan

How authors add new nodes to a template from the visual editor: browsing the component vocabulary,
inserting kit fragments with parameters, and — later — the provenance machinery that lets a reused
fragment be adjusted globally.

Grounding: `docs/architecture/template-fragments.md` (the expansion model this builds on),
`packages/design-system/CONVENTIONS.md` (one vocabulary, two grammars),
`packages/templates/kit/CONVENTIONS.md` (the fragments themselves).

## Where this starts from

- **Users cannot add nodes at all today.** The inspector edits existing nodes; there is no insert.
  That gap is the real driver — fragments are the _good version_ of solving it, not a separate
  feature.
- The AI is already connected to the fragment system at the level the architecture intends:
  the kit's shapes ship as JSON recipes in `schemaContext` (the in-app AI's system prompt), so an
  AI-authored template produces the same trees the kit does. What the AI lacks is the same thing
  the human lacks: an _insert operation_ with checks.
- Everything needed to describe the vocabulary already exists in `context.json`: per-component
  props, types, allowed values, `@ai` docs — the same data the validator and value pickers use.
- The kit is TypeScript in the app bundle. **The editor can simply import and call it.** Insert =
  `emptyState({ icon, label })` → splice the returned nodes into the schema. No `$param` token, no
  runtime fragment format, no new architecture for v1.

## Design positions

**One insert pipeline, two callers.** Insert-at-selection is a single editor operation — validate
target, check scope, splice nodes, select result — used by the palette UI _and_ exposed to the
in-app AI as a tool. Both authors get the same checks; later, marketplace-fragment action
disclosure lives at this same choke point. Do not build a human path and an AI path.

**Insert is where the ambient-scope contract finally gets enforced.** A fragment's manifest
declares `requires: { local: [...], context: [...] }`; the editor checks it against
`getScopeAtNode` (exists, powers the value pickers) at the drop target. Unmet requirements render
the fragment as _insertable-with-fix_ — "declares `searchText` on the page for you" — or disabled
with the reason. This is the check `template-fragments.md` names as prerequisite #1 for
marketplace fragments; building it for the kit first means it exists before strangers need it.

**Previews are live renders, not screenshots.** Fragments expand to plain nodes, and the policy
already allows schema islands in TSX via `RenderSchema` — so a preview is the fragment expanded
with sample props and rendered in the _current theme_, which screenshots can never be. Fragments
needing live data (`peopleRow`, `agentByline`) take the `SignalControl` precedent: sample data in
the manifest, rendered against a stub stores bag. Screenshot fallback only where a component
drags a heavy dependency (globe, graph).

**A manifest per fragment, hand-written, in the kit.** Options interfaces are types and vanish at
runtime, so each fragment needs a small descriptor: display name, description, param form fields,
sample props for the preview, `requires`. Living beside the fragment keeps it honest (CONVENTIONS
gains: "a fragment ships with its manifest"), and it is the direct ancestor of the marketplace
fragment format — we learn the schema on ourselves first.

## Phases

**1. Component explorer + insert (no fragments yet).**
Panel listing primitives + registered components from `context.json`, text search over names and
`@ai` docs, click-to-insert at the current selection with sensible default props. Target validity
only (can this node hold children / this slot). This alone closes the "cannot add nodes" gap.

**2. Fragment insert.**
Kit section in the explorer; param form from the manifest; live `RenderSchema` preview; scope
check with insert-with-fix. Editor imports `@we/template-kit` directly (lazy, like the other
editor chunks).

**3. Palette + polish.**
Pinned favourites (per-agent, `AgentSettings`), recently used, drag-to-position as an alternative
to insert-at-selection, richer search (by prop, by store used).

**4. Provenance and global adjustment.**
The `$fragment` tag, template-local definitions, push-to-definition, drift marking — designed in
full in `template-fragments.md`; not re-designed here. Gate: real demand for "edit my card
everywhere", per the trigger table. Phase 2's manifests and insert pipeline are deliberately the
substrate this lands on.

**AI, alongside.** Recipes already cover authoring. When phase 2 lands, expose insert as a tool so
"add an empty state to this list" goes through the same pipeline — the AI stops re-typing
expansions and starts using the checked path. Marketplace fragments (data, `$param` expansion)
stay behind the triggers in the architecture doc.

## Open questions

- Param forms: hand-written per manifest (v1, fine at ~16 fragments) vs generated from a schema —
  decide when the marketplace format forces the question anyway.
- Preview stores stub: how much of the stores bag must exist before `RenderSchema` is safe with
  arbitrary fragments? (Worst case today: `$store` reads resolve to nothing — acceptable for
  previews, but verify nothing throws.)
- Where the explorer lives: fourth right-panel alongside code/theme/visual, or a popover from an
  insert affordance on the selected node. Lean popover-first — insertion is contextual.
