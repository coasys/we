# GitHub language card slices (n247)

n247 is an umbrella. This file maps its a12 leaves onto 1–3 hour boundaries. It implements nothing: no GitHub write, no comment sent, no language package, no template binding.

Worktree `/mnt/hdd/work/we-n247`, branch `marvin/github-acorn-card-plan`. Round 1 is `972f3c2b5d045d8b705e1475ae5516b4930cf879` (110 lines). Round 2 is `91c366196a9d4a411af34c478457f9ae2bccc31e`. Both reviews are REVISE (2026-11-28). Base is `b58da1314db811cb63dc190353e11f4eda53cc99` (`origin/acorn/we-5-live-suite`). The three repositories stay unstacked.

## Readiness

- **Start now.** Implement and test offline on synthetic API-shaped fixtures with an injected transport and injected bindings. That is a fixture exercise. It is not a live GitHub language, a production mount, or a deploy.
- **Spike integration.** May target ad4m `origin/acorn/pr6-run-as-caller` `e2c69d9b27475dffa23423286d0dae5e7411723b`, labelled legacy/provisional. n188 says prototype now. n253 permits the spike branch. The pin is that SHA. `origin/acorn/pr5-instance-writes` is `363259fc2362ed8a1f08bf5198d27886cb018748`. Branch names are not interchangeable.
- **Production mount integration.** Waits for Nico's #1914 redesign: mount intent as neighbourhood-visible SDNA, with local projection and reconciliation. A merge of the current PRs is not enough. Keep an injected adapter. Leave the current lifecycle API, the 15-second sleep, the ownership model, and the signal-routing semantics out of GitHub product code. Lal records the 11-27 redesign write-up as a rejected proposal with unresolved requirements. This file does not adopt it as an API.

#1941/n57 is executor and SDK call-class plumbing. It does not block pure request/response mapping or a mocked interaction handler. n333/#1981 stays WAIT for #1941 and its stack. n187/n242 is one descriptor decision. Caller-injected fixture bindings keep it droppable. n246 owns mount-associated Template record and import behavior. Its fixture contract can start now. No pure slice waits on n212 or #1941.

## Two axes

Reviewed implementation and merge/closed-item progress stay separate, as in the 11-26 audit. A fixture-ready slice can start while its shared parent is open. A note that says Lal approved is a review fact, and the node can still be unmerged. A pure function landing leaves the a12 node open. The audit precedent cited in the n247 review, and not re-audited in this file, dropped an Acorn-merge blocker from a11 mount transport (n139/n170 and n324–327) and still refused to call that full engine integration.

## Inputs checked

Sidework JSON sha256 `f8d82ac0c24fc7906e831e585bee54f204d407781b84d8d4d43cf98c48ed6605`. Brief sha256 `78b11a47e0debe0c097ce978d552e0a6d001a82125a1ba28eac0c10103c682f8`. n246 brief sha256 `0eaef8d3931c5fb7cf6bf98b32a0f769476297e83cb1953a5d0276a5d36a234f`. Review sha256 `b3fa9ba8073f92ea3da15a33d038ce186372bee23c7fb275d5c67d3146dae875`.

Base registries: `templateRegistry.ts` sha256 `aa35e73932e626c9eeb6a33c9046caad109f60d581f30fa06a0881d36ea655bc` (52 lines), `templateSurface.ts` sha256 `ed990f16c1a78075801a4f1e44458508eda6ff7deba1b86879222010c2540f9c` (2195 lines). The base has no `resolveClassOnSurface`. `templateRegistry.ts:41` is the bundled map. `isValidTemplateId` is `:50`. `buildTemplateBag` is `templateSurface.ts:1902`. `inspectTemplateSurface` is `:2146`.

