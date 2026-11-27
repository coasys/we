# GitHub language card slices (n247)

n247 is an umbrella. This file maps its a12 leaves onto 1–3 hour boundaries. It implements nothing: no GitHub write, no comment, no language package, no template binding.

Worktree `/mnt/hdd/work/we-n247`, branch `marvin/github-acorn-card-plan`. `git rev-parse HEAD` before this file was `b58da1314db811cb63dc190353e11f4eda53cc99`, which is `origin/acorn/we-5-live-suite`. The three repositories stay unstacked. n244 and n245 are cited from their own branches.

## Inputs checked

Sidework JSON sha256 `f8d82ac0c24fc7906e831e585bee54f204d407781b84d8d4d43cf98c48ed6605` (same bytes as the agent-mail copy). Brief sha256 `78b11a47e0debe0c097ce978d552e0a6d001a82125a1ba28eac0c10103c682f8`. Base registries: `templateRegistry.ts` sha256 `aa35e73932e626c9eeb6a33c9046caad109f60d581f30fa06a0881d36ea655bc` (52 lines), `templateSurface.ts` sha256 `ed990f16c1a78075801a4f1e44458508eda6ff7deba1b86879222010c2540f9c` (2195 lines). Neither base file contains `resolveClassOnSurface`.

Fetched and matched: `marvin/we-class-surface` `6ba58799ba902244d5e59ad59c305760220ab501` (parent is the base) and `marvin/we-class-card` `dd5ff1d9517518095aa5156075f68cd80e3872c0` (parents `18add3ef8`, then `6ba58799b`, then the base). Mount ref ad4m `origin/acorn/pr6-run-as-caller` `e2c69d9b27475dffa23423286d0dae5e7411723b`, fetched. It is not an ancestor of ad4m `origin/dev` `6b83a802eed04c91b6e02a4b5687b3e6c63c8095`.

Acorn language `f3200b4c312cc36ca8f60aeba5c0226edd2680fa` is not an object in `~/nico/ad4m`, and `/home/data/code/acorn-ad4m` is absent. unverified: needs b11. Spike note SHA `7efef9828350ae4a731bcd6519d36cdc3b3ad1a9` exists (subject is a notes doc) and is not an ancestor of the mount ref.

## a12 leaves

These seven nodes have ancestor `a12`. Every one is open.

- n185. Review-order template. No ref. Changed files follow a `Review order` list in the PR body, otherwise GitHub's file order.
- n186. PR reviews and comments as children in the tree, synced both ways. No ref.
- n187. Descriptor decision. Ref `.scratch/templates-classes-1120/DESIGN.md`, absent from this worktree. Blocked `James to confirm`. Note: Nico 15:46 (219831) is convinced of a template-to-class link. The same decision is n242.
- n188. Design: a PR or issue URL mounts `PullRequest`, `ChangedFile`, `ReviewThread`, `Comment`. Note: reuse n205 (mount exports, engine, mountDelta) and n57 (call-action writes). The note names branch `acorn/s2-0-instance-writes`. Code citations below are the mount ref.
- n253. Read: `mountShapes` + `mountSnapshot` over the GitHub API. Note: needs n205 mount exports.
- n254. `mountDelta` by ETag poll. The title leaves webhooks for later. Note: n205 mount engine.
- n255. Writes through call actions: comment, reply to a review thread, resolve. Note: n57 SDK call-class writes.

The other four nodes in the input are shared, and they are not a12. n205 and n57 have ancestors a7/n202. n240 has ancestors a7/n220. n184 has ancestors a11/n165/n168 and status done.

## Shared work, once

