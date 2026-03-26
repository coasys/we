# Plan Review Round 2: Architecture Risks & Missing Chapters

> Critical review of the overall architecture and plan completeness. Work through each point and resolve, accept, or dismiss.
>
> Round 1 (9 points) is fully resolved — see git history. This is the second pass, focusing on higher-level risks rather than plan doc inconsistencies.

---

## 1. ~~The token language is becoming a programming language — and those have a rough history~~

**Severity:** ~~Medium~~ → Resolved with decision doc

**Resolution:** The XSLT/BPEL comparison is misleading — those systems failed because they tried to replace general-purpose programming and became Turing-complete with no escape hatch. WE's schema system is deliberately non-Turing-complete, has a component escape hatch for complex behavior, and is primarily AI-authored rather than hand-written.

JSON schemas are specifically right for WE because of three constraints no alternative satisfies simultaneously: (1) decentralized template sharing requires inert data, not executable code, (2) section-level remixability requires transparent data, not opaque components, (3) AI as primary builder requires structured, validatable output.

Full reasoning documented in [json-schema-architecture-rationale](../../decisions/json-schema-architecture-rationale.md).

The three load-bearing dependencies (component library coverage, AI tooling pipeline reliability, token boundary discipline) are acknowledged and specifically targeted by the PR roadmap.