`marvin/we-class-surface` `6ba58799ba902244d5e59ad59c305760220ab501` (parent is the base). `marvin/we-class-card` `dd5ff1d9517518095aa5156075f68cd80e3872c0` (parent `18add3ef895309d88d5b9fa293c222478eee8c65`, then `6ba58799b`, then the base). On `6ba58799b`, `ClassSurfaceBinding` is `templateSurface.ts:2210` and `resolveClassOnSurface` is `:2237`. The fixture is `templateRegistry.ts:62`, `templateId: 'acorn'` at `:67`, unsettled published-template note at `:60`. On `dd5ff1d95` those two symbols sit at `:2212` and `:2239`. `createClassTemplateCard` is `:2391`. `instantiateClassCard` calls `writeCanvasCard` (`packages/app-shell/src/shared/canvasCardWrite.ts:68`) with `content: []` at `templateSurface.ts:2358`, so the canvas record is written. Class and template metadata stay in the WeakMaps at `:2320-2321`, and only that sidecar lives in process memory. Durable class/instance association on reload stays open.

Mount ref `e2c69d9b27475dffa23423286d0dae5e7411723b` is not an ancestor of ad4m `origin/dev` `c1a4cbacdeb1ef406ce403484fae05222653d1ab` (fetched 2026-11-28) or of the previously cited `6b83a802eed04c91b6e02a4b5687b3e6c63c8095`. `66122b33d83042a519d0a8e8ba86cf9310eaeeff` is an ancestor of the mount ref. LDK lines 85–94 match on both. Spike note `7efef9828350ae4a731bcd6519d36cdc3b3ad1a9` exists and is not an ancestor of the mount ref. Acorn `f3200b4c312cc36ca8f60aeba5c0226edd2680fa` is absent from `~/nico/ad4m`. unverified: needs b11.

## a12 leaves

All seven are open. n185 review-order template. n186 PR conversations as tree children, both ways. n187 descriptor, blocked on James, the same decision as n242 (blocked on Nico and James). n188 design: a PR or issue URL mounts the language. n253 read. n254 ETag `mountDelta`. n255 comment, reply, resolve.

Shared, and not a12: n205 and n57 under a7/n202. n240 under a7/n220. n184 under a11/n165/n168, status done.

## Shared work, once

