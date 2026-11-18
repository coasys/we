# Spaces on the left rail

Branch `port/spaces-rail`, from `origin/port/bugs1` at `aebab9a2e`.
`we-app --connect` opens a space. It does not stop on a space picker.

## What changed

After the read-only connect grant, the window opens a space. `--space`
wins. The match uses every perspective (uuid, name, shared URL, or a
`neighbourhood://` prefix), including `we-root`, `we-personal` and
`we-test`. With no `--space`, the first other perspective opens. If
`--space` is not in the list, that first space opens and a notice says
so. If the agent has only those three, the window says "This agent holds
no spaces yet. Make a space in WE first." There is no "Open a space"
screen and no "Switch space" control.

The Coasys left rail lists those spaces. `spaceStore.orderedSidebarItems`
is a host member. It has one entry per non-system perspective. `spaceId`
is the local perspective uuid, so the bundle's existing rail (`$each` +
`spaceStore.navigateToSpace`) draws them. The list is read once at
connect. It is not a subscription.

A rail click is a host action. `RendererApp` runs the click before
dispatch. The clicked node must sit in the app chrome (`app:`). The
nearest `data-we-id` must be a uuid from `agent_spaces`. That set does
not contain system perspectives. A space template cannot mint an `app:`
id, and a panel id starts with `panel:`, so those clicks are not claimed.
`follow_rail` opens the named space only through `open_from_rail`, which
refuses `is_system_space`. The same uuid is a no-op. An unknown id leaves
the notice "No space {id} on the rail."

`WriteHost` does not accept `spaceStore.navigateToSpace`. A template
`$invoke` of that target goes to `StaticHost`. `StaticHost` records it
as dropped and returns `Invoked::Done`. That answer runs no `onError`
and no `onFinally`. The invoke cannot fill a navigation slot and cannot
raise a grant prompt. This does not add an action-permit system. It
closes only this new path. `--space` can still name a system perspective.

The window stays read-only until a write grant succeeds. The first edit
of a personal space requests that space's write grant in a second connect
flow, drawn over the space. The refused edit is not replayed. Cancel,
Escape, or a click outside the grant modal clears the request and leaves
the read-only session. A later edit can request the grant again. A shared
space is refused with the existing shared-space message and does not
request a grant. `--write --space <uuid>` still requests the grant up
front and still requires a uuid.

A discovered connect leaves `settings.url` empty. The grant sets that
field to the executor the window already holds, so the grant does not
search again. An explicit `--executor-url` is left as it is.
`Io::allowed` still refuses every other candidate. If the grant answers
from a different executor, the window clears the request, stays
read-only, and shows "The write grant answered from a different executor.
This window stays read-only."

`the_first_edit_asks_for_the_write_grant` drives the edit through the
inspector. It opens the task, clicks Edit, and dispatches `onChange` on
the title field. It does not call `WriteHost::gate_write`. Before the
grant, the title stays "Rail task" and no notice says "Could not save".
After the grant, the same edit does not open the grant again. On this
executor pin the second edit is sent and the notice says "Could not save"
(`perspective.instanceUpdate` is missing). A changed title would also
pass. The test does not treat a successful write as shown.

`first_edit_dispatch` runs with no executor. A local TCP listener
completes the WebSocket handshake and counts text and binary frames.
A read-only `recordStore.updateRecordField` goes through `Session::dispatch`,
requests the grant, runs `onError` and `onFinally`, and sends no frame.
`spaceStore.navigateToSpace` is dropped. A shared space does not request
a grant. CI runs this file. It does not need `EXECUTOR_PATH`.

## Staging

Not run. `cargo run --release -p we-app -- --connect --executor-url
https://staging.ad4m.dev --email <account>` needs an account. This run
has no account, and a secret must not land in a log.

## Executor

Live tests use the repo pin, fetched by `node scripts/ad4m-executor.mjs`,
not a local ad4m build:

`~/.cache/we/ad4m-executor/667d43e7640c0f2eca727819ce2e735fd113601d/ad4m-executor`

That binary does not implement `perspective.instanceCreate` or
`perspective.instanceUpdate`. On the previous round, with `EXECUTOR_PATH`
set, `e11_writes` panicked in the fixture (`create: Unknown type:
perspective.instanceCreate`) before `WriteHost`. `e11_live`:
`a_shared_space_is_not_opened_for_writing` passed. The write tests failed
with `Unknown type: perspective.instanceUpdate`.
`switching_space_keeps_the_grant_*` passed the read-only checks on the
other space and then timed out on "A renamed" for the same missing RPC.
The skip was left as it is. This round did not re-run `e11_writes` or
`e11_live` with `EXECUTOR_PATH`. CI does not set `EXECUTOR_PATH`, so
those tests return there. `AD4M_REQUIRE_EXECUTOR=1` was set for
`spaces_rail` and `e7_connect_ui` only.

## Commands

From `crates/renderer`, `CARGO_TARGET_DIR=/mnt/hdd/work/target-we-spaces-rail`,
toolchain 1.96.1. Debug profile, the one CI uses. Local runs pass
`--test-threads=1`. CI's `cargo test --locked` does not.

No executor. These passed, then one assertion in each new test was
wrong on purpose, then the assertion was restored and the same commands
passed again:

```
cargo test --locked -p we-ad4m --lib -- --test-threads=1 grant_
# restored: test result: ok. 4 passed

cargo test --locked -p we-ad4m --test first_edit_dispatch -- --test-threads=1
# restored: 4 passed in 0.49s

cargo test --locked -p we-app --lib -- --test-threads=1 connected::
# restored: test result: ok. 10 passed
```

