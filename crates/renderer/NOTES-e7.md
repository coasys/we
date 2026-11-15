# E7: the Rust app on a live AD4M executor

Branch `port/e7`, from `port/split` (4afcac112). Read-only: the app writes
nothing and runs no flows.

## What works

- **Connect.** `we-app --connect` finds the executor: `--executor-url` if
  given, else the launcher's port file (`~/.ad4m/executor-port`), else the URL
  remembered from the last run, else port 12000. A stored token is tried
  first. Without one, the app asks for a capability. You approve the request
  in the AD4M launcher, and the app's connect screen asks for the 6-digit code
  the launcher shows. The token is stored, so the next run connects without
  asking. On a multi-user executor the screen asks for an email, then the
  emailed code or a password. The screen shows every state: searching,
  waiting for the code, checking, connected, locked (unlock in the launcher,
  then Retry) and failed (with the reason, and Retry).
- **Pick a space.** The agent's perspectives are listed, shared ones first.
  Click one, or pass `--space <uuid or name>` to skip the list.
- **The space.** The Coasys bundle's whole app root renders at
  `/space/<perspective uuid>`. Every `$queries` entry in the template is read
  from the executor through `perspective.modelSubscribe` (or `modelQuery` for
  `subscribe: false`). Each result is pushed into the session inbox, which
  wakes the window. There is no polling. After a dropped socket, `ad4m-client`
  reconnects, re-opens each subscription and pushes its full result.
- **Store members (M2).** The `modelRead` rows the space template leans on are
  live (list below). Members without a live row still come from the recorded
  snapshot, as offline. A live member shows the TS store's empty value until
  its first answer, never the snapshot's (which belongs to another space).
- **Debug output.** A status bar shows the executor, the space, open live
  queries, results delivered, failed queries, and how many members are live
  or still on the snapshot. **F11** (or the "Data" button) opens a panel that
  lists live members, live members not read yet, snapshot members, derived
  members and dropped calls. F12 is the existing overlay (resolves, nodes,
  unknown types).
- **Level-2 conformance.** The 17 template query cases from
  `packages/backend-system/conformance/src/templateQueries.ts` run from Rust
  against a real executor. 14 pass. The other 3 are the gaps AD4M already
  lists in `ad4m/tests/live/conformance.live.ts`: a projection's `order` is
  ignored, and a count's `where` on an untyped relation is ignored. They fail
  in the same way here and run inverted, so a gap that closes shows up as a
  failure.

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
```

The offline paths (`--coasys <route>`, `--snapshot`, `dump`, `--gallery`) are
unchanged.

**What you approve, and where.** On the first run the launcher shows a
capability request from **"WE (Rust renderer)"** ("Reads your spaces to render
them natively. Read-only."). Approve it there, and the launcher shows a
6-digit code. Type that code into the app's connect screen. The app asks for
the wildcard capability (`*` on `*`), because that is `ad4m-connect`'s default
(see open questions). The token is stored in `ad4m-connect`'s token store:
`~/.config/ad4m-connect/tokens.json` on Linux and
`~/Library/Application Support/ad4m-connect/tokens.json` on macOS. Delete the
app's entry there to be asked again.

**What to expect on screen.** The app chrome, the space tree panel and the
template's own pages, with live data where a query or a live row reads it.
The space's home page ("Feed") is mostly the Feed module's `$part`, and parts
are not wired yet (E9). It shows the template's empty state or the chrome
around a blank part, the same as offline. In the tree panel, Calls, channels and
the Social DNA vocabulary come from live queries. Workflows still come from
the recording (`workflowStore.workflows`). **People still
lists the recorded Meridian members**: profiles are not live yet.

### Tests that need an executor

They skip without `EXECUTOR_PATH`. Each test starts its own executor, with
its own temporary data directory on a free port, and stops it when done. No
test touches an executor it did not start.

```sh
export EXECUTOR_PATH=/home/data/code/ad4m-worktrees/agent-sessions-db/target/release/ad4m-executor
cargo test -p we-ad4m -p we-app --test live_executor --test live_members \
  --test connect_flow --test template_queries --test e7_live --test e7_connect_ui -- --nocapture
