# E7: the Rust app on a live AD4M executor

Branch `port/e7`, from `port/split` (4afcac112). Read-only: the app writes
nothing and runs no flows.

## What works

- **Connect.** With `--executor-url`, that executor and no other (round 2,
  F2): if it does not answer, the app says so and stops. Without it, the app
  looks: the launcher's port file (`~/.ad4m/executor-port`), the URL
  remembered from the last run, then port 12000. A stored token is tried
  first. Without one, the app asks for a read-only grant (agent READ and
  perspective READ, round 2, F1). You approve the request in the AD4M
  launcher, and the app's connect screen asks for the 6-digit code the
  launcher shows. The token is stored, so the next run connects without
  asking. A token stored by the round-1 build (granted `*` on `*`) is dropped
  and the read-only grant asked for. On a multi-user executor the screen asks
  for an email, then the emailed code or a password. The screen shows every
  state: searching, waiting for the code, checking, connected, locked (unlock
  in the launcher, then Retry) and failed (with the reason, and Retry). The
  session lasts as long as the window is connected (F5): a grant removed in
  the launcher brings the connect screen back with the reason, and a dropped
  socket turns the dot amber with "Connection lost — reconnecting…" and a
  Reconnect button.
- **Pick a space.** The agent's perspectives are listed, shared ones first.
  Click one, or pass `--space <uuid or name>` to skip the list.
- **The space.** The Coasys bundle's whole app root renders at
  `/space/<perspective uuid>`. Every `$queries` entry in the template is read
  from the executor through `perspective.modelSubscribe` (or `modelQuery` for
  `subscribe: false`). Each result is pushed into the session inbox, which
  wakes the window. There is no polling. After a dropped socket, `ad4m-client`
  reconnects, re-opens each subscription and pushes its full result.
- **Store members (M2).** The `modelRead` rows the space template leans on are
  live (list below). Members without a live row read unavailable (round 2,
  F4), except the bundle's themes and brand and a few facts of connected mode
  (`we-app/data/connected.json`). No recorded Meridian data appears in a live
  space. A live member shows the TS store's empty value until its first
  answer. `--demo-recorded`, off by default, puts the recording back under the
  live data for a demo, and the status bar says so.
- **Debug output.** A status bar shows the executor, the space, open live
  queries, results delivered, failed queries, and how many members are live
  or unavailable. **F11** (or the "Data" button) opens a panel that lists
  live members, live members not read yet, bundle members and connected
  facts, unavailable members, derived members and dropped calls. F12 is the existing overlay (resolves, nodes,
  unknown types).
- **Level-2 conformance.** The 17 template query cases from
  `packages/backend-system/conformance/src/templateQueries.ts` run from Rust
  against a real executor. 14 pass. The other 3 are the gaps AD4M already
  lists in `ad4m/tests/live/conformance.live.ts`: a projection's `order` is
  ignored, and a count's `where` on an untyped relation is ignored. They fail
  in the same way here and run inverted, so a gap that closes shows up as a
  failure. A gap case that fails any other way (refused, or wrong in a new
  way) fails the run (round 2, P3).

## Try it

From `crates/renderer`:

```sh
# Against the AD4M launcher on this machine (the usual case):
cargo run --release -p we-app -- --connect

# A specific executor, straight into a space:
cargo run --release -p we-app -- --connect --executor-url http://127.0.0.1:12000 --space <perspective-uuid>

# A multi-user executor:
cargo run --release -p we-app -- --connect --executor-url https://<host> --email you@example.com

# Another theme (light, dark, black, retro, cyberpunk, glow):
cargo run --release -p we-app -- --connect --theme glow

# A demo with the recorded Coasys data filling what the live space lacks
# (recorded people, policy, workflows), clearly marked; off by default:
cargo run --release -p we-app -- --connect --demo-recorded
```

With `--executor-url`, only that executor is contacted; userinfo, a query or
a fragment in the URL are ignored (the token is the credential) and never
shown.

The offline paths (`--coasys <route>`, `--snapshot`, `dump`, `--gallery`) are
unchanged.

