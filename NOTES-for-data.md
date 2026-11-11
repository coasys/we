# NOTES — Lal's review on coasys/we#466 (tree mode follows the models' relations)

Branch `feat/tree-follows-model-relations`, fixes sit on top of PR head `04b0093d7`.
Every test below was run red (fix reverted / against `04b0093d7`) and green (fix applied).
Commits are small and ordered; nothing was pushed.

## Findings — one line each

- **P1-a — `rel:*` / "Any connection" followed WE's own core relations (signals, runs, generatedBy → ModelRun).**
  FIXED — `2b83d0111`. `EntityShape` gained a `bookkeeping` flag, set from `WE_PLUMBING_CLASSES` in
  `graphEntityShape.ts` (reused, not copied); the canvas seed's `relSpecs` and the spine picker now skip
  bookkeeping holder classes and any relation targeting one, while a space's own SDNA relations still pass.
  Tests: `canvas.test.ts` "follows only the space's declared relations — never the host's own bookkeeping"
  and `treeSpines.test.ts` (space-DNA spine listed, `Signal`/`ModelRun` spines absent).
  RED: stashed impl → both fail; GREEN: all pass.

- **P1-b — relation-pulled cards got no enrichment (no pending/changed, counts, reaction weight, colour, origin, made-by).**
  FIXED — `f8f2fdb0b`. Pulled rows now go through the same `cardData` envelope as placed cards, and the
  pull's `include` asks for card fields, relations, origin, madeBy and reactions.
  Test: `canvas.test.ts` "enriches a pulled card like every other card — pending, weighed, and from
  somewhere" (pending flag + real reaction weight asserted).
  RED: stashed impl → only this test fails; GREEN: 154 canvas tests pass.

- **Drop guard — drops on pending-acceptance or staged-change cards must be refused.**
  FIXED — `b507ce812`. `onNodeArrange` carries `pending`/`changed` from node data; `arrangeOnRelationTree`
  refuses with a toast before any read or write. The refusal site carries a comment that the author rule is
  deliberately omitted — whether a drag may rewrite another agent's record is an open product question for
  Nico and Josh.
  Tests: `treeRelation.test.tsx` "refuses to move a card still awaiting acceptance" + "refuses to move a
  card carrying an unsaved change".
  RED: stashed impl → exactly these 2 fail; GREEN: 13 relation tests pass.

- **P2.1 — reverse to-one with no named forward reads as children side → `Post.comments`/`Comment.post` 2-cycle.**
  FIXED — `15533aa4e`. `EntityShape.relations` carries `predicate`; the seed pairs an unpaired reverse with
  a non-reverse relation on the target sharing its predicate; `buildEntityManifest` sets `reverseOf` from
  the same predicate match so installed SDNA arrives paired.
  Tests: `canvas.test.ts` "draws a named list and its unnamed back-pointer once — one edge, not a
  two-cycle"; `perspectiveHelpers.test.ts` manifest test asserting `reverseOf` is populated.
  RED: stashed impl/manifest-reader → both fail; GREEN: 81 canvas tests + manifest tests pass.

- **P2.2 — `belongsTo` pull direction on AD4M: scope drill followed outgoing links, ignoring the reverse flag.**
  FIXED — `9e54c7dfe`. `resolveScopeToParent` in the AD4M adapter now uses the inbound traverse
  (`direction: 'in'`) when the scoped property is `reverse`, so children declared through `belongsToMany`
  appear.
  Test: `ad4mAdapter.test.ts` — a reverse-relation scope issues the incoming-links query against the
  perspective proxy (adapter path, not the in-memory store; suite runs against compiled `dist`).
  RED: source stashed + `dist` rebuilt → fails; GREEN: rebuilt → passes.

- **P2.3 — `rel:*` drag treated every reverse to-one as a parent pointer, skipping the direction check.**
  FIXED — `b258a613d`. `arrangeOnRelationTree` derives relation direction the same way the seed and named
  spine do (`heldByChild`): a `belongsTo` inverting a to-one (`Author.post`) is the parent end, not a way up.
  Tests: `treeRelation.test.tsx` "does not read the inverse of a to-one as the author's way up under the
  wildcard" + "refuses the wildcard where no pointer of the child reaches the parent's class".
  RED: stashed impl → the 2 new tests fail; GREEN: 15 relation tests pass.

- **P2.4 — undo across different target classes wrote the old parent through the new property.**
  FIXED — `855fc24fb`. `rememberRelationDrop` keeps both write descriptors; undo detaches the new relation
  and restores the old one through its own descriptor.
  Test: `treeRelation.test.tsx` "undo of a move across classes restores the old field, not the new one"
  (subTopicOf → agendaItem move, undo, redo).
  RED: stashed impl → this test fails; GREEN: 16 relation tests pass.