Mount is n205, status open. JSON notes mark these children done: n208 (#1887, #1888), n209 (#1913 at `bccddcf07`), n210 (#1914 at `5b72bd20e`, #1915 at `66122b33d`), n211 (items 5.1, 5.2, 2.3, 2.7 built into those PRs), n298 (stack cut). Still open: n207 blocked on Nico, n212 merge blocked on Nico, n333 shape-registration path blocked until #1941. n205's note assigns a10 to ATProto. Read on the mount ref:

- `PerspectiveInstance::mount` at `mounts.rs:162`, `sync_mount` at `:393`, `apply_mount_delta` at `:579`. Resync interval is 15s at `mounts.rs:65`.
- `mount_shapes` at `languages/mod.rs:3192`, `mount_snapshot` at `:3209`. The guard at `:3179` requires both exports.
- `MountShapes` at `mount_types.rs:11`, `MountShape` at `:19`, `MountEntry` at `:27`. The address comment at `:25` says no `<lang>://` prefix. `MountSnapshot` at `:35`, `MountDelta` at `:54`.
- A language pushes `{mountDelta}` through `emitSignal` (`host.d.ts:64`), consumed at `languages_extension.rs:154`. A delta with no call token is dropped at `:157`.
- LDK slots are `defineLanguage.ts:205-206`. SDK entry is `PerspectiveProxy.mount` at `PerspectiveProxy.ts:664` and `syncMount` at `:677`.

Call actions are n57. The parent status is still open. Children n213, n214, and n249 are done. n214 says the SDK write table passed 8/8 on `7efef9828`, including `updateSubject`. n184 is done and points at n214. Those notes leave MINCA problems 2–9 open; they are outside this map. On the mount ref the call form is `call_actions.rs:2`, `run_call_actions` is `:269`, and `execute_call` is `:311`, which calls `expression_interact` at `languages/mod.rs:3037`.

Templates are n240, status open. n241 marks DESIGN.md done; that file is not in this worktree, so its six-PR body is unread. n243 (ad4m#1906) is done. n244 at `6ba58799b` adds `ClassSurfaceBinding` (`templateSurface.ts:2210`) and `resolveClassOnSurface` (`:2237`). The fixture is `templateRegistry.ts:62`, with `templateId: 'acorn'` at `:67`. The comment at `:60` says published-template selection has no settled field. n245 at `dd5ff1d95` adds `createClassTemplateCard` (`templateSurface.ts:2391`) and `writeCanvasCard` (`canvasCardWrite.ts:68`). n245's brief stops at fixture-backed creation and names n246 for published-template discovery. n246 is open. `devin-brief-n246-acorn-mount-template.md` is not in `agent-mail/devin-briefs/`. How an Acorn mount installs a Template record is unverified: needs b11.

On this base, `templateRegistry.ts:41` is the bundled map and `isValidTemplateId` is `:50`. `buildTemplateBag` (`templateSurface.ts:1902`) and `inspectTemplateSurface` (`:2146`) classify capabilities. The class-IRI lookup exists only on n244.

## GitHub-only slices

Each slice is a fixture test of one to three hours. None of them sends a GitHub request. No captured GitHub payload is in coasys/we or on the mount ref. n253, n254, and n255 start by adding a sanitized fixture. That fixture is a source input, next to the types named here.

### n188 class contract (about 2h)

One JSON fixture that parses as `MountShapes` plus one `MountSnapshot`, with classes `PullRequest`, `ChangedFile`, `ReviewThread`, and `Comment` (titles of n188 and n253). Addresses are bare ids (`mount_types.rs:25`). The version field is `MountShapes.version` (`:11`). The test deserializes the fixture against those types, or a TypeScript mirror of them. Source inputs: n188, n253, `mount_types.rs`, `defineLanguage.ts:205-206`. Acorn's class-naming style is unverified: needs b11. n253 fills entries from a payload. n255 adds the call-action predicates.

### n253 read (about 2–3h)

A pure function from a GitHub REST fixture (pull, files, review comments, issue comments) to `{shapes, snapshot}`. Both exports exist, because `languages/mod.rs:3179` refuses a mount with only one. The test expects one entry per fixture record and the address rule. Source inputs: the fixture, n253, the n188 class list, `MountEntry` at `mount_types.rs:27`. `mounts.rs:162` and `PerspectiveProxy.ts:664` stay as they are. This depends on n205's exports on the mount ref. It is blocked on ad4m dev: see blockers.

### n254 ETag delta (about 2h)

A pure function from a previous ETag plus a 304 or a 200 body to a `MountDelta` or an empty result. A 304 yields no `changed` and no `removed`. A 200 with one new comment yields one `Comment` in `changed` (`mount_types.rs:54`). The language would then call `emitSignal({mountDelta})` (`host.d.ts:64`, consumed at `languages_extension.rs:154`). The 15s `sync_mount` loop (`mounts.rs:65`, `:393`) stays as it is. Webhooks stay out of this boundary. Source inputs: two payload fixtures, n254, n253's entry shape. Applying the delta is `apply_mount_delta` at `mounts.rs:579`, which this slice leaves alone.

### n255 comment, reply, resolve (about 2–3h)

Three pure functions. Each takes the call's params object and returns the request body it would send, plus a `MountDelta` that `run_call_actions` can parse (`call_actions.rs:269`). Shape actions use the form at `call_actions.rs:2`: `action`, `source`, `predicate`, `target`. The test constructs no HTTP client. The returned delta names the comment or thread address. Source inputs: n255, n214's closed SDK table, `execute_call` at `:311`, `expression_interact` at `languages/mod.rs:3037`. `removeSubject` stays with n184 and n214. This slice adds the three predicates to the n188 shapes.

### n185 review order (about 2h)

A pure function from PR body text plus `ChangedFile` paths in GitHub order to paths in review order. A body section titled `Review order` (n185) wins. A missing section returns the input order. A partial list appends the remaining paths in input order. Three fixtures cover those cases. Source inputs: the n185 title, and paths shaped as n253 `ChangedFile` entries. When a canvas card is wanted, the card base is n244 plus n245: `resolveClassOnSurface` at `templateSurface.ts:2237` on `6ba58799b`, and `createClassTemplateCard` at `:2391` on `dd5ff1d95`. This branch does not contain them. This slice does not register a template in `templateRegistry.ts:41`. The binding is a parameter, which is the droppable choice below.

### n186 conversation children (about 2h)

A pure function from `ReviewThread` and `Comment` entries to child lists: each thread under the pull request, each comment under its thread. One fixture pull request with two threads is the test. Source inputs: n186 and n253's entry shape. Live arrival is n254. Posting is n255. This slice is the child index a card can render. It has no poller and no GitHub client. The title's two-way sync is n253 plus n254 plus n255, and all three are still open.

## Droppable descriptor

n187 and n242 are one open decision: the class names its template, or a template-to-class link. n187 is blocked on James. n242 is blocked on Nico and James. Nico's note leaves the node open. n244's fixture is an explicit `{classIri, surface, templateId}` list, and `templateRegistry.ts:60` on that branch says published-template selection is unsettled. n245 stops before n246. A GitHub card receives that binding from its caller. Dropping the choice leaves the n185 ordering tests, the n188 class fixture, and the mount slices unchanged. No slice writes the winning link into a package or into `we-seed.json`.

## Double-count check

Shared items are listed once above. These allocations are rejected:

- Mount install, shape registration, the 15s resync, and `apply_mount_delta` are n205's engine in `mounts.rs`. n253 only exports `mountShapes` and `mountSnapshot`. n254 only maps an ETag result to `MountDelta`. n333 keeps the single registration path.
- `run_call_actions` and the SDK create/save/`removeSubject` table are n57, n214, and n184. n255 is the three GitHub interactions. n186 does not post.
- n254 is the only ETag poll. n186 does not poll.
- `resolveClassOnSurface` and `createClassTemplateCard` are n244 and n245. n185 orders paths and takes a binding parameter.
- n242 is the same decision as n187, so it is not a second decision.
- n246 is the mount-time Template record. No GitHub slice installs one.
- n243's annotation tests stay on n240. They are not a GitHub read.
- n188 owns the class list. n253 fills entries for that list. n255 adds call predicates to that list.
- a10 is ATProto, by n205's note. It is not a GitHub slice.

## Blockers

1. n212 is open, blocked on Nico. The JSON does not record the mount PRs as merged. `e2c69d9b` is not an ancestor of ad4m `origin/dev` `6b83a802eed04c91b6e02a4b5687b3e6c63c8095`. A language built on dev does not have `mount` at `mounts.rs:162`.
2. n187 and n242 are open. The descriptor stays a caller-supplied binding until James confirms. DESIGN.md is absent here, so its body was not checked.
3. n333 is open until #1941 merges. This map adds no shape-registration path.
4. n246 is open and its brief file is absent. A mounted language's Template record is not implemented on the refs read here. unverified: needs b11.
5. Acorn language `f3200b4c312cc36ca8f60aeba5c0226edd2680fa` is absent on this box. Copying Acorn's package layout is unverified: needs b11. The mount contract above is ad4m `e2c69d9b`.
6. `7efef9828` is not an ancestor of `e2c69d9b`. n214's 8/8 pass is that node's claim about the spike SHA. The runner cited here is `call_actions.rs` on the mount ref. n57's own status is still open.
7. No GitHub payload fixture is in either tree. n253, n254, and n255 have no green test until that fixture exists. This run does not call GitHub.
8. The n185 canvas card depends on `6ba58799b` and `dd5ff1d95`. Those branches are not stacked here. The ordering function can land without them.
9. n207 is still open, while n211 and n298 notes say some packet defaults were already built. The contract in this file is the mount-ref source.
10. n186's two-way sync is incomplete while n253, n254, and n255 are open. An estimate that treats the umbrella as already present would hide that.

## Red result

Before this file, the worktree had no `GITHUB-LANGUAGE-CARD-SLICES.md` and no GitHub language. The report gate is `git diff --check`. No compiler ran, and no test selector ran. A run with zero selected tests is not a pass. Each dependency above names a JSON node or a `file:line` on a SHA in Inputs checked.

## Acceptance still open

The descriptor (n187), the mount merge (n212), the shape-registration wait (n333), template install (n246), b11 unread, the GitHub fixture uncaptured, and the card branches unstacked.
