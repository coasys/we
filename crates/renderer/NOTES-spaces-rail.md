# Spaces on the left rail

Branch `port/spaces-rail`, from `origin/port/bugs1` at `aebab9a2e`.
`we-app --connect` no longer stops on a space picker.

## What changed

After the read-only connect grant, the window opens a space. `--space`
wins, matched against every perspective (uuid, name, shared URL, or a
`neighbourhood://` prefix), including `we-root`, `we-personal` and
`we-test`. Without it, the first other perspective opens. If `--space`
is not in the list, that first space opens and a notice says so. If the
agent has only those three, the window says "This agent holds no spaces
yet. Make a space in WE first." There is no "Open a space" screen and
no "Switch space" control.

The Coasys left rail lists those spaces. `spaceStore.orderedSidebarItems`
is a host member: one entry per non-system perspective, `spaceId` set to
the local perspective uuid, so the bundle's existing rail (`$each` +
`spaceStore.navigateToSpace`) draws them. A click is intercepted in
`WriteHost` and opens that space. The same uuid is a no-op. The list is
taken once at connect, not subscribed.

The window stays read-only. The first edit of a personal space asks for
that space's write grant in a second connect flow, drawn over the space.
The refused edit is not replayed. A shared space is refused with the
existing shared-space message and does not ask. `--write --space <uuid>`
still asks up front and still requires a uuid.

The grant test does not drive an inspector edit. It calls
`WriteHost::gate_write`, which is the check a write row runs before it
plans.

## Staging

Not run. `cargo run --release -p we-app -- --connect --executor-url
https://staging.ad4m.dev --email <account>` needs an account, and there
is no way to do that here without putting a secret in a log.

## Executor

Live tests use the repo pin, fetched by `node scripts/ad4m-executor.mjs`,
not a local ad4m build:

`~/.cache/we/ad4m-executor/667d43e7640c0f2eca727819ce2e735fd113601d/ad4m-executor`

That binary does not implement `perspective.instanceCreate` or
`perspective.instanceUpdate`. `e11_writes` only skips "method not found"
/ "unknown method", so with `EXECUTOR_PATH` set all 14 tests panic in
the fixture (`create: Unknown type: perspective.instanceCreate`) before
`WriteHost`. `e11_live`: `a_shared_space_is_not_opened_for_writing`
passed; the write tests fail with `Unknown type: perspective.instanceUpdate`;
`switching_space_keeps_the_grant_*` got through the read-only checks on
the other space and then timed out on "A renamed" for the same missing
RPC. The skip was left as it is. CI does not set `EXECUTOR_PATH`, so
those tests skip there. `AD4M_REQUIRE_EXECUTOR=1` was set only for
`spaces_rail` and `e7_connect_ui`.

## Commands

From `crates/renderer`, `CARGO_TARGET_DIR=/mnt/hdd/work/target-we-spaces-rail`,
toolchain 1.96.1. Debug profile, the one CI uses.

Landing and the system-space filter (no executor):

```
cargo test --locked --lib -p we-ad4m -p we-app -- --test-threads=1 \
  system_perspectives no_request_opens a_missing_name an_explicit_system \
  only_system the_sidebar
```

`test result: ok` (6 tests).

Connect window and the rail, with `EXECUTOR_PATH` set to the pin above
and `AD4M_REQUIRE_EXECUTOR=1`:

```
cargo test --locked -p we-app --test e7_connect_ui -- --test-threads=1
# test result: ok. 4 passed; 0 failed; finished in 5.98s

cargo test --locked -p we-app --test spaces_rail -- --test-threads=1
# test result: ok. 2 passed; 0 failed; finished in 3.44s
```

`e7_connect_ui` is the old connect test with the picker click removed:
it waits for stage `space` and the rail button named with the seeded
space, and asserts the stage is never `pick` and "Open a space" is absent.

## Red, then restored

One assertion flipped in each test, the rest of the test left as it
passed, then the line put back.

`connect_and_render` — `is_none()` on "Open a space" flipped to `is_some()`:

```
assertion failed: h.query_by_label("Open a space").is_some()
```

`the_rail_lists_every_space_and_a_click_opens_it` — the `rail-beta`
button required to be absent:

```
rail-beta is on the rail
```

`the_first_edit_asks_for_the_write_grant` — `access.writes(&uuid)`
negated, after the grant had been approved:

```
Write(SpaceId(4d1fe684-504e-40aa-a614-7d8320ef8c72))
```

## CI commands

From `crates/renderer`, same target dir, debug profile:

```
cargo fmt --all -- --check          # clean
cargo clippy --all-targets --locked -- -D warnings   # clean
cargo test --locked -- --test-threads=1
```

The suite, without `EXECUTOR_PATH` (CI's shape, so the live executor tests return immediately): 182 binaries, 1058 passed, 0 failed, 3 ignored. The three ignored tests were already ignored: `coasys_shots`, `create_a_signal_type_from_the_inspector`, and `gradient::tests::miss_cost`.

```
scripts/check-egui-free.sh                         # clean
cargo check --locked --target wasm32-unknown-unknown   # clean
```

## Open questions

- With no `--space`, the window opens the first non-system row in
  `list_spaces` order (shared first, then name; names starting with
  `we-` last). The web app remembers the last place. This app has no
  last-place store.
- "All spaces" here means every perspective except `we-root`,
  `we-personal` and `we-test`. Those three still open with `--space`.
  A name that only starts with `we-` stays on the rail.
- `spaceId` on the rail is the local perspective uuid, not a
  neighbourhood CID.
- The space list is read once at connect.
- The edit that asked for the grant is not retried. The next edit writes.
- `--write --space` still asks up front, and still requires a uuid.
- An empty agent and a shared space's first edit are specified and
  covered by unit checks, not by a fixture-executor test.
- Staging was not looked at by hand.