**What you approve, and where.** On the first run the launcher shows a
capability request from **"WE (Rust renderer)"** ("Reads your spaces to render
them natively. Read-only."). Approve it there, and the launcher shows a
6-digit code. Type that code into the app's connect screen. The request asks
for **agent READ and perspective READ** (pointers `*`) and nothing else; the
connect screen says so. The token is stored in `ad4m-connect`'s token store:
`~/.config/ad4m-connect/tokens.json` on Linux and
`~/Library/Application Support/ad4m-connect/tokens.json` on macOS, with
`we-renderer-grants.json` beside it recording that the token came from the
read-only request. Delete the app's entry in `tokens.json` to be asked again.
**If you approved the round-1 build's request**, the launcher still lists
that `*` grant: the new build asks again and stops using it, but remove the
old entry in the launcher to revoke it.

**What to expect on screen.** The app chrome, the space tree panel and the
template's own pages, with live data where a query or a live row reads it.
The space's home page ("Feed") is mostly the Feed module's `$part`, and parts
are not wired yet (E9). It shows the template's empty state or the chrome
around a blank part, the same as offline. In the tree panel, Calls, channels and
the Social DNA vocabulary come from live queries. Workflows still come from
the recording in round 1; now they read unavailable and the list is empty.
**People is empty**: profiles are not live yet, and the recorded members are
no longer shown (`--demo-recorded` shows them, marked).

### Tests that need an executor

They skip without `EXECUTOR_PATH` (`AD4M_REQUIRE_EXECUTOR=1` makes that a
failure). Each test starts its own executor, with
its own temporary data directory on a free port, and stops it when done. No
test touches an executor it did not start.

```sh
export EXECUTOR_PATH=/home/data/code/ad4m-worktrees/agent-sessions-db/target/release/ad4m-executor
export AD4M_REQUIRE_EXECUTOR=1
cargo test -p we-ad4m -p we-app --test live_executor --test live_members --test pin \
  --test connect_flow --test template_queries --test e7_live --test e7_connect_ui -- --nocapture
```

| test                             | what it shows                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `we-ad4m/tests/live_executor`    | A session's `$queries` show a record another client created within 2 s (about 0.4 s measured), and the next record after a forced disconnect and resubscribe. `Ad4mExecutor` reads once and refuses `model_subscribe` (F6).                                                                                                                  |
| `we-ad4m/tests/connect_flow`     | A dead explicit URL fails closed, names only host and port, and never falls back to the launcher's executor (F2, P3). The read-only grant reads and is refused writes and joins; a cached `*` token is not reused (F1). The stored token connects without asking.                                                                            |
| `we-ad4m/tests/pin`              | The `ad4m-client` pin is one rev in manifest and lockfile, and not one that loses the localhost pin on reconnect (F3).                                                                                                                                                                                                                       |
| `we-ad4m/tests/live_members`     | A live member starts empty rather than on the snapshot value, then follows a record created on the executor. `me.did` is the agent's. A member without a row still comes from the snapshot, and provenance says so.                                                                                                                          |
| `we-ad4m/tests/template_queries` | Level 2: the 17 cases; a known gap is only its documented wrong answer (P3).                                                                                                                                                                                                                                                                 |
| `we-app/tests/e7_live`           | The **acceptance test**. The Coasys app on an empty live space shows the template's empty state. A call created elsewhere is in the tree within 2 s (about 0.23 s), and the next one after a forced reconnect. No recorded name in the tree, nothing from the recording but the allowlist (F4); `--demo-recorded` brings the recording back. |
| `we-app/tests/e7_connect_ui`     | The `--connect` window driven through egui: connect, the picker, a click on the space, a live call appears. A killed executor shows "Connection lost" and Reconnect; a grant removed in the launcher returns to the connect screen (F5).                                                                                                     |

Set `AD4M_REQUIRE_EXECUTOR=1` to make a missing binary a failure instead of a
skip, and `WE_AD4M_EXECUTOR_LOG=<file>` to keep an executor's stderr.

## Store members: live, bundle, unavailable

The live rows are `we-ad4m/data/storemap-live.json`. Each row has the query
the TS store runs, how its rows are shaped, its empty value, its loaded flag,
and a `ref` to the TS code it mirrors.

**Live:**

| member                                                   | read                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `spaceStore.currentSpace`                                | `Space` where self (by neighbourhood URL when shared, else uuid), include `location`; first row               |
| `spaceStore.root`                                        | `Space` where self; `root` of the first row                                                                   |
| `spaceStore.landmarks` + `landmarksLoaded`               | `SpaceLandmark`; name → node, newest wins                                                                     |
| `spaceStore.taskStates` + `taskStatesLoaded`             | `TaskState`; mapped and ordered by semantic                                                                   |
| `spaceStore.offeredTaskStates`                           | derived: `taskStates` without retired ones                                                                    |
| `spaceStore.involvementTypes` + `involvementTypesLoaded` | `InvolvementType`; sorted by creation, mapped                                                                 |
| `spaceStore.offeredInvolvementTypes`                     | derived (existing native) over the live list                                                                  |
| `themeStore.spaceThemes`                                 | `Theme` rows                                                                                                  |
| `sessionStore.me` (and so `me.did`)                      | `agent.get`                                                                                                   |
| `spaceStore.memberDids`                                  | the neighbourhood's `otherAgents` plus me; just me under the read-only grant, which has no neighbourhood READ |

**From the bundle** (`we-app/data/connected.json`, allowlisted because they
belong to the Coasys bundle, not to the recorded space): `templateStore.brand`,
`themeStore.builtInThemes`, `themeStore.currentThemeId`.

**Facts of connected mode** (same file): `sessionStore.bootState` and
`sessionStore.signInStep` (`ready`), `identityStore.needsFirstRun` (`false`),
`spaceStore.canAdministerCurrentSpace` (`false`, read-only).

**Unavailable** (no live row, recording left out; what the Coasys index route
read in the acceptance test): `modules.call`, `profileStore.ownProfile`,
`profileStore.profiles`, `recordStore.creatableEntities`,
`spaceStore.members`, `spaceStore.orderedSidebarItems`, `spaceStore.policy`,
`spaceStore.spaceDefaultThemeId`, `spaceStore.spaceThemePinned`,
`templateStore.switcherGroups`, `themeStore.installedThemes`,
`workflowStore.workflows`. Other routes read more; the F11 panel lists what
the open route read. Round 1 served all of these from the recording.

Of the 15 `modelRead` rows in the mapping, the ones not live yet are
`profileStore.profiles` and `spaceStore.members` (they need
`agent.byDID` and parsing the profile perspective), `spaceStore.policy`
(three queries plus the policy replay), `workflowStore.openWorkflow` (flows),
`themeStore.installedThemes` (the `we-root` perspective),
`shapeStore.spaceShapes`, `datasetStore.currentDatasetEntities`,
`modules.transcribe.pendingProposals` and `spaceStore.exportCallTranscript`
(an action).

## Executor used

`/home/data/code/ad4m-worktrees/agent-sessions-db/target/release/ad4m-executor`.
Its checkout is at `2fa585db454506f479f72af5e1678089eae74ef0` (branch
`shrink-1713`, Nov 12), an ancestor of the pinned client rev. The binary is
dated 15:16 and that commit 15:18 the same day, so it was most likely built
from the tree just before that commit. It reports `ad4m 0.13.1-staging.9`. It
has `modelQuery`/`modelSubscribe` and the connect RPCs, but no
`perspective.instanceCreate` (the validated write RPC, A3, #1762). So the
tests create records as links. The app itself writes nothing.

Client: `ad4m-client` from `coasys/ad4m` rev
`d2e6fab93a61588d429fd44e7139e5d3bcaa7fcd` (branch `port/a6-on-a5`, which
contains A4 and A5; round 1 pinned the A5 head `fb3e212b`). It is a native-only dependency of `we-ad4m` and `we-app`,
so the wasm build never compiles tokio.

## How it fits

- `we-ad4m` implements the existing seams and changes no core crate:
  - `Ad4mQuerySource` implements `we_template::QuerySource`. It delivers on
    the `QuerySink` and disposes on `close`.
  - `Ad4mExecutor` implements `we_data::Executor`: `model_query` works;
    `model_subscribe` (whose `LiveQuery` cannot carry updates), writes,
    commits, flows and shapes answer `Unsupported`.
  - Live members wrap a store root in a namespace and re-bind it with
    `StoreBag::set_root`, which moves the data revision and wakes the
    session.
- The one change outside `we-ad4m`/`we-app` is additive: `we_data::Provenance`
  gained `note_live`/`live_served` and `note_unavailable`/`unavailable`. The offline report's text is unchanged.
  The E3c-8a read boundary should merge mechanically: nothing here touches
  the binding code.
- `translate.rs` lowers a compiled `$query` the way the TS adapter and SDK
  do:
  - `order` becomes pairs;
  - `select` becomes `properties`, at every depth;
  - `scope` becomes `parent` through a relation table generated from the
    entity manifest (`scripts/gen-relations.py`, containment as
    `ad4m://has_child`);
  - an include over an untyped relation becomes `polymorphic: true`, which
    the executor requires.
- `bash scripts/check-egui-free.sh` and the wasm check stay green. No pixel
  baseline changed.

## Open questions

1. **Capabilities** — answered in round 2 (F1, below).
2. **`ad4m-connect` fallback** — fixed in round 2 (F2): an explicit URL is the
   only candidate. Should `ad4m-connect` itself offer that, so other Rust apps
   get it without a custom transport?
3. **Profiles.** People and avatars still come from the recording. The next
   row is `profileStore.profiles` (`agent.byDID` and the profile perspective).
   It is a native, not a model read.
4. **Task state order.** The community's own order (`Space.taskStates`, an
   ordered relation) is not applied yet: states sort by semantic only.
5. **Parts (E9).** The Feed and other module parts render nothing until a
   part source exists, live or offline.
6. **Level-2 classes.** The Rust run uses WE-shaped SHACL written by hand,
   because WE's own SHACL is generated at runtime by the TS SDK and there is
   no JSON of it. A dumped copy of the SHACL WE installs, checked in like
   `relations.json`, would make the Rust cases run against identical classes.
7. **Store map home.** M1's `storeMap.json` in app-shell does not exist yet,
   so the live rows sit in `we-ad4m/data/storemap-live.json`. When it lands,
   the rows move there, and M2's TS-side check (each query against the
   in-memory backend) can run on them.
