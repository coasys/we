# E18: the agent chat panel

Branch `port/e18-agent-chat`, from `port/bugs1` at `aebab9a2e`. One commit per step.

| step | commit      | what                                                                        |
| ---- | ----------- | --------------------------------------------------------------------------- |
| 1    | `ecaeaa7a8` | Transcript rows become turns. `ChatModel` sends on an open session id.      |
| 2    | `5f9959b59` | `AgentChat` paints the list, the transcript, and the input.                 |
| 3    | this file   | The red breaks, the gate commands, and the live session that stays blocked. |

## What the panel does

`AgentChat` replaces the stage-5 placeholder. A bound `ChatModel` paints the chat list, the open transcript, and the input. A send on an open session uses that session id. The first send with no open session creates a session, then sends on the new id. Blank text does not send. A failed send restores the trimmed draft. With no model bound, the panel says "No AI sessions" and "The Rust client has no AI session API yet."

The headless test seeds session `web-1` with "hello from web" and "hello from the web app". It opens that row. It sends "and from rust", then "second line", on `web-1`. The stand-in records both sends. It does not create a second session.

`MemoryChat` replaces the executor in these tests. The clock is a tick. The rust client has no `ai.session` API, so this crate does not call one.

`summarize` cuts a long string at 60 Unicode scalars. The TypeScript code cuts at 60 UTF-16 code units. The tests use ASCII, so both cuts match.

## What stays blocked

The rust `ad4m-client` on `origin/dev` `29ec8f8dd` and on the we pin `d2e6fab93` has no `ai.session` wrappers. Generated types exist for `ai.session`, `ai.sessionList`, `ai.sessionMessages`, `ai.sessionCreate`, `ai.sessionSend`, `ai.sessionCancel`, `ai.sessionUpdate`, `ai.sessionDelete`, and the event `ai-session-changed`. `WsRpcClient::call` can send any method. This work does not use it. Data was asked on 2026-11-18T07:35:02Z whether a call through `WsRpcClient::call` is allowed.

The acceptance test stays blocked. A chat in the Rust app does not continue a session started in web We. Follow, paging, and reconnect are not implemented. Tests use no staging executor and no account of Nico.

## Red before green

Each new test failed once. The break was one line. The line was restored before the commit. The broken tree was not committed.

Command for the eight `we-data` tests:

`cargo test --locked --offline -p we-data --lib chat::tests`

Result: 0 passed, 8 failed.

```
thread 'chat::tests::conversation_turns_keep_each_replys_own_steps' (4037467) panicked at we-data/src/chat.rs:1207:9:
assertion `left == right` failed
  left: []
 right: ["describe_perspective", "instance_create"]
```

The sort by sequence was removed.

```
thread 'chat::tests::reply_status_and_step_outcome' (4037471) panicked at we-data/src/chat.rs:1261:13:
assertion `left == right` failed: running
  left: Some(Failed)
 right: Some(Running)
```

An unknown status became `Failed`.

```
thread 'chat::tests::write_flag_comes_from_the_row_or_the_verb' (4037473) panicked at we-data/src/chat.rs:1318:9:
assertion failed: is_write_tool("space_get_name", Some(true))
```

`is_write_tool` returned false at once.

```
thread 'chat::tests::scope_of_one_perspective' (4037472) panicked at we-data/src/chat.rs:1392:9:
assertion `left == right` failed
  left: None
 right: Some("a1a2a3a4-b1b2-c3c4-d5d6-e7e8e9f0a1b2")
```

`scope_of` returned `None` at once.

```
thread 'chat::tests::continue_session_sends_on_the_same_id' (4037466) panicked at we-data/src/chat.rs:1477:9:
assertion `left == right` failed
  left: []
 right: [("web-1", "and from rust")]
```

A send of the text "and from rust" returned before the port call.

```
thread 'chat::tests::empty_or_failed_send' (4037469) panicked at we-data/src/chat.rs:1506:9:
assertion failed: mem.lock().unwrap_or_else(|poison| poison.into_inner()).sends.is_empty()
```

