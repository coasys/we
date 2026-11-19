# egui Connect, slice 1

The Rust We app draws the Coasys base template with the Rust renderer. A Rust BaseHost dials This computer. This screen is not a hand copy of the web AD4M Connect UI.

The template pin is `8aaf472e1e703ba948d173ccc86fadb9bb2e01a4` (we#438). The generated file is `crates/renderer/we-session/data/coasys-base.json`. Do not edit that file by hand.

## What this slice does

- A fresh window shows "Where to keep your spaces" and one row, "This computer".
- A click sets an explicit loopback URL, then starts the existing ConnectFlow.
- A closed localhost port shows "Coasys isn't responding." and "Try again".
- A running local executor opens the existing space list, then a real space.
- If the executor asks for a capability code, the host draws that prompt over the template.
- A second window with the same token directory reaches the space list. It does not ask for a new code.
- If the launcher removes the grant, the window returns to the connect screen and shows the refusal.
- A base action runs only when the gate issued a permit for the built-in base mount. A lower-tier invoke does not run.

## Screenshot

The connect-screen test is a render-and-export smoke test. It checks the accessible names and the stage. wgpu renders the screen and the test writes `connect-screen.png` under the cargo target temporary directory (`CARGO_TARGET_TMPDIR`). The test does not compare pixels and it does not compare a golden image.

## Tests

Commands ran from `crates/renderer`. `CARGO_TARGET_DIR=/mnt/hdd/work/target-we-egui-connect`. `CARGO_BUILD_JOBS=8`. `--test-threads=1`.

- `cargo test -p we-template --test base_permit --test bundle_roundtrip` — 8 passed (6 permit, 2 bundle).
- `cargo test -p we-session --test base_connect` — 8 passed.
- `cargo test -p we-ad4m --lib base::` — 6 passed.
- `cargo test -p we-app --test base_connect_ui` — 3 passed.
- `cargo test -p we-app --test e7_connect_ui` — 4 passed (`connect_pick_and_render`, `a_dead_executor_is_shown`, `a_revoked_grant_returns_to_the_connect_screen`, `the_page_lays_out_beside_the_data_panel`).
- On the final test binary, `a_restart_reuses_the_token` and `a_revoked_grant_returns_to_the_connect_screen` passed again.
- `cargo clippy -p we-expr -p we-template -p we-session -p we-ad4m -p we-app --all-targets -- -D warnings` — passed.
- `cargo clippy -p we-app --all-targets -- -D warnings` — passed after the token-reuse test.
- `cargo fmt --all` — no extra diff outside this change.

Live tests used `EXECUTOR_PATH=/mnt/hdd/work/target-autoproc/debug/ad4m-executor` (`ad4m 0.13.1-staging.11`). Each test starts its own executor on a free port. These tests did not use the production executor.

## Fix round

These tests failed before the fix. The assertion that failed is named here.

- `a_supplied_bundle_does_not_replace_the_pinned_base` failed. The mounted node id was `supplied-base`. After the fix the mounted node id is `coasys-base` and the pinned screen is what resolves.
- `a_permit_for_another_mount_starts_nothing` failed. The job count was 1. After `BaseHost` checks the permit mount, the job count is 0 and the stage stays `connect`.
- `the_prompt_clears_when_the_ask_changes` failed. After a new request the field still held `123456`. After the fix a new request, a new attempt, or no ask leaves the field empty. The same ask keeps the typed text. This test does not draw the overlay.
- `the_public_snapshot_has_no_secret_values` failed. `hostKind` was `desktop`. `the_public_chosen_is_the_connection_id` failed. `chosen` was the boolean `false`. `a_page_does_not_replace_the_stage` failed. The stage was `page`. After the fix `hostKind` is `computer`, `chosen` is the connection id, and opening or closing a page does not change the stage.

The other production-host tests passed before the mount check. With the permit check taken out, `a_space_mount_choose_starts_nothing` failed. The job count was 1. The permit check is restored. The job count is 0. Those tests drive `BaseHost`. The session tests call `we_session::command_for` for the narrower controller cases.

## Fix round commands

Commands ran from `crates/renderer` unless a command names another directory. `CARGO_TARGET_DIR=/mnt/hdd/work/target-we-egui-connect`. `CARGO_BUILD_JOBS=8`.

- `cargo check --locked --all-targets` passed.
- `cargo fmt --all -- --check` passed.
- `cargo clippy --all-targets --locked -- -D warnings` passed.
- `cargo check --locked --target wasm32-unknown-unknown` passed.
- `scripts/check-egui-free.sh` passed.
- `cargo test --locked` passed. The session connect file has 11 tests. The app library has 14 tests. The permit file has 6 tests. The connect UI file has 3 tests. `EXECUTOR_PATH` was unset, so the live executor tests did not dial an executor.
- `pnpm format:check` passed. The pinned `coasys-base.json` stays out of Prettier so its bytes do not change. A full workspace install cannot see `@we/cli` on this checkout. The check used root Prettier 3.9.10.

## Not in this slice

- No identity adapter. The first-run screen does not show.
- No executor supervisor. The starting, failed, and password screens do not show.
- Login from a web app through Coasys Connect is out of scope.
- The space list after login is the existing picker. This slice does not change that screen.
- Follow-up for the action-permit slice (Lal, non-blocking P2 on b902d08c2): `BaseHost` compares `permit.mount` with the constant name `base`, not with an incarnation of the live mount. A permit issued before a remount can still pass. Bind the permit to a per-mount incarnation id.

# egui Connect, slice 2: connection choice and persistence

## What this slice does

- The list shows This computer, then each server in the base file. A server row has the id `server:<address>`, the label from its name (or its address) and the `hard-drives` icon.
- The base file is `{config}/we-renderer/base.json` (`$XDG_CONFIG_HOME`, else `~/.config`). It keeps the id chosen last and the server list. It does not keep an address of this computer or a token.
- A start with a remembered id that the list still has goes to that place without a click. The host gets `chosen = false`. A click gives `chosen = true`.
- A remembered id that the list does not have leaves the list on screen. There is no error.
- "Choose another" shows the list. After it, "Try again" does not go back to the remembered place. A refused session does the same.
- On the offline screen, "Try again" goes to the place chosen.
- A choose with an id that is not in the list does nothing. The gate gives no permit. The controller also shows "That option isn't available anymore."
- A server cannot be opened from this app yet. The choice shows "Can't open <label> from this app yet. Choose This computer." Nothing is dialed. This is the same as the TS desktop host.
- This computer dials loopback only (`127.0.0.0/8`, `localhost`, `::1`). An `--executor-url` that is not loopback becomes a server row. It is not dialed under the This computer label.
- This computer does not need a network. If the host says that it is offline, a server choice shows "This computer is offline." The desktop app does not give a network probe yet, so the app counts as online.
- The Coming soon section for hosted places does not change.
- `we-tag` with only text children painted "…". Now it paints its text. The widget-gallery goldens showed the "…" and are new.

## Not in this slice

- No remote login. No UI to add or remove a server. Edit the base file to list one.
- No OS network monitor.
- The permit binds the mount name, not a mount incarnation (Lal P2 on slice 1). This slice does not change it.
