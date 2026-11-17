# E11: writes from the Rust app

Branch `port/e11-writes`, from `port/split` at `4c4b3412d`. Implemented by
Opus (switched from Devin on 2026-11-17), following
`.plan/E11-brief.md` step by step. One commit per step:

| step | commit      | what                                                                                     |
| ---- | ----------- | ---------------------------------------------------------------------------------------- |
| 0    | —           | verification (below)                                                                     |
| 1    | `04d7fee53` | `ExecutorError::Rejected`; `Ad4mExecutor::write` through `perspective.instance*`         |
| 2    | `2965a51ba` | `we_data::writes` (the planner) and `we-ad4m/data/storemap-writes.json` (the five rows)  |
| 3    | `416c57f22` | `WriteHost`: the `$invoke` interpreter; testkit `SIGNAL_TYPE_SDNA`, `query_rows`, `find_ids` |
| 4    | `909f62ce3` | the write grant: `--connect --write --space <uuid>`                                       |
| 5    | `acf2ccf81` | the app writes through `WriteHost`; notices, the confirmation, status bar, data panel    |
| 6    | `4fcb0325f` | the acceptance test `we-app/tests/e11_live.rs`                                           |
| 7    | this file   | notes, every command of the brief, red outputs                                           |

## What works

From the Rust app, `we-app --connect --write --space <perspective uuid>`
opens a personal space with the write grant. In the inspector, a record's
fields can be edited (`recordStore.updateRecordField`) and the record
deleted (`record.delete`, after the host's own confirmation). The change goes
through the validated write RPC (`perspective.instanceUpdate` /
`instanceRemove`) and comes back through the live query: nothing is drawn
optimistically. A write the executor refuses shows a notice — the row's
first sentence, then the executor's own message — and runs the template's
`onError` with `result = { message, code, kind, errors? }`. Without
`--write` the window is read-only: a write row is refused locally with the
notice "This window is read-only. Start it with --write --space <uuid> to
make changes." Every `$invoke` without a write row is dropped and listed, as
in E7.

`spaceStore.createSignalType` (the inspector's "New signal type" form) is
wired and proven against the executor, but the form cannot be reached on a
fresh space (see "Deviations").

Measured in `e11_live` (debug build, the A3 executor, loopback):

| what                                         | time      |
| -------------------------------------------- | --------- |
| rename: on the executor                      | 21.5 ms   |
| rename: on screen (through the subscription) | 86.8 ms   |
| delete: gone from the executor               | 21.2 ms   |
| delete: gone from the screen                 | 449.7 ms  |
| refused write: the notice                    | 20.1 ms   |
| New signal type (with `--ignored`): created  | 21.6 ms   |

## Try it

From `crates/renderer`:

```sh
# Read-only, exactly as E7:
cargo run --release -p we-app -- --connect

# Writes in one personal space:
cargo run --release -p we-app -- --connect --write --space <perspective-uuid>
```

`--write` needs `--space` with a perspective uuid (`8-4-4-4-12` hex); a
name, or no `--space`, stops at argument parsing with "--write needs --space
<perspective uuid>: the grant names the one space it may change". A shared
space opened with `--write` is refused with "Writes to a shared space wait
for the space's policy check, which this app does not run yet. Open it
without --write, or pick a personal space." (§6 Q3).

**What you approve, and where.** The first `--write` run asks the AD4M
launcher for a separate app, **"WE (Rust renderer, writes)"** ("Renders your
spaces natively and makes changes in one space: <uuid>."), with agent READ
`*`, perspective READ `*` and **perspective UPDATE on that one uuid** —
nothing else: no neighbourhood, no perspective CREATE/DELETE, no `*` UPDATE.
Approve it in the launcher and type the 6-digit code into the connect screen,
which says which grant it asked for. Its token is stored beside the read-only
one (the store keys by URL and app name, so neither stands in for the
other); `we-renderer-grants.json` records it as `"<url>#writes":
"write-1:<uuid>"`. A later `--write` run for another space drops that token
and asks again (one approval per space, §6 Q6).

In the window: the status bar says `read-only` or `writes: <space>`. Open a
record's inspector, press the pencil ("Edit this record"), change a field;
the trash button ("Delete this record") asks first in a modal (Cancel /
Delete; Escape cancels). Notices appear top right for 8 s, each with a
Dismiss button. F11's data panel lists dropped calls (no write row).

**Manual check for Nico** (not automated): run WE (web) and the Rust app
against the same launcher executor; in the Rust app open a personal space
with `--write`, rename a task in the inspector and see it renamed in WE;
delete one and see it go.

## The rows

`we-ad4m/data/storemap-writes.json`, parsed by `we_data::StoreMap::parse`,
planned by `we_data::writes::plan` (pure, wasm-safe):

| `$invoke` target                | write                                    | confirm | fail sentence                      |
| ------------------------------- | ---------------------------------------- | ------- | ---------------------------------- |
| `record.create`                 | `instanceCreate(args[0], args[1])`       |         | Could not save that.               |
| `record.update`                 | `instanceUpdate(args[0], args[1], args[2])` |      | Could not save that change.        |
| `record.delete`                 | `instanceRemove(args[0], args[1])`       | yes     | Could not delete that.             |
| `recordStore.updateRecordField` | `instanceUpdate`, `{ field: fieldValue }`, skipped when TS would return early | | Could not save that change. |
| `spaceStore.createSignalType`   | `instanceCreate('SignalType', signalTypeFields(args[0]))` | | Could not create that signal type. |

`record.*` with a `dataset` option is refused ("writes to another dataset are
not wired yet").

### Not wired (the rest of M3)

- `recordStore.deleteRecords` (a `command`: one confirmation, N removes; E16/E17).
- `spaceStore.deleteCollection` (recursive delete, a `command`).
- `spaceStore.upsertSignal` (reactions; wants the optimistic overlay `reactions()` relies on).
- `spaceStore.createPost` / `updatePost` (E14), `spaceStore.setInvolvement`, `respondTo`.
- The record form: `recordStore.saveRecord`, `setRecordField`, `setRelationField`, `openRelationForm`, … (E13).
- Canvas writes `recordStore.*OnCanvas`, `arrangeOnTree`, `connectNodesNow`, undo/redo (E17).
- `workflowStore.*` and `moveRecord` (flows, E12).
- `modules.transcribe.*` writes (E19).
- The extras TS does after a write: `rekeyConnection` / `rekeyConnectionsOf` after
  `updateRecordField` (`RecordStore.tsx:2886`), and `withCollectionDefaults` /
  `threadResponse` in `record.create` (`TemplateProvider.tsx:183`).
- `commit` (several writes as one step) and batches. A row with several writes
  runs them in order and stops at the first refusal; not atomic.

## Executor used

`/home/data/code/ad4m-e11/bin/ad4m-executor` (`ad4m 0.13.1-staging.11`),
built 2026-11-17 01:08 from the `/home/data/code/ad4m-e11` checkout at
`87ba32b901c17c732f34769c7e661f1881e14117` (head of
`feat/validated-write-rpc`, #1762). `git diff 87ba32b90 d2e6fab93 --
rust-executor` is empty (brief §0.3), so it matches the client pin
`d2e6fab93`. E7's live tests pass against it unchanged (below). The brief's
§6 Q1 (executor not built) is stale.

## Step 0: verification

1. `git show d2e6fab93:rust-client/src/instances.rs` has `instance_create`,
   `instance_update`, `instance_remove`, `instance_add_to_collection`,
   `instance_remove_from_collection` and `validation_errors`; `instances` and
   `ws_rpc` are public modules. `RpcCallError` displays as
   `RPC error <code>: <message>`, so `Rejected` keeps the message alone.
2. A row's `id` is the instance's base URI: `create_update_remove_round_trip`
   finds the `id` `instanceCreate` answered (`ad4m://obj/…`) as a
   `modelQuery` row's `id`, and `find_ids` finds a link-created task by its
   `e11test://task/…` base. `instanceUpdate`/`instanceRemove` take it as
   `baseUri`.
3. The inspector click path, read from the bundle's `meta.panels` entry
   `inspector` (the `dump` command renders the app root without panels, so I
   read the panel's schema directly):
   - **Delete**: `we-button` with `label: "Delete this record"`, drawn when
     `count(local.card)` (the `card` query: `entity:
     routeStore.params.cardType`, `where: { id: routeStore.params.card }`).
   - **Edit**: a `we-button` with **no `label`**, inside a `we-tooltip` whose
     `content` is "Edit this record". Drawn when `count(local.card) &&
     (count(recordStore.displays[cardType].fields.filter(f, !(f.kind in
     ['relation','image','file','json']))) || first(local.card).editorState)`.
   - **The edit controls**: per field of `recordStore.displays[cardType]`, a
     `we-input` (text) / `we-textarea` (longText) / `we-select` / `we-switch`
     / `we-number-input` / `we-date-picker` / `we-color-picker`, each
     `onChange: recordStore.updateRecordField(cardType, card, field.name,
     event.detail)`, inside a `we-form-field` labelled with the field.
   - **New signal type**: `we-button` `label: "New signal type"` needs
     `count(local.card)` and `spaceStore.canAdministerCurrentSpace`; it sets
     `local.newSignalTypeOpen`. The form (`placeholder: "e.g. Like"`) needs
     also `local.reactionsOpen` (the "Show or hide signals" toggle) and
     **`count(filter(local.signalTypes, { retired: { not: true } }))`** —
     at least one signal type already. On a fresh space that branch draws
     "No reactions here yet — …" instead.
   - **`recordStore.displays.CollectionBlock` lists only relation fields**
     (`children`, `arranges`, `gathers`, `board`, …): no title, no
     description. So a call has no Edit button.
4. Template literals parse (`we-expr` lexes backtick templates;
   `every_shipped_row_parses` parses the `confirm.title` one). `undefined`
   is not a keyword (`true`, `false`, `null`, `in` are), but an unbound root
   evaluates to `undefined`, so `x == undefined` is `x === undefined`; the
   `skipIf` is spelled as the brief wrote it.
5. §6 Q4: TS's `cancelDestructive` settles `requestDestructive` with
   `false`, and the guarded method then resolves **`undefined`**
   (`templateSurface.ts:1968`), so in TS a cancelled delete runs
   `onSuccess`, not `onError`. E11 keeps the brief's default (`Err({ kind:
   "cancelled" })`, no notice); the question stays open for Nico.

## Deviations from the brief, and why

- **The acceptance test edits and deletes a `TaskBlock`, not a call.**
  Step 0.3: the inspector has no Edit button for a `CollectionBlock`, because
  the bundle's displays give it no editable field. A task has `title` (text)
  and `description` (longText). testkit gains `TASK_SDNA` (title, status,
  priority — **no description**, so the description write is the refused
  one, as the brief's refusal test intended with `CollectionBlock`) and
  `create_task` (links, as `create_collection`). The delete confirmation's
  title is therefore "Delete this TaskBlock?".
- **The Edit button is found through its tooltip**, not a `label` prop.
- **The description control is found through its `we-form-field` label**
  ("Description" is a prop, not a text run).
- **Tree assertions use the normal form** (props included, as `e7_live`
  does): in edit mode the title is an input's `value`, not text.
- **`create_a_signal_type_from_the_inspector` is `#[ignore]`**, as the
  brief says to do when the form is unreachable on a fresh space. Its body
  seeds one signal type ("Like", via `instanceCreate`) and dispatches the
  "Show or hide signals" toggle — two things the brief's list does not
  have — then runs the brief's three dispatches and assertions. With
  `--ignored` it passes (21.6 ms to the executor; the modal closes, so
  `onSuccess` ran). The create proof the brief relies on is
  `e11_writes::create_signal_type_writes_one_signal_type`. **Question for
  Nico:** should a space with no signal type offer "New signal type" in the
  inspector (a template change), or is Settings → Vocabulary the only way to
  make the first one?
- **`Write` derives `PartialEq`** (`we-data/src/executor.rs`): the brief's
  `WritePlan` derives it and holds `Vec<Write>`.
- **`properties` drop `undefined` and `null` fields** before conversion:
  `Value::to_json` writes `undefined` as a `{"$undefined": true}` marker,
  not `null`, so the brief's "drop JSON null" would have sent the marker.
- **`fieldValue`'s number** is `Value::js_number` (JS `Number(raw)`, which
  trims and reads `0x…`, `1e3`), not `str::parse::<f64>`; NaN is not written.
- **`SIGNAL_TYPE_SDNA` types `rangeMin`, `rangeMax`, `step` as
  `xsd://decimal`**, the datatype WE's manifest compiler gives a `number`
  (`manifestCompiler.ts:169`). Untyped, they read back as `"0"`/`"1"`.
- **`SIGNAL_TYPE_SDNA`, `query_rows` and `find_ids` landed in step 3**, not
  step 6: step 3's `create_signal_type_writes_one_signal_type` needs them.
- **`WriteHost` holds an `Ad4mExecutor`, not `Rc<Ad4mExecutor>`**:
  `write_task` returns a `Send + 'static` future, so the host collects the
  plan's futures and spawns them on the connection's runtime.
- **Dropped calls**: `RendererApp` gains `pub dropped_calls: fn(&Session) ->
  Vec<String>` (default: the `StaticHost` log), which the connected window
  points at the `WriteHost`'s fallback. The data panel used to list
  `report.dropped`, which nothing filled in connected mode; it now lists the
  host's log.
- **`app_info` takes the scope**, so two existing call sites in E7's tests
  (`connect_flow.rs`, `e7_connect_ui.rs`) pass `&GrantScope::ReadOnly`, and
  `e7_connect_ui`'s `ConnectArgs` literals gain `access: ReadOnly`. No E7
  assertion changed.
- **The read-only notice names the space uuid** in place of the brief's
  `<space uuid>` placeholder.
- **`spaceStore.canAdministerCurrentSpace`** is overridden only in
  `DataMode::Live`; `--demo-recorded` keeps the recording's value.
- **No red line for "connected_doc ignores admin"**: its test
  (`create_a_signal_type_from_the_inspector`) is ignored, and the Edit and
  Delete buttons do not depend on `canAdministerCurrentSpace`.

## Open questions

1. (§6 Q3, default kept) `--write` refuses a shared space until the policy
   check is ported.
2. (§6 Q4, default kept) Cancel settles `onError` with `kind: "cancelled"`;
   TS resolves `undefined` (onSuccess). See step 0.5. Lal's review (Q3)
   names what this changes: in TS, Cancel runs `onSuccess`, so
   `EdgeDetail` (`templates/views/src/views/GraphView/EdgeDetail.ts:315`)
   closes and bumps its revision, and `installedList`
   (`templates/kit/src/we/installedList.ts:200`) refreshes, on a cancelled
   delete; in Rust neither happens. The inspector has neither callback, so
   it is unaffected. Still open for Nico: keep cancel-as-error as a new
   contract, or match TS.
3. (§6 Q5, default kept) `fieldValue` reads the bundle's displays, so a
   community shape's fields are sent as strings.
4. (§6 Q6, Q7, Q8) unchanged: one grant per space; no connection rekey; the
   rows live in `we-ad4m/data/` until M1's `storeMap.json`.
5. New: the "New signal type" form needs one signal type to exist (above).
6. New: the inspector's `card` query includes `signals` and `$replies` (from
   `thread`); the test classes declare neither, and the executor answers the
   query anyway (the card shows). WE's own classes declare both.

## Commands run (brief §4), 2026-11-17

From `crates/renderer`, `CARGO_TARGET_DIR=/home/data/code/we-e11-target`;
the live block with `EXECUTOR_PATH=/home/data/code/ad4m-e11/bin/ad4m-executor`
and `AD4M_REQUIRE_EXECUTOR=1`. Every one passed. No pixel baseline under
`we-app/tests/snapshots/` changed.

```
$ cargo test --locked -p we-data --test writes
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.23s
$ cargo test --locked -p we-app --test e11_notices
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
$ (live) cargo test --locked -p we-ad4m -p we-app --test e11_writes --test connect_flow --test e11_live --test live_executor --test live_members --test pin --test template_queries --test e7_live --test e7_connect_ui -- --nocapture
     Running tests/connect_flow.rs (/home/data/code/we-e11-target/debug/deps/connect_flow-7e984c2b7b757346)
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.78s
     Running tests/e11_writes.rs (/home/data/code/we-e11-target/debug/deps/e11_writes-862d472f457b8d15)
the refusal reached onError in 1.254297ms
record.update settled in 1.525464ms
createSignalType settled in 7.354953ms
record.delete settled in 1.325921ms
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.87s
     Running tests/live_executor.rs (/home/data/code/we-e11-target/debug/deps/live_executor-662b2bb267f20f5e)
live record reached the tree in 437.439942ms
post-reconnect record reached the tree in 354.420427ms
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.31s
     Running tests/live_members.rs (/home/data/code/we-e11-target/debug/deps/live_members-6145e614ba4587e7)
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.68s
     Running tests/pin.rs (/home/data/code/we-e11-target/debug/deps/pin-95541dc862a286ab)
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
     Running tests/template_queries.rs (/home/data/code/we-e11-target/debug/deps/template_queries-f877ea573a3e5aa4)
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.95s
     Running tests/e11_live.rs (/home/data/code/we-e11-target/debug/deps/e11_live-4332d38b9b9d890e)
refusal: the notice in 20.074383ms
edit: on the executor in 22.079885ms, on screen in 75.66922ms
delete: gone from the executor in 20.993272ms, from the screen in 450.292914ms
test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 3.34s
     Running tests/e7_connect_ui.rs (/home/data/code/we-e11-target/debug/deps/e7_connect_ui-3bc3b82379a0fa08)
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.85s
     Running tests/e7_live.rs (/home/data/code/we-e11-target/debug/deps/e7_live-1d40ff168cffbe9d)
a call created elsewhere reached the app's tree in 205.240426ms
after a reconnect, the next call reached the tree in 353.24161ms
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.37s
$ cargo fmt --all -- --check
exit 0
$ cargo clippy --all-targets --locked -- -D warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.29s
$ cargo check --locked --target wasm32-unknown-unknown
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.18s
$ bash scripts/check-egui-free.sh
egui-free check passed: we-session we-layout we-catalog we-data we-expr we-screen we-template we-style we-legacy we-metrics + we-tui pull no egui, eframe, epaint, emath, winit, tokio (core: all features, all targets; we-tui: per native target)
$ cargo build --locked -p we-app
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 3.27s
$ cargo test --locked
175 test binaries: 1021 passed, 0 failed, 3 ignored (exit 0)
```

**Not run:** the two "Try it" commands (`cargo run --release -p we-app --
--connect [--write --space …]`). They open a window against the AD4M launcher
and wait for an approval in it; this machine has no launcher session I could
drive. `e7_connect_ui` drives the same connect window through egui against a
test executor, and `e11_live` the same space app, but nobody has clicked
through `--write` by hand yet — that is the manual check above.

## Red before each change

Each step's tests were run red before the change where the test could be
written first (steps 1, 2, 4). In steps 3 and 5 the module and its tests
were written together, so the evidence is the red line: the one line the
brief names, flipped, with the test failing, then restored. Every red line
the brief names was checked except step 5's "connected_doc ignores admin"
(its test is ignored, see Deviations).

```
## Step 1 red
rejected_displays_the_executors_message (before the variant):
    error[E0599]: no variant named `Rejected` found for enum `executor::ExecutorError`
thread 'create_update_remove_round_trip' (377075) panicked at we-ad4m/tests/e11_writes.rs:77:19:
create: not wired yet: write (E7 is read-only)
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
--
thread 'a_refusal_keeps_the_code_message_and_kind' (377074) panicked at we-ad4m/tests/e11_writes.rs:150:18:
expected a Rejected, got Err(Unsupported("write (E7 is read-only)"))

thread 'a_refusal_keeps_the_code_message_and_kind' (378606) panicked at we-ad4m/tests/e11_writes.rs:150:18:
expected a Rejected, got Err(Other("RPC error 422: Validation failed for class 'CollectionBlock': kind (missingRequired)"))

## Step 2 red
error[E0432]: unresolved import `we_data::writes`
 --> we-data/tests/writes.rs:5:14
  |
5 | use we_data::writes::{plan, PlanCx, WritePlan, WriteRows};
--
error: could not compile `we-data` (test "writes") due to 1 previous error
Red line, no detail unwrap:
thread 'update_record_field_unwraps_detail_and_coerces_by_kind' (381997) panicked at we-data/tests/writes.rs:80:5:
assertion `left == right` failed
  left: Object {"className": String("TaskBlock"), "baseUri": String("t1"), "properties": Object {"title": String("{\"detail\":\"New\"}")}}
 right: Object {"className": String("TaskBlock"), "baseUri": String("t1"), "properties": Object {"title": String("New")}}
Red line, no trim:
thread 'create_signal_type_derives_slug_aggregate_and_range' (382264) panicked at we-data/tests/writes.rs:167:5:
assertion `left == right` failed
  left: String("-up-")
 right: "up"

## Step 3 red (red lines; the host tests were written against a WriteHost that did not compile yet)
read-only return removed:
thread 'read_only_refuses_without_calling_the_executor' (388466) panicked at we-ad4m/tests/e11_writes.rs:357:5:
assertion `left == right` failed: unchanged
  left: Some("B")
--
error: test failed, to rerun pass `-p we-ad4m --test e11_writes`
notices.push dropped:
thread 'a_refused_write_runs_on_error_and_leaves_a_notice' (389047) panicked at we-ad4m/tests/e11_writes.rs:338:5:
assertion `left == right` failed: []
  left: 0
--
error: test failed, to rerun pass `-p we-ad4m --test e11_writes`
confirmation skipped:
thread 'a_delete_waits_for_the_answer' (389577) panicked at we-ad4m/tests/e11_writes.rs:372:40:
asks first
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
--
error: test failed, to rerun pass `-p we-ad4m --test e11_writes`

## Step 4 red
unit (before GrantScope):
error[E0433]: cannot find type `GrantScope` in this scope
   --> we-ad4m/src/connect.rs:549:31
    |
549 |         assert_eq!(grant_tag(&GrantScope::ReadOnly), "read-only-1");
Red line, write_capabilities pointers ["*"]:
thread 'the_write_grant_names_one_space' (395892) panicked at we-ad4m/tests/connect_flow.rs:419:5:
assertion `left == right` failed
  left: Array [Object {"with": Object {"domain": String("agent"), "pointers": Array [String("*")]}, "can": Array [String("READ")]}, Object {"with": Object {"domain": String("perspective"), "pointers": Array [String("*")]}, "can": Array [String("READ")]}, Object {"with": Object {"domain": String("perspective"), "pointers": Array [String("*")]}, "can": Array [String("UPDATE")]}]
 right: Array [Object {"with": Object {"domain": String("agent"), "pointers": Array [String("*")]}, "can": Array [String("READ")]}, Object {"with": Object {"domain": String("perspective"), "pointers": Array [String("*")]}, "can": Array [String("READ")]}, Object {"with": Object {"domain": String("perspective"), "pointers": Array [String("1b72fd46-6134-420f-92f1-8c05e539c70d")]}, "can": Array [String("UPDATE")]}]
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
thread 'the_write_grant_names_one_space' (396571) panicked at we-ad4m/tests/connect_flow.rs:384:15:
instanceCreate in another space should be refused: Object {"className": String("CollectionBlock"), "baseUri": String("ad4m://obj/moufkciedtvnhsyyrmoepcrg"), "propertiesSet": Array [String("kind"), String("title")], "collectionsSet": Array [], "parent": Null}
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


Red line, --write validation dropped:
thread 'tests::write_without_a_uuid_is_refused' (400817) panicked at we-app/src/main.rs:627:39:
refused
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace

## Step 5 red
(draw_notices was written before its test was run, so there is no before-run; the red line is the evidence.)
Red line, draw_notices without its loop:
thread 'a_notice_shows_the_executors_message_until_dismissed' (405033) panicked at we-app/tests/e11_notices.rs:25:7:
No nodes found matching the query:
By {

## Step 6 red
First run (test-side, fixed in the test): 'the new title on screen: not after 1.98s' — in edit mode the title is an input's value prop, not a text run; 'no Description control' — the label is a we-form-field label prop.
Red line, the updateRecordField row renamed:
thread 'edit_and_delete_from_the_inspector' (410947) panicked at we-app/tests/e11_live.rs:141:9:
the executor has the new title: not after 2s
```

## Round 2 (Lal and Astra's review at `dcb44044b`)

The review is `/tmp/lal-e11.md`. Every finding was right about the code; none
is skipped. One commit per finding, each test written and run red first
(red outputs below, in full in `/tmp/e11r2/`):

| finding     | commit      | what                                                                                       |
| ----------- | ----------- | ------------------------------------------------------------------------------------------ |
| P1          | `d728a8755` | writes bound to the granted space; another space opens read-only, and says why            |
| P2 lifecycle | `71e926040` | local refusals settle through the `Completer`; a second confirmation cancels the first    |
| P2 clear    | `0a2d06556` | emptying a field is refused (`clear-unsupported`), nothing sent                            |
| P3          | `c147bdae3` | an update left empty by `null`/`undefined` is a no-op success, no RPC                      |
| notes       | this file   |                                                                                            |

### P1: the grant names one space, and so does the window

`Access::Write` now carries the granted perspective uuid
(`Access::Write(SpaceId)`, built by `Access::write(uuid)`; `writes(space)`,
`in_space(space)`, `granted()`). Two checks, both local, so they hold on an
operator connection (no admin credential, no scoped token) as well as on a
scoped token:

- `live_space_app` opens any space but the granted one **read-only**
  (`LiveSpace::access` is `ReadOnly`, so the status bar —
  `LiveSpace::access_label`, moved out of `connected.rs` — says
  `read-only`, never `writes: <other space>`), and pushes the notice
  "This space is read-only: this window may change only space <A>. Start it
  with --write --space <B> to change this one." A shared space other than the
  granted one now opens read-only instead of being refused; the granted space
  shared is still refused (`SHARED_WRITE_REFUSED`).
- `WriteHost::act` refuses a write unless `access.writes(self.space)`, with
  the same notice (`read_only_notice`). The host keeps the grant itself, so
  the notice can name it.

Tests: `e11_live::switching_space_keeps_the_grant_operator` and
`…_scoped_token` (a window granted A opens B: read-only, labelled so, the
notice names A, an inspector edit leaves B unchanged; back in A an edit
lands), and `e11_writes::a_grant_for_another_space_refuses_here` (the host
alone). The last was written after the change.

Red, as written (`access` assertion first):
```
thread 'switching_space_keeps_the_grant_scoped_token' panicked at we-app/tests/e11_live.rs:481:5:
assertion `left == right` failed: B opens read-only
  left: Write
 right: ReadOnly
thread 'switching_space_keeps_the_grant_operator' panicked at we-app/tests/e11_live.rs:481:5:
assertion `left == right` failed: B opens read-only
  left: Write
 right: ReadOnly
```
Red with the `access` assertions removed, to see what the edit does — the
operator connection **wrote B**, the scoped token was refused by the
executor while the label said `writes: B`:
```
thread 'switching_space_keeps_the_grant_operator' panicked at we-app/tests/e11_live.rs:495:5:
assertion `left == right` failed: B unchanged
  left: Some(String("Changed in B"))
 right: Some(String("Task in B"))
thread 'switching_space_keeps_the_grant_scoped_token' panicked at we-app/tests/e11_live.rs:496:5:
[Notice { text: "Could not save that change. Capability is not matched, … expected: Capability { with: Resource { domain: \"perspective\", pointers: [\"348b3da0-…\"] }, can: [\"UPDATE\"] }", … }]
```
Green:
```
test switching_space_keeps_the_grant_operator ... ok
test switching_space_keeps_the_grant_scoped_token ... ok
test a_grant_for_another_space_refuses_here ... ok
```

### P2: local refusals run `onError` and `onFinally`

`WriteHost` now answers every refusal it makes itself — read-only (or
another space), a planner error — by completing the `Completer` with the
error value and returning `Invoked::Pending` (`refuse`), so the runtime runs
`onError` then `onFinally` exactly as for an executor's refusal.
`Invoked::Done` is left to the fallback (no write row), as before.

The "busy" refusal is gone. A second destructive call while a confirmation
is open does what TS's `requestDestructive` does
(`ShellStore.tsx:1254–1258`): the open one is answered "no" — settled
`Err({ kind: "cancelled" })`, so its `onError`/`onFinally` run — and the new
one takes the slot and is the question on screen.

Tests (`e11_writes`; every test template now counts `onFinally` runs as
`fin`): `a_read_only_refusal_runs_on_error_and_on_finally`,
`a_planner_error_runs_on_error_and_on_finally` (`record.update` with a
`dataset` option), `a_second_confirmation_cancels_the_first` (two
`record.delete`s in one `onClick`: the first settles `kind=cancelled fin=1`,
the second is pending; answering yes runs it, `ok=true`, `fin=2`, the record
is gone).

Red:
```
thread 'a_read_only_refusal_runs_on_error_and_on_finally' panicked at we-ad4m/tests/e11_writes.rs:299:9:
"kind=read-only fin=1" not in the tree after 5s: {… "ok=false msg= kind= fin=0" …}
thread 'a_second_confirmation_cancels_the_first' panicked at we-ad4m/tests/e11_writes.rs:299:9:
"kind=cancelled fin=1" not in the tree after 5s: {… "ok=false msg= kind= fin=0" …}
thread 'a_planner_error_runs_on_error_and_on_finally' panicked at we-ad4m/tests/e11_writes.rs:299:9:
"kind=plan fin=1" not in the tree after 5s: {… "ok=false msg= kind= fin=0" …}
test result: FAILED. 9 passed; 3 failed
```
Green: `test result: ok. 12 passed; 0 failed` (`e11_writes` at that commit).

### P2: emptying a field

**Does #1762 have a validated way to remove a property? No.** In
`/home/data/code/ad4m-e11/rust-executor/src/perspectives/instances/`:
`validate.rs:185` refuses `null` (`ValidationProblem::Null`, "omit the
property instead"); `write.rs`'s `update` sends every validated value
through `update_subject` (the setters); the WS API
(`api/perspective_instances_ws.rs:250–270`) has create, update, remove,
addToCollection and removeFromCollection — the last for collections only.
So `''` is stored as a value. Observed before the fix, after
`record.update(…, { title: "" })` on a call titled "A":
```
RED record.update: title=Some("") title_links=1 rows=[{… "title": String(""), …}]
```
— the property is present with an empty value, where WE's `clearOnEmpty`
leaves it absent (no link).

So the planner refuses it: `we_data::writes::plan` now returns
`Result<WritePlan, PlanError>` (`PlanError { kind, message }`; kinds `plan`
and `clear-unsupported`). An **update** whose properties hold `''` is refused
whole — nothing in the call is sent — with "Emptying a field is not possible
yet (<fields>): this app cannot remove a value, so it is left as it was."
The notice is the row's `fail` sentence then that; `onError` gets
`kind: "clear-unsupported"`, then `onFinally`. Covers `record.update` and
`recordStore.updateRecordField` (a text field's `''`; an emptied **number**
field is still skipped, as TS skips it). A create's `''` is not a clear and
is left as it was.

**Executor follow-up (ad4m):** a validated property clear — e.g.
`perspective.instanceUpdate` taking a `clear: [<property>]` list, or a
`perspective.instanceClearProperty` — that checks the property is a
writable, optional, single-valued property of the class and removes its
links in the update's batch. Once it exists, the planner sends `''` fields
there instead of refusing. The renderer does not write raw link removals.

Tests: `e11_writes::clearing_a_field_is_refused_and_nothing_is_sent` (both
targets; the title stays "A", one `we://title` link, one notice naming
`title`, `kind=clear-unsupported`, `fin=1`) and
`writes::emptying_a_field_is_refused` (planner).

Red (live, before the change — the executor took it):
```
thread 'clearing_a_field_is_refused_and_nothing_is_sent' panicked at we-ad4m/tests/e11_writes.rs:579:9:
record.update: {… "ok=true msg= kind= fin=1" …}
```
Red line for the planner test (the check disabled; the test was written with
`PlanError`, so its first run was a compile error):
```
thread 'emptying_a_field_is_refused' panicked at we-data/tests/writes.rs:262:32:
called `Result::unwrap_err()` on an `Ok` value: WritePlan { writes: [Write { op: Update, body: Object {"className": String("TaskBlock"), "baseUri": String("t1"), "properties": Object {"title": String(""), "status": String("done")}} }], … }
```
Green: `test clearing_a_field_is_refused_and_nothing_is_sent ... ok`;
`writes`: `test result: ok. 8 passed`.

### P3: an update left empty

When dropping `null`/`undefined` leaves an update's `properties` empty, the
planner leaves the write out; a plan with no writes answers `undefined`
(`onSuccess`) and sends nothing. A create is unchanged (the executor judges
it).

Tests: `writes::an_update_left_empty_is_a_no_op` (null-only, and
undefined-only built as a `Value` — JSON cannot hold `undefined`) and
`e11_writes::an_update_with_only_null_is_a_no_op` (live: `ok=true`, no
notice, title unchanged).

Red:
```
thread 'an_update_left_empty_is_a_no_op' panicked at we-data/tests/writes.rs:286:5:
null only: WritePlan { writes: [Write { op: Update, body: Object {"className": String("TaskBlock"), "baseUri": String("t1"), "properties": Object {}} }], … }
thread 'an_update_with_only_null_is_a_no_op' panicked at we-ad4m/tests/e11_writes.rs:614:5:
{… "ok=false msg=properties is empty kind=emptyProperties fin=1" …}
```
Green: `writes`: `ok. 9 passed`; `e11_writes`: `ok. 14 passed`.

### Not changed

- Cancel still settles `Err({ kind: "cancelled" })` (Open question 2, now
  citing Lal's Q3).
- Q2/Q4/Q5 of the review asked questions and found nothing to fix beyond
  P1/P2; the confirmation slot's "busy" is replaced as above.

### Commands run (brief §4), round 2, 2026-11-17

From `crates/renderer`, `CARGO_TARGET_DIR=/home/data/code/we-e11-target`;
the live block with `EXECUTOR_PATH=/home/data/code/ad4m-e11/bin/ad4m-executor`
and `AD4M_REQUIRE_EXECUTOR=1`. Every one exited 0. No pixel baseline changed.

```
$ cargo build --locked -p we-app
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 3.21s
$ cargo test --locked
175 test binaries: 1031 passed, 0 failed, 3 ignored (exit 0)
$ cargo test --locked -p we-data --test writes
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.24s
$ cargo test --locked -p we-app --test e11_notices
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
$ (live) cargo test --locked -p we-ad4m -p we-app --test e11_writes --test connect_flow --test e11_live --test live_executor --test live_members --test pin --test template_queries --test e7_live --test e7_connect_ui -- --nocapture
connect_flow     test result: ok. 8 passed; 0 failed; 0 ignored
e11_writes       test result: ok. 14 passed; 0 failed; 0 ignored
  record.update settled in 1.466833ms; the refusal reached onError in 1.515904ms
  createSignalType settled in 6.805225ms; record.delete settled in 1.810645ms
live_executor    test result: ok. 2 passed; 0 failed; 0 ignored
live_members     test result: ok. 1 passed; 0 failed; 0 ignored
pin              test result: ok. 1 passed; 0 failed; 0 ignored
template_queries test result: ok. 2 passed; 0 failed; 0 ignored
e11_live         test result: ok. 5 passed; 0 failed; 1 ignored
  refusal: the notice in 20.076904ms
  edit: on the executor in 21.818992ms, on screen in 71.196506ms
  delete: gone from the executor in 21.050825ms, from the screen in 448.069958ms
e7_connect_ui    test result: ok. 3 passed; 0 failed; 0 ignored
e7_live          test result: ok. 2 passed; 0 failed; 0 ignored
$ cargo fmt --all -- --check
exit 0
$ cargo clippy --all-targets --locked -- -D warnings
exit 0
$ cargo check --locked --target wasm32-unknown-unknown
exit 0
$ bash scripts/check-egui-free.sh
egui-free check passed: we-session we-layout we-catalog we-data we-expr we-screen we-template we-style we-legacy we-metrics + we-tui pull no egui, eframe, epaint, emath, winit, tokio (core: all features, all targets; we-tui: per native target)
```
The "Try it" commands were not run (no launcher session to approve in), as
in round 1.