The blank-text return was removed. The text " " was sent.

```
thread 'chat::tests::refusal_of_the_last_settled_reply' (4037470) panicked at we-data/src/chat.rs:1607:9:
assertion `left == right` failed
  left: None
 right: Some("Capability is not matched")
```

`refusal_of` returned `None` at once.

```
thread 'chat::tests::delete_drops_the_session' (4037468) panicked at we-data/src/chat.rs:1690:9:
assertion `left == right` failed
  left: 2
 right: 1
```

`delete_session` returned `Ok` before it removed the session.

Command for the panel tests:

`cargo test --locked --offline -p we-egui --test agent_chat`

Result: 0 passed, 2 failed.

```
thread 'agent_chat_panel_continues_and_sends' (4043124) panicked at we-egui/tests/agent_chat.rs:80:7:
No nodes found matching the query:
By {
    label: "hello from web",
}
```

Open and Send did nothing. The list still showed "From the web", "Delete From the web", "Global", and "Send".

```
thread 'agent_chat_panel_unwired' (4043125) panicked at we-egui/tests/agent_chat.rs:124:7:
No nodes found matching the query:
By {
    label: "No AI sessions",
}
```

The stamp text was "No sessions". The sentence "The Rust client has no AI session API yet." stayed.

## Green

Environment for every command below: `PATH` includes `~/.cargo/bin`. `CARGO_HOME=/mnt/hdd/work/cargo-home-we-e18`. `CARGO_TARGET_DIR=/mnt/hdd/work/target-we-e18`. `CARGO_BUILD_JOBS=8`. Working directory `crates/renderer`. Debug builds only. `--offline` is added because the registry is already on disk. CI does not pass `--offline`.

On `5f9959b59`, before this notes file:

| command                                                          | result  |
| ---------------------------------------------------------------- | ------- |
| `cargo check --locked --offline --all-targets`                   | OK      |
| `cargo fmt --all -- --check`                                     | OK      |
| `cargo clippy --all-targets --locked --offline -- -D warnings`   | OK      |
| `cargo test --locked --offline -- --test-threads=8`              | failed  |
| `cargo check --locked --offline --target wasm32-unknown-unknown` | not run |
| `bash scripts/check-egui-free.sh`                                | not run |

That test run stopped in `we-legacy` on `the_committed_surface_matches_a_fresh_generation`. Node reported ENOENT for `packages/app-shell/src/shared/registries/templateSurface.ts`. The sparse checkout did not contain that path. The E18 tests had already passed. `we-data` lib tests reported 10 passed. `we-egui` test `agent_chat` reported 2 passed. `surface.rs` was not regenerated.

A copy of the `HEAD` blob supplied the missing file. A second run on the same commit passed:

| command                                                          | result                                         |
| ---------------------------------------------------------------- | ---------------------------------------------- |
| `cargo test --locked --offline -- --test-threads=8`              | OK, 182 results, 0 failed, 09:39:45Z–10:34:40Z |
| `cargo check --locked --offline --target wasm32-unknown-unknown` | OK, Finished in 5m 01s                         |
| `bash scripts/check-egui-free.sh`                                | OK                                             |

The surface test `the_committed_surface_matches_a_fresh_generation` passed in that second run. The egui-free script reported that the core crates and `we-tui` pull no egui, eframe, epaint, emath, winit, or tokio.

`pnpm format:check` from the repo root failed. The script reported `prettier: not found`. pnpm warned that `node_modules` is missing. This file was checked with Prettier using the repo options `semi`, `singleQuote`, `trailingComma: all`, `tabWidth: 2`, and `printWidth: 120`, and without the `prettier-plugin-sort-package-json` plugin.

## Could not test

- A live chat that continues a web We session on a local executor.
- Follow, paging, and reconnect.
- `pnpm format:check` for the whole repo. Prettier is not installed in this worktree.