8. **`$invoke` in a live space** goes to an offline `StaticHost` with no
   canned replies since round 2: every call is dropped (listed in the panel).
   E11 replaces this with real writes.
9. **Route key.** The app routes a space by its perspective uuid. WE's own
   URL uses the neighbourhood id for a shared space. The source answers to
   both, but links the template builds follow the uuid.

## Round 2 (Lal's review of 6ba2f07c1)

One commit per finding, each with a test that failed before the fix. The red
output of each is below.

| finding | commit                   | what changed                                                                                                                                    |
| ------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| F3      | `278ef791c`              | `ad4m-client` pinned to `d2e6fab93` (A6 lineage), where connect and reconnect share the loopback-pinned dial                                    |
| F1      | `f23d1bf77`              | The request asks for agent READ and perspective READ only; a cached `*` token is dropped and the grant asked again                              |
| F2      | `7eb5c47fb`              | An explicit `--executor-url` is the only executor contacted                                                                                     |
| F4      | `247f9b87e`, `8fa1ca604` | No recorded data in a live space: an allowlist of bundle members and connected facts, the rest unavailable; `--demo-recorded` for a demo mix    |
| F5      | `e9dbc5401`              | The connect session lasts the whole connected lifetime: a refused grant returns to the connect screen, a lost socket shows amber with Reconnect |
| F6      | `4bace9232`              | `Ad4mExecutor::model_subscribe` answers `Unsupported` and names `Ad4mQuerySource`                                                               |
| P3      | `361630fef`              | A known gap is only its documented wrong answer                                                                                                 |
| P3      | `2783e5c00`              | Endpoints are shown and logged without userinfo, query or fragment                                                                              |