Mount is n205, open. Notes mark n208 (#1887, #1888), n209 (#1913 at `bccddcf072b1239920a077efa8f3ede038a6be5e`), n210 (#1914 at `5b72bd20e4ba1d5e4717eaf13e45aeb16e1a6084`, #1915 at `66122b33d`), n211, and n298 done. Still open: n207 blocked on Nico, n212 merge blocked on Nico, n333 shape registration WAIT until #1941 and its stack (`devin/mount-register-shapes`, no dispatch). n205 assigns a10 to ATProto.

On the mount ref: `mount` `mounts.rs:162`, `sync_mount` `:393` reads shapes and a full snapshot at `:405-408`, stages them at `:431-434`, and drops addresses the snapshot omits (doc `:389`; the sweep is `write_snapshot` `:504-521`). `apply_mount_delta` `:579`. `MOUNT_RESYNC_INTERVAL_MS` `:65` is the sleep between passes (`:62-70`), not an ETag client. Both-export guard `languages/mod.rs:3179`. `mount_shapes` `:3192`, `mount_snapshot` `:3209`. Rust `MountShape.shape` is arbitrary JSON (`mount_types.rs:21`). The address comment at `:25` omits the `<lang>://` prefix. `MountDelta` `:54`. `emitSignal` is `host.d.ts:64` (`unknown`). `{mountDelta}` routing and the no-call-token drop are `languages_extension.rs:145-160`. LDK slots `defineLanguage.ts:205-206`. `MountCapability` `:89-92`, and `LanguageSpec.mount` `:126-127` (export both or neither). SDK `PerspectiveProxy.mount` `:664`, `syncMount` `:677`.

Call actions are n57, still open. n213, n214, and n249 are done. n214's note says the SDK write table passed 8/8 on `7efef9828`, including `updateSubject`. n184 points at n214. MINCA problems 2–9 stay outside this map. `parse_call_result` `call_actions.rs:102` expects the `MountDelta` object itself. `run_call_actions` `:269`. `execute_call` `:311` calls `expression_interact` `languages/mod.rs:3037`. The call form is `call_actions.rs:2`.

Templates are n240, open. n241 marks DESIGN.md done. That file is absent here, so its body is unread. n243 (ad4m#1906) is done. n244 and n245 are the SHAs above. Their JSON nodes are still open.

The n246 brief is READY FOR CONTRACT/TEST SLICE. It allows an explicit fixture descriptor, the existing Template import and identity, an idempotent install test, and failed-mount cleanup, written up in `MOUNT-TEMPLATE-CONTRACT.md`. Automatic installation may be dropped. It adds no template field on `mountShapes` and no new public vocabulary. GitHub slices install no Template record.

Binding-only mounting is a shared #1914 redesign requirement under n205, not a seventh GitHub engine. The both-export guard rejects a projection-less language. `bootstrap-languages/file-storage/index.ts:127-136` exports `expressionGet`, `expressionCreate`, and `isImmutableExpression`, and it exports no mount functions. FileStorage acceptance stays with n205. This map adds no dummy mount exports.

## Contract in one place (n188)

Shape class name, fixture class IRI, and address are defined here. Later slices consume this table. `MountEntry.class` and `MountShape.name` are the class name. The IRI is what n244 binds. Acorn's package IRI style is unverified: needs b11. These IRIs are fixture IRIs.

| Class        | Fixture IRI                     | Address                                                                                                        |
| ------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| PullRequest  | `fixture://github/PullRequest`  | `gh/{owner}/{repo}/pull/{n}`                                                                                   |
| Issue        | `fixture://github/Issue`        | `gh/{owner}/{repo}/issue/{n}`                                                                                  |
| ChangedFile  | `fixture://github/ChangedFile`  | `gh/{owner}/{repo}/pull/{n}/file/{encodedPath}`                                                                |
| Review       | `fixture://github/Review`       | `gh/{owner}/{repo}/pull/{n}/review/{nodeId}`                                                                   |
| ReviewThread | `fixture://github/ReviewThread` | `gh/{owner}/{repo}/pull/{n}/thread/{nodeId}`                                                                   |
| Comment      | `fixture://github/Comment`      | `gh/{owner}/{repo}/pull/{n}/comment/{nodeId}`, `.../issue/{n}/comment/{nodeId}`, or `.../thread/{threadNodeId}/comment/{nodeId}` |

Issue is its own class. Review is its own class: the summary body is a Review record. The node titles name four classes. Issue and Review are this contract's additions so an issue URL and a review summary each have a record kind.

The class comes from the parsed mount URL. `.../pull/{n}` and a direct `GET /repos/{owner}/{repo}/pulls/{n}` are PullRequest. That pulls body has no `pull_request` member. `.../issue/{n}` is Issue unless the issues-API body has a `pull_request` member, in which case it is PullRequest. Issue means no ChangedFile, Review, or ReviewThread. Its Comment records stay.

Owner and repo are lowercased once, when the address is built. `encodedPath` is one `encodeURIComponent` of the whole file path, so `/` becomes `%2F`. Comment and Review address ids are the GraphQL node id, which is REST `node_id`. The REST integer `id` is `restId` on the record and is not part of the address. A ReviewThread stores `rootRestId`, the top-level review comment's REST `id` (GraphQL `fullDatabaseId`). `in_reply_to` is that integer. A reply from any row in the thread uses it. A thread node id is not an `in_reply_to`.

Parents use the same addresses. ChangedFile, Review, ReviewThread, and a PR's root issue-comment parent the PullRequest. An issue's root comment parents the Issue. An inline comment parents its ReviewThread. A Review parents no thread. Reply-before-parent, duplicates, and removals are rows in this graph.

REST review comments are source rows, not ReviewThread records. Threads, `isResolved`, and review summaries come from GraphQL (`reviewThreads`, each thread's `comments`, and `reviews`), paginated. Root comments come from the issue-comments payload. Files come from the pulls REST payload. GraphQL is always fetched: it has no ETag or 304 contract. REST GETs are the conditional path. A read, the reply response, and the next read must keep one Comment address.

`MountDelta` is the Rust struct (`address?`, `changed`, `removed`) at `mount_types.rs:54`. `defineLanguage.ts` exports no `MountDelta`. Changed entries use LDK `MountEntry`. A call interaction returns that delta object. A signal sends `{mountDelta: delta}`. Tests keep the two envelopes apart. A shape that deserializes is still arbitrary JSON (`mount_types.rs:21`). SHACL and IRI checks are fixture assertions, separate from deserialization.

## Slices

Language-fixture package: `packages/testing/github-mount-fixture`, name `@we/github-mount-fixture`, beside `@we/acorn-fixture`. Command: `pnpm --filter @we/github-mount-fixture test` (`vitest run`). It imports `MountShapeEntry`, `MountShapes`, `MountEntry`, `MountSnapshot`, and `MountCapability` from pinned `ad4m-ldk/js/src/defineLanguage.ts:85-94`. It does not redeclare them. Card tests that call n245 stay in `@we/app-shell` (`pnpm --filter @we/app-shell test`) on base `dd5ff1d95`. Acorn's directory layout is unverified: needs b11. This package is the isolated fixture, not an Acorn language tree.

Every pure slice below can start now. Spike rows may target `e2c69d9b` through the injected adapter, labelled legacy/provisional. Production mount wiring stays held for the #1914 redesign. None of these slices waits on n212 or #1941. None of them closes its a12 node. The dependency pin for envelopes is the mount ref above.

1. **Shared corpus (n188, 1–2h).** Start now. Files: `fixtures/corpus.json`, `src/contract.ts`, `tests/corpus.test.ts`. One synthetic corpus: ordinary issue, PR with changed files, root comments, review summaries, review threads with replies, and a second snapshot (edit, add, remove, unchanged, incomplete page, REST 304 while GraphQL flips `isResolved`). Comment addresses use node ids. `restId` and `rootRestId` are fields. Schema notes name the public fields. No live GitHub request. The oracle is this class/IRI/address table plus the expected records and parent links. Assert unique addresses across kinds and repos, and every parent address present. Spike and production wiring are outside this slice.

2. **Read mapper (n253, 2–3h).** Start now. Files: `src/normalize.ts`, `tests/normalize.test.ts`. Consumes slice 1. Pure function to LDK `MountShapes` and `MountSnapshot`. Assert exact records and parent addresses, a derived thread that is more than one input row, and an issue URL that yields Issue plus its comments and no PR-only class. A pulls body yields PullRequest even with no `pull_request` member. Comment addresses are node ids; `restId` and `rootRestId` sit on the records. Missing and failed pages stay gaps and are not a snapshot. Spike export wiring is slice 3.

3. **Language wrapper (n253 remainder, 2–3h).** Start now. Spike against `e2c69d9b`, legacy/provisional, through an injected HTTP transport. Files: `src/language.ts`, `tests/language.test.ts`. Real `mountShapes` and `mountSnapshot` (`defineLanguage.ts:205-206`) call slice 2. `mountSnapshot` rejects an incomplete first load. On refresh it returns the last complete snapshot and does not publish a partial one. A replacement is published only when every required REST page and GraphQL page is complete. `sync_mount` removes addresses the snapshot omits, so a gap from slice 2 must not be exported. Tests: a failed second page, mixed 200 and 304 pages, and a moved page boundary. The returned snapshot still holds the previous addresses. Production lifecycle stays behind the injected adapter.

4. **Review-order parser (n185, 1–2h).** Start now, beside slice 3 once slice 1 exists. Files: `src/reviewOrder.ts`, `tests/reviewOrder.test.ts`. Signature is body text plus `ChangedFile` paths. It takes no binding. A `Review order` section wins. A missing section returns GitHub's file order, which is the node title. Appending paths omitted from a partial list is a proposed rule, not recorded node acceptance. Invalid and duplicate paths keep a stable fallback. The descriptor stays in the UI adapter.

5. **Review-order card (n185, 2–3h).** Start now on base `dd5ff1d95`. Renderer: `packages/app-shell/src/shared/shapes/githubReviewOrderCard.ts` builds the visible body from the ordered paths. Instance adapter: `packages/app-shell/src/shared/githubPrInstance.ts` takes the PR address. Both files are new. Their directories exist on the base and on `dd5ff1d95`. The adapter calls `resolveClassOnSurface` (`templateSurface.ts:2239`) and `createClassTemplateCard` (`:2391`). `ClassTemplateCardRequest` (`:2295`) has no PR address, and `instantiateClassCard` writes `content: []` (`:2358`), so this slice stores the address beside `classCardSidecar` and passes the renderer's body into that one write. UI host: `packages/app-shell/tests/githubReviewOrderCard.test.tsx`, using `render` from `@solidjs/testing-library` (`packages/app-shell/tests/panelInstances.test.tsx:6`). A written body is what `DocumentCard` (`packages/app-shell/src/frameworks/solid/components/GraphHost.tsx:175`) paints with `BlockRenderer` (`packages/block-system/frameworks/solid/src/components/BlockRenderer.tsx:212`). Assert the paths are visible and the card id is tied to the PR address. Register nothing in `templateRegistry.ts:41`. Reload persistence stays open. Normalization stays in the fixture package.

6. **ETag reducer (n254, about 2h).** Start now, after slice 2. Files: `src/reduce.ts`, `tests/reduce.test.ts`. REST input is the previous normalized records plus a 200 body or a 304. The ETag is a REST validator. The previous records are the old dataset. A 200 distinguishes add, edit, remove, and unchanged by address. A REST 304 yields an empty `changed` and an empty `removed` for that page, and the snapshot function returns the cached full entries. Each REST endpoint and page has its own cursor and validator. GraphQL has no ETag or 304. Threads, `isResolved`, and reviews always fetch, paginating `reviewThreads` and each thread's `comments`. The GraphQL cache key is the operation plus its variables, including cursors, not the `/graphql` URL. Merge only when both sides are complete. Fixture: REST pages return 304 while GraphQL flips `isResolved`, and the REST records stay. An incomplete or failed page removes nothing and is not a new snapshot. This slice has no poller.

7. **Conditional-fetch adapter (n254, 2–3h).** Start now as a mock. Files: `src/fetchAdapter.ts`, `tests/fetchAdapter.test.ts`. One scheduling owner: the executor `sync_mount` loop (`mounts.rs:393`, sleep at `:65`). The adapter builds REST conditional headers, always posts the GraphQL query, and serves the cached snapshot only when the merge is complete. A mount delta is emitted only when the injected caller context still holds the call token (`languages_extension.rs:145-160`). An autonomous language timer is unauthorized, and this slice adds none. Production delivery waits for the redesigned engine interface. No live poller is claimed here.

8. **Comment and reply (n255, 2–3h).** Start now. Files: `src/writes.ts`, `tests/commentReply.test.ts`. Build `POST /repos/{owner}/{repo}/issues/{n}/comments` `{body}` and `POST /repos/{owner}/{repo}/pulls/{n}/comments` `{body, in_reply_to}` from params. `in_reply_to` is the thread's `rootRestId`. GitHub accepts that body without commit or path. Map the response onto one Comment address, the GraphQL id / REST `node_id`, never the integer `id`. Assert read, then reply, then read keeps that one address. A successful create sets `MountDelta.address` (`mount_types.rs:49-56`) to it. A mock failure returns no success delta. The interaction return is the delta object (`call_actions.rs:102`). The signal envelope `{mountDelta}` stays on the emit path. Tests also assert the call's `source` and JSON-object `target` (`call_actions.rs:2-3`). A fake transport proves the handler. #1941 SDK execution is a separate held run.

9. **Resolve (n255, 2–3h).** Start now. Files: `src/resolve.ts`, `tests/resolve.test.ts` beside slice 8. Own contract: GraphQL mutation `resolveReviewThread` with `threadId` set to the ReviewThread GraphQL node id. Map `data.resolveReviewThread.thread` into a `MountDelta` for that address, merging a partial selection onto the stored thread. GraphQL `errors`, or a null `thread`, on HTTP 200 emit no success delta. This slice has no REST resolve body. The same direct-delta versus signal-envelope split as slice 8.

10. **Conversation tree (n186, 2–3h).** Start now, after slices 2 and 6. Fixture row model: `src/conversationTree.ts`, `tests/conversationTree.test.ts`. App-shell tree adapter: `packages/app-shell/src/shared/githubConversationTree.ts` (new; `shared/` exists on the base and on `dd5ff1d95`), tested by `packages/app-shell/tests/githubConversationTree.test.tsx` with the same `render` host. The adapter draws root comments, review summaries, and threads from the parent links slice 2 stored. Assert visible rows (summary text included), then apply fixture deltas with no duplicate children. Cover reply-before-parent, duplicates, and removals. A child-index map is not this slice. Normalization stays in the fixture package. Live shared sync stays outstanding.

11. **Tree commands (n186, 2–3h).** Start now, after slices 8, 9, and 10. Command adapter: `packages/app-shell/src/shared/githubConversationCommands.ts` (new; `shared/` exists on the base and on `dd5ff1d95`), tested by `packages/app-shell/tests/githubConversationCommands.test.ts`. Route a reply and a resolve through those handlers into the slice 10 tree rows. Outbound commands reuse slice 2's parents and `rootRestId`. This slice does not call the SDK. Two-way live behavior waits on production mount integration. If the card or tree attachment exceeds 3h, split it from the fixture row model. No production persistence is required here.

12. **Held acceptance.** No hour claim, and not a GitHub engine. After redesigned n205 interfaces and n57/#1941 are ready, one bounded run wires the adapter and proves mount, read, write, delta, and unmount on the real runtime. After n246 and the descriptor decision, a separate run proves Template import and durable card association if product scope requires it. Cross-reference FileStorage binding-only and two-executor/revision tests under n205. Record selected test counts when a slice is implemented. `git diff --check` does not show that a GitHub slice works.

## Droppable descriptor

n187 and n242 are one open decision. Nico's note leans toward a template-to-class link and leaves the node open until James confirms. Until then every GitHub card receives its binding from the caller. Slices 1–11 do not wait on that confirmation, and none of them writes the winning link into a package or into `we-seed.json`.

## Double-count check

Shared items appear once above. These allocations stay rejected:

- Mount install, shape registration, the resync sleep, and `apply_mount_delta` are n205. n333 keeps the single registration path. Slice 3 exports the two functions. Slice 6 maps records to a delta. Slice 7 starts no second poller.
- `run_call_actions` and the SDK create/save/`removeSubject` table are n57, n214, and n184. Slices 8 and 9 are the GitHub handlers. Slice 11 does not post.
- `resolveClassOnSurface` and `createClassTemplateCard` are n244 and n245. Slice 5 renders content and does not copy those functions. Slice 4 takes no binding.
- n242 is n187. n246 is the Template record. No GitHub slice installs one. n243 stays on n240.
- The class/IRI/address table is slice 1. Slice 2 fills entries. Slices 8 and 9 place the GraphQL node id into those addresses and keep `restId` off the key. Slice 10 reads the parents slice 2 stored. Slice 11 calls slice 10.
- FileStorage binding-only is n205. a10 is ATProto. Neither is a GitHub slice.

## Red result

The review verdict on `972f3c2b5` and on `91c366196` is REVISE. This revision's gate is `git diff --check`. No compiler ran. A run with zero selected tests is not a pass. Each dependency names a JSON node or a `file:line` on a SHA in Inputs checked.

## Still open

James's descriptor confirmation. Production mount wiring under the #1914 redesign. n333's wait on #1941. n246's runtime install, which the brief allows to be dropped. b11 unread. Card reload persistence. Live engine mount, read, write, delta, and unmount. The two-way live tree.