- **P2.5 — "This call" (`onlyFrom`) filter on AD4M: origin never read in the pull → every pulled child dropped.**
  FIXED — `569c16d95` (test) over `f8f2fdb0b`'s `pullInclude` (which includes `origin` and reads it through
  `idAt`, handling hydrated `{id}` records).
  Test: `canvas.test.ts` "keeps a pulled child under 'this call' only when its origin was actually read" —
  mock strips `extractedFrom` unless the include asks, returns it as `{id}` like AD4M.
  RED: against `04b0093d7` the file shows 4 failures including this test; GREEN: 82 canvas tests pass.

- **P3 — deterministic 500-card cap.**
  FIXED (small) — `e84f05b47`. Pending pulled cards are drawn in id order; which cards survive
  `relations.max` no longer varies with promise resolution order.
  Test: `canvas.test.ts` "always leaves the same cards standing when the cap cuts the pull short".
  RED: reverted impl → draws `pos2` (table order), test expects `pos1`; GREEN: passes.

- **P3 — named `belongsTo` move cleared before setting → installed SDNA refused the whole move.**
  FIXED (small) — `a452c47bc`. When the clearing plan resolves to the same write as the set (the forward
  to-one either way), the clear is skipped — a to-one's set is its own clear.
  Test: `treeRelation.test.tsx` "moves a named belongsTo by the set alone" (installed-SDNA/bare records,
  `rel:Author.post` move).
  RED: reverted impl → refused with "cannot be cleared" toast; GREEN: `author` repointed, no toast.

- **P3 — undoing a first attach on installed SDNA did nothing silently.**
  FIXED (small) — `56acfb1ac`. `detach` reports success; a failed detach/write on undo or redo raises a
  toast ("Could not take that move back") instead of looking undone.
  Test: `treeRelation.test.tsx` "says an undo could not take a first attach back when nothing can clear
  the field".
  RED: reverted impl → silent (no toast), field stays pointed; GREEN: toast fired.

- **P3 — `rel:*` picked the first matching pointer, not the one the card hangs by.**
  FIXED (small) — `b258a613d` (same commit as P2.3). `heldBy` inspects the card's populated relation
  values, so a reparent rewrites the link it is on.
  Test: `treeRelation.test.tsx` "rewrites the pointer the card hangs by, not the first of the right class"
  (`regarding` vs `about`, both → DiscussionTopic).
  RED: stashed impl → fails (wrote `about`); GREEN: passes.

- **P3 — neutral manifest dropped relations to unknown entities.**
  FIXED (small) — `34d2bcd08`. `toNeutralManifest` now keeps them as `uri` scalars (the same shape an
  untyped edge takes), still with a warning — not droppable data, never a relation a query can scope through.
  Test: `neutralManifest.test.ts` "keeps a relation whose target is not among the entities, as a plain
  field — and reports it".
  RED: reverted impl + `dist` rebuilt → `ghost` absent from properties; GREEN: present as `{type:'string'}`.

## Not done

Nothing — all P1s, the drop guard, all P2s, and all five P3s are fixed (the P3s were all small).

## Full-suite results (at `34d2bcd08`)

- `pnpm build` — clean, 66 workspace projects.
- `pnpm typecheck` — clean, 66 projects (`tsc --noEmit`).
- `pnpm lint` — "Lint clean: 66 packages and the files outside them."
- `pnpm test` (`pnpm -r --no-bail run test`) — exit 0; **zero failures** across all packages
  (56 package test summaries, all `passed`; e.g. app-shell 185 files / 2374 tests + 6 todo,
  backend-ad4m 41 files / 682 tests, graph-expanders 6 files / 157 tests).

## Not tested against a real executor — said plainly

All of this was verified through unit-test mocks and package test harnesses, **never against a live
AD4M executor**. Specifically:

- `ad4mAdapter.test.ts` mocks the `Ad4mClient`/perspective proxy and runs against compiled `dist` —
  the `direction: 'in'` scope fix is proven against the query the adapter _issues_, not against a real
  perspective's answer. A smoke test in a real space (a `belongsToMany` whose children appear in tree
  mode, a reparent that survives a reload) is still owed.
- The installed-SDNA behaviour (bare to-ones: set-only, never clear) is simulated by `world.bare` in
  `treeRelation.test.tsx`, matching how `Ad4mModel.fromSHACL` builds installed classes — not by an
  actual installed SDNA.
- The `onlyFrom` AD4M shape (`{id}` relation records, fields absent unless included) is mock-faithful,
  not executor-verified.
- `runEntityTransaction` and the rank writes are mocked (`batch-1`); batching semantics on AD4M untested.