### F1: what the executor wants, found against `2fa585db4`

- Capability names are `domain` + `can` with `pointers`, from
  `rust-executor/src/agent/capabilities/defs.rs`: `agent`/`READ`,
  `perspective`/`READ`, `neighbourhood`/`READ`.
- `perspective.modelQuery` and `perspective.modelSubscribe` are guarded by
  `query()`, which asks for perspective READ, not SUBSCRIBE. `perspective.all`
  is perspective READ on any pointer, and `agent.get` is agent READ.
- The executor accepts the narrower grant as requested. After approval,
  `agent.getApps` lists exactly
  `[{agent,[*],[READ]},{perspective,[*],[READ]}]`.
- Under that grant the app reads (`perspective.all`, `modelQuery`,
  `modelSubscribe`, `agent.get`), and the executor refuses these with 403
  "Capability is not matched": `perspective.create` (wants perspective
  CREATE), `perspective.addLink` (wants perspective UPDATE on the uuid) and
  `neighbourhood.join` (wants neighbourhood READ).
- `neighbourhood.join` needs only neighbourhood READ. So the app does not ask
  for neighbourhood READ, and `spaceStore.memberDids` falls back to the agent
  alone, because `neighbourhood.otherAgents` needs the same capability.
- agent READ also allows `agent.getApps`: the agent's grants, without
  tokens. That is a read, but broader than "who am I". Splitting it needs an
  executor change.
- A token carries no capabilities (`token.rs`: "the grant holds them"), and no
  call reads an app's own grant. So a cached broad grant cannot be recognised
  from the token. `we-renderer-grants.json` records which request each stored
  token came from. The old `*` grant stays on the executor until it is removed
  in the launcher.