With `EXECUTOR_PATH` set to the pin above and `AD4M_REQUIRE_EXECUTOR=1`:

```
cargo test --locked -p we-app --test spaces_rail -- --test-threads=1
# restored: 3 passed in 5.19s

cargo test --locked -p we-app --test e7_connect_ui -- --test-threads=1
# before the deliberate failures: 4 passed in 6.18s
```

`e7_connect_ui` was not in the restored run. Its code path did not change
after that green run. The two clippy fixes after it are a SHA-1 loop and
a type alias.

## Red, then restored

One assertion was reversed in each new or changed test. The rest of the
test stayed as it passed. The assertion was then restored. The first
round's three breaks remain in commit `c594cf487`.

`a_chrome_row_click_names_an_allowed_space` — expected id `id-nope`:

```
assertion `left == right` failed
  left: Some("id-beta")
 right: Some("id-nope")
```

`a_space_template_click_cannot_name_a_rail_row` — `is_none()` changed to `is_some()`:

```
assertion failed: rail_row_id(&row, &"space:row/btn".into(), &allowed(&["id-beta"])).is_some()
```

`a_system_uuid_on_a_chrome_row_is_not_a_rail_click` — `is_none()` changed to `is_some()`:

```
assertion failed: rail_row_id(&row, &"app:row/btn".into(), &allowed(&["id-beta"])).is_some()
```

`a_panel_click_cannot_name_a_rail_row` — `is_none()` changed to `is_some()`:

```
assertion failed: rail_row_id(&row, &"panel:inspector/btn".into(),
        &allowed(&["id-beta"])).is_some()
```

`the_rail_does_not_open_a_system_space` — `open_from_rail(..., "id-we-root")` required to be `Some`:

```
assertion failed: open_from_rail(&rows, "id-we-root").is_some()
```

`a_discovered_grant_pins_the_open_executor` — expected URL `http://other:1`:

```
assertion `left == right` failed
  left: Some("http://127.0.0.1:12000/api")
 right: Some("http://other:1")
```

`same_executor_ignores_scheme_slash_and_userinfo` — `http` and `ws` on the same port required to differ:

```
assertion failed: !same_executor("http://127.0.0.1:12000/", "ws://127.0.0.1:12000")
```

`the_websocket_accept_matches_the_rfc` — expected accept `not-the-rfc-accept`:

```
assertion `left == right` failed
  left: "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
 right: "not-the-rfc-accept"
```

`a_read_only_edit_goes_through_dispatch_and_asks` — the grant slot required to stay empty:

```
Some("space-1")
```

`a_template_invoke_cannot_navigate` — the navigate invoke required to fill the grant slot:

```
assertion `left == right` failed
  left: None
 right: Some("space-1")
```

`a_shared_space_edit_does_not_ask` — the shared edit required to fill the grant slot:

```
assertion `left == right` failed
  left: None
 right: Some("space-1")
```

`the_rail_lists_every_space_and_a_click_opens_it` — `we-root` required to be on the rail:

```
we-root is absent
```

`the_first_edit_asks_for_the_write_grant` — `access.writes` negated after the grant:

```
Write(SpaceId(6e7937d6-bdc7-4b00-9fb6-518a3ceaac01))
```

`cancelling_the_write_grant_stays_read_only` — the read-only label required to be gone:

```
still read-only
```

## CI commands

From `crates/renderer`, same target dir, debug profile. Local
`--test-threads=1`. `EXECUTOR_PATH` and `AD4M_REQUIRE_EXECUTOR` were unset.

```
cargo fmt --all -- --check
# FMT_CHECK:0

cargo clippy --all-targets --locked -- -D warnings
# CLIPPY:0 in 4m 23s. An earlier run failed on needless_range_loop in the
# SHA-1 schedule and type_complexity on the rail-click field. Both are fixed.

cargo test --locked -- --test-threads=1
# 183 binaries, 1070 passed, 0 failed, 3 ignored.
# The three ignored tests were already ignored: coasys_shots,
# create_a_signal_type_from_the_inspector, and gradient::tests::miss_cost.
# Live executor tests return immediately because EXECUTOR_PATH is unset.

cargo check --locked --target wasm32-unknown-unknown
# clean, 1m 09s

scripts/check-egui-free.sh
# clean
```

## Open questions

- With no `--space`, the window opens the first non-system row in
  `list_spaces` order (shared first, then name, names that start with
  `we-` last). The web app remembers the last place. This app has no
  last-place store.
- "All spaces" here means every perspective except `we-root`,
  `we-personal` and `we-test`. Those three still open with `--space`.
  A name that only starts with `we-` stays on the rail (`we-custom`).
- `spaceId` on the rail is the local perspective uuid, not a
  neighbourhood CID.
- The space list is read once at connect.
- The edit that requested the grant is not retried. On this pin the next
  edit is sent and fails with "Could not save", because
  `perspective.instanceUpdate` is missing. The test shows that the edit
  is not refused locally. It does not show a stored title change.
- `--write --space` still requests the grant up front, and still requires
  a uuid.
- The grant pin for a discovered connect is a unit test
  (`a_discovered_grant_pins_the_open_executor`). The live grant test uses
  an explicit executor URL, so it does not exercise discovery.
- Cancel is the button the live test clicks. Escape and a click outside
  use the same `should_close` path as the confirm dialog. The live test
  does not press Escape.
- A full action permit, a handler-to-host origin matrix, a required CI
  job with `AD4M_REQUIRE_EXECUTOR`, grant persistence across two spaces,
  write-token revocation, two windows, and an empty-screen reconnect are
  out of this slice.
- Staging was not run by hand.
