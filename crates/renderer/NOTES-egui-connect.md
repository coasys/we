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

`/home/marvin/.openclaw/workspace/agent-runs/we-egui-connect/connect-screen.png`

The shot is the connect screen before a click. wgpu rendered it. The Coasys mark is visible.

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

## Not in this slice

- No identity adapter. The first-run screen does not show.
- No executor supervisor. The starting, failed, and password screens do not show.
- Login from a web app through Coasys Connect is out of scope.
- The space list after login is the existing picker. This slice does not change that screen.
- A remembered connection choice is later work.