```

| test                             | what it shows                                                                                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `we-ad4m/tests/live_executor`    | A session's `$queries` show a record another client created within 2 s (about 0.4 s measured), and the next record after a forced disconnect and resubscribe.                                                                      |
| `we-ad4m/tests/connect_flow`     | No executor ends in a failure with a reason. A capability request approved by the operator connects, and a second run with the stored token connects without asking.                                                               |
| `we-ad4m/tests/live_members`     | A live member starts empty rather than on the snapshot value, then follows a record created on the executor. `me.did` is the agent's. A member without a row still comes from the snapshot, and provenance says so.                |
| `we-ad4m/tests/template_queries` | Level 2: the 17 cases.                                                                                                                                                                                                             |
| `we-app/tests/e7_live`           | The **acceptance test**. The Coasys app on an empty live space shows the template's empty state, not recorded calls. A call created elsewhere is in the tree within 2 s (about 0.23 s), and the next one after a forced reconnect. |
| `we-app/tests/e7_connect_ui`     | The `--connect` window driven through egui: connect, the picker, a click on the space, then a live call appears.                                                                                                                   |

Set `AD4M_REQUIRE_EXECUTOR=1` to make a missing binary a failure instead of a
skip, and `WE_AD4M_EXECUTOR_LOG=<file>` to keep an executor's stderr.

## Store members: live vs snapshot

The live rows are `we-ad4m/data/storemap-live.json`. Each row has the query
the TS store runs, how its rows are shaped, its empty value, its loaded flag,
and a `ref` to the TS code it mirrors.

**Live:**

| member                                                   | read                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `spaceStore.currentSpace`                                | `Space` where self (by neighbourhood URL when shared, else uuid), include `location`; first row |
| `spaceStore.root`                                        | `Space` where self; `root` of the first row                                                     |
| `spaceStore.landmarks` + `landmarksLoaded`               | `SpaceLandmark`; name → node, newest wins                                                       |
| `spaceStore.taskStates` + `taskStatesLoaded`             | `TaskState`; mapped and ordered by semantic                                                     |
| `spaceStore.offeredTaskStates`                           | derived: `taskStates` without retired ones                                                      |
| `spaceStore.involvementTypes` + `involvementTypesLoaded` | `InvolvementType`; sorted by creation, mapped                                                   |
| `spaceStore.offeredInvolvementTypes`                     | derived (existing native) over the live list                                                    |
| `themeStore.spaceThemes`                                 | `Theme` rows                                                                                    |
| `sessionStore.me` (and so `me.did`)                      | `agent.get`                                                                                     |
| `spaceStore.memberDids`                                  | the neighbourhood's `otherAgents` plus me                                                       |

**Still from the snapshot** (what the Coasys index route read in the
acceptance test): `identityStore.needsFirstRun`, `modules.call`,
`profileStore.profiles`, `recordStore.creatableEntities`,
`sessionStore.bootState`, `spaceStore.canAdministerCurrentSpace`,
`spaceStore.members`, `spaceStore.orderedSidebarItems`, `spaceStore.policy`,
`spaceStore.spaceDefaultTemplateId`, `spaceStore.spaceDefaultThemeId`,
`spaceStore.spaceThemePinned`, `templateStore.brand`,
`templateStore.currentSwitcherId`, `templateStore.switcherGroups`,
`themeStore.builtInThemes`, `themeStore.currentThemeId`,
`themeStore.installedThemes`, `workflowStore.workflows`. Other routes read
more. The F11 panel lists what the open route read.

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
`fb3e212b1550f4ef064921a0114b0c449a2a7cb8` (branch `port/a5-rust-connect`,
which contains A4). It is a native-only dependency of `we-ad4m` and `we-app`,
so the wasm build never compiles tokio.

## How it fits

- `we-ad4m` implements the existing seams and changes no core crate:
  - `Ad4mQuerySource` implements `we_template::QuerySource`. It delivers on
    the `QuerySink` and disposes on `close`.
  - `Ad4mExecutor` implements `we_data::Executor`: queries and subscriptions
    work; writes, commits, flows and shapes answer `Unsupported`.
  - Live members wrap a store root in a namespace and re-bind it with
    `StoreBag::set_root`, which moves the data revision and wakes the
    session.
- The one change outside `we-ad4m`/`we-app` is additive: `we_data::Provenance`
  gained `note_live`/`live_served`. The offline report's text is unchanged.
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

1. **Capabilities.** The app asks for `*` on `*`, `ad4m-connect`'s default. A
   read-only app should ask for less: perspective and agent reads plus query
   subscriptions. Which capability names does the executor want for exactly
   that?
2. **`ad4m-connect` fallback.** After an explicit `--executor-url` fails,
   discovery still tries port 12000. Should an explicit URL be the only
   candidate? The not-found test skips when something listens on 12000, so
   that it never reaches an executor it did not start.
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
8. **`$invoke` in a live space** still goes to the offline `StaticHost`: a
   call with a canned snapshot reply gets that reply, and anything else is
   dropped (listed in the panel). E11 replaces this with real writes.
9. **Route key.** The app routes a space by its perspective uuid. WE's own
   URL uses the neighbourhood id for a shared space. The source answers to
   both, but links the template builds follow the uuid.