**Sub-concern (a):** AI tooling is Phase D due to hard dependencies (#7a types → #8 ai-context → #9 MCP), not because it's low priority. The existing AI editing flow (AiInterface + schemaContext.ts) works today as a stopgap.

**Sub-concern (b):** Schema debugging (inspector overlay) added as future work item in ecosystem doc. No PR plan needed yet — becomes relevant once real users author templates.

**Status:** [x] Resolved — decision doc created, schema inspector acknowledged as future work

---

## 2. ~~"Custom stores are rare" framing is optimistic~~

**Severity:** ~~Low~~ → Resolved with reframing + `$validate`

**Resolution:** The original concern was valid — calling stores "rare" was misleading because it ignored ephemeral UI state (selection, form validation, toggles, etc.). The fix is recognizing that `$localState` already IS a store, just declared inline. The real question is: "when do you need to escape from declarative state into imperative state?" And _that_ genuinely is rare.

Three changes made:

1. **Ecosystem doc reframed.** Section title changed from "$query Eliminates Most Custom Stores" to "Schema Tokens Eliminate Most Custom Stores." Now enumerates the full state taxonomy: `$query`(data),`$localState` (form/UI state), `$validate`(validation),`$map`/`$pick` (derived). Custom stores reframed as "for complex cross-component interaction state" rather than vaguely "rare."

2. **`$validate` added as Tier 2 token.** Form validation is the single highest-value addition — declarative rules (required, pattern, min/max) on inputs, with the renderer managing touched/dirty/error state automatically. Passes the token governance test: 3+ templates need it, can't be expressed cleanly with existing tokens, keeps the declarative paradigm.

3. **Local-schema-state PR plan updated.** `$validate` is now in-scope for the PR alongside `$localState`/`$local`/`$setLocal`. Includes rule types, renderer behavior (validate on blur, block submission), and implementation approach.

The genuinely-need-a-custom-store cases are now a short, defensible list: undo/redo, drag-and-drop with DOM measurement, audio/video playback timing, real-time collaboration cursors.

**Status:** [x] Resolved — ecosystem doc reframed, `$validate` added to Tier 2 and local-schema-state PR plan

---

## 3. ~~No versioning story~~

**Severity:** ~~Medium~~ → Resolved by documenting versioning contract + adding `schemaVersion`

**Resolution:** No dedicated PR needed — versioning folds into existing work:

1. **`schemaVersion` field added to template meta.** Semver string (current: `"1.0"`), incremented when new tokens land. Added to the template meta example in the ecosystem doc and to the `TemplateMeta` Zod schema in the schema-validation PR plan (#8b). Validators use it to warn on tokens newer than the declared version.

2. **Block type versioning is a non-issue.** AD4M model fields have defaults — adding a field is additive-safe, old data returns the default. This is now explicitly stated as a contract in the ecosystem doc. Removing/renaming fields requires a new model name (breaking change).

3. **Package versioning uses semver in `PackageManifest.version`.** Templates pin dependency versions. Full migration tooling is Phase 6+ future work, but the version fields exist from day one.

The versioning contract (additive-only evolution) is documented in the ecosystem doc under "Token governance > Versioning contract."

**Status:** [x] Resolved — `schemaVersion` in meta + schema-validation PR plan, versioning contract in ecosystem doc

---

## 4. ~~Performance is unaddressed~~

**Severity:** ~~Low-Medium~~ → Dismissed — not a WE concern

**Resolution:** On analysis, all three concerns are either non-issues or AD4M-side:

- **`$forEach` rendering:** SolidJS fine-grained reactivity handles large lists natively. Not a WE-layer concern.
- **Concurrent `$query` subscriptions:** Subscription load, SurrealDB fan-out, and deduplication are all AD4M infrastructure. WE just calls `.subscribe()`. AD4M query optimisation is planned separately.
- **Schema resolution:** Runs once at mount to create reactive bindings. Doesn't re-walk on data updates — SolidJS handles the rest via signals.

Normal development smoke testing (does 1000 items render without jank?) is sufficient. No dedicated performance checklist or PR plan changes needed on the WE side.

**Status:** [x] Resolved — dismissed as AD4M-side concern

---

## 5. ~~Lexical coupling is a future design debt~~

**Severity:** ~~Low~~ → Dismissed — architecture is already correct

**Resolution:** On closer analysis, the concern was misframed. The architecture has three cleanly separated layers:

1. **Model** (AD4M) — pure data, editor-agnostic. `$query` reads models without touching any editor.
2. **Block Component** (SolidJS) — renders UI for the block. Works in the editor, in schema-rendered apps, anywhere.
3. **Editor integration** (Lexical) — embeds the component in the composition surface.

Only **TextBlock** is deeply coupled to Lexical (inline rich text formatting requires Lexical's text node system — unavoidable for any rich text editor). Every other block uses a single **`GenericBlockNode`** — a generic Lexical `DecoratorNode` that looks up the component from a registry. New block types register with `registerBlock({ type, model, component })` — zero Lexical code.

Missing blocks show a placeholder with an install button, same as missing components. Cross-community interop works because models are editor-independent — only TextBlock's serialization format is editor-specific.

Ecosystem doc updated with the three-layer architecture, `GenericBlockNode` pattern, and missing block handling.

**Status:** [x] Resolved — dismissed, architecture documented in ecosystem doc

---

## 6. ~~Component library coverage is the highest practical risk~~

**Severity:** ~~Medium-High~~ → Resolved with inventory + dedicated PR plan

**Resolution:** Inventory completed. Current coverage: 29 components across primitives (17 Lit Web Components), components (7 SolidJS), and widgets (5 domain-specific). The existing set has good coverage for buttons, icons, overlays (Modal, Popover, Tooltip), menus, tabs, and loading states. But significant gaps exist:

- **Forms:** Only basic Input exists. Missing Select, Textarea, Checkbox, Radio, Switch, FormField (critical for `$validate`).
- **Layout:** Only Column/Row. Missing Grid, Card (generic), Accordion, Divider.
- **Data Display:** Missing Table, List, Tag/Chip, ProgressBar, EmptyState.
- **Feedback:** Missing Toast/Notification system, Alert/Banner, Skeleton loader.
- **Navigation:** Missing Breadcrumbs, Link.

Coverage is roughly ~50% — well below the 80% threshold for schema-first viability. A dedicated PR plan has been created:

- **[component-library-expansion](../prs/component-library-expansion.md)** — phased gap-fill: Phase 1 (P0, ~10 components: Select, Textarea, Checkbox, Radio, FormField, Grid, Card, Table, List, Toast), Phase 2 (P1, ~12 components), Phase 3 (P2/P3, ~10 niche components).

Phase 1 of this PR has **no dependencies** — it can start immediately in Phase A alongside buttons, unwrap, and theme work. The component showcase (#7b) stays in Phase D as the _tooling_ for external developers, not the library itself. FormField specifically feeds into `$validate` from the local-schema-state PR (#4).

Added as #10 in the PR roadmap, Phase A.

**Status:** [x] Resolved — inventory completed, PR plan created, slotted into Phase A