### F3: the A6 lineage

- `d2e6fab93` is the head of `port/a6-on-a5` and contains the A5 head.
- `ad4m-client`'s own test `localhost_connect_and_reconnect_dial_the_loopback_literals`
  passes at that rev.
- The app builds and every gate passes on it. `cargo tree --target
wasm32-unknown-unknown -i tokio` finds nothing, because the dependency
  stays native-only (A6 makes `ad4m-client` itself build for wasm, with a
  sync-only tokio, but the renderer does not take it there).
- This repo cannot observe the dial itself: the hook is `cfg(test)` inside
  `ad4m-client`, and making `localhost` resolve elsewhere needs root. So
  `tests/pin.rs` guards the rev instead.

### Red before each fix

```
F3 (pin guard, before the pin moved):
    panicked at we-ad4m/tests/pin.rs:46:5:
    ad4m-client fb3e212b1550f4ef064921a0114b0c449a2a7cb8 redials ws://localhost through the resolver after a reconnect; pin the A6 lineage (d2e6fab93 or later)

F1 (before the narrow request and the cached-grant check):
    thread 'a_cached_broad_grant_is_asked_for_again' panicked at we-ad4m/tests/connect_flow.rs:204:5:
    the broad cached token was reused without asking: [Searching, Connected { url: "http://127.0.0.1:40237" }]
    thread 'capability_request_then_the_stored_token_needs_no_approval' panicked at we-ad4m/tests/connect_flow.rs:140:19:
    perspective.addLink should be refused under the read-only grant: Object {"author": …, "data": {"predicate": "a://p", "source": "a://b", "target": "a://c"}, … "status": "SHARED"}

F2 (before the explicit URL was the only candidate):
    thread 'an_explicit_url_that_is_down_never_falls_back' panicked at we-ad4m/tests/connect_flow.rs:50:9:
    timed out; phases seen: [Searching, Locked { url: "http://127.0.0.1:44013" }]
    (44013 is the launcher-port-file executor, not the --executor-url one, which was down)

F4 (before the connected bag left the recording out):
    thread 'coasys_app_renders_a_live_space' panicked at we-app/tests/e7_live.rs:109:9:
    recorded "Mara Ellison" shown inside a live space

F5 (before the session outlived the connect screen):
    thread 'a_dead_executor_is_shown' panicked at we-app/tests/e7_connect_ui.rs:25:9:
    timed out waiting for the lost connection
    thread 'a_revoked_grant_returns_to_the_connect_screen' panicked at we-app/tests/e7_connect_ui.rs:25:9:
    timed out waiting for the connect screen

F6 (before model_subscribe was refused):
    thread 'executor_reads_once_and_refuses_a_subscription_it_cannot_follow' panicked at we-ad4m/tests/live_executor.rs:156:21:
    model_subscribe opened LiveQueryId("02e07a45-9694-4043-b4ec-b6dfc1b96913"), which never updates

P3, known gaps (before a gap was only its documented wrong answer):
    thread 'a_known_gap_is_only_its_documented_wrong_answer' panicked at we-ad4m/tests/template_queries.rs:551:5:
    assertion failed: matches!(judge(reply_total.gap, Err("RPC error 500: no such class".into())), Verdict::Fail(_))

P3, redaction (before endpoints were redacted):
    thread 'a_failed_url_is_shown_without_its_credentials' panicked at we-ad4m/tests/connect_flow.rs:317:9:
    "alice" shown: The executor at http://alice:hunter2@127.0.0.1:33403/?token=sekrit#frag does not answer. Start it, or leave out --executor-url to look for one.

F4 follow-up (signInStep, with connected.json as before this commit):
    thread 'coasys_app_renders_a_live_space' panicked at we-app/tests/e7_live.rs:112:5:
    assertion failed: report.snapshot_served.iter().any(|m| m == "sessionStore.signInStep")
```

### Still open after round 2

- `ad4m-client` itself prints some lines unredacted: the executor's refusal
  reason (`[ad4m-connect] the executor refused the token: …`) and its
  candidate URLs. The app strips userinfo and query before the URL reaches
  the library, so those lines carry host and port only. The JWT rides in the
  WebSocket URL's query (`ws_rpc.rs`); the library's socket errors use a
  token-free display URL.
- People, policy, workflows, the sidebar list and the template switcher are
  empty in a live space until they get live rows. The next live row is
  `profileStore.profiles`.
