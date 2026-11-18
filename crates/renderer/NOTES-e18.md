# E18: the agent chat panel

Branch `port/e18-agent-chat`, from `port/bugs1` at `aebab9a2e`. One commit per step.

| step | commit      | what                                                                   |
| ---- | ----------- | ---------------------------------------------------------------------- |
| 1    | `ecaeaa7a8` | Transcript rows become turns. `ChatModel` sends on an open session id. |
| 2    | `5f9959b59` | `AgentChat` paints the list, the transcript, and the input.            |
| 3    | `f9d4dd0c1` | The first red breaks and the gate that stopped on the missing API.     |
| 4    | `6b1aed25a` | Paging and follow on `ChatPort`. `MemoryChat` stays the fake.          |
| 5    | `c2566025a` | `ai.session*` through `WsRpcClient::call`, and the live tests.         |
| 6    | `fc4a320cb` | The connected window binds the live port. The panel follows events.    |
| 7    | this file   | The new red breaks and the live gate.                                  |

## What the panel does

`AgentChat` replaces the stage-5 placeholder. A bound `ChatModel` paints the chat list, the open transcript, and the input. A send on an open session uses that session id. The first send with no open session creates a session, then sends on the new id. Blank text does not send. A failed send restores the trimmed draft. With no model bound, the panel says "No AI sessions" and "The Rust client has no AI session API yet."

The headless test seeds session `web-1` with "hello from web" and "hello from the web app". It opens that row. It sends "and from rust", then "second line", on `web-1`. The stand-in records both sends. It does not create a second session.

`MemoryChat` replaces the executor in the headless tests. The clock is a tick. `we-data` and `we-egui` still do not call the executor. The live port is `AiSessionChat` in `we-ad4m`.

`summarize` cuts a long string at 60 Unicode scalars. The TypeScript code cuts at 60 UTF-16 code units. The tests use ASCII, so both cuts match.

## The live port

Data answered yes on 2026-11-18. `we-ad4m` calls `ai.session*` through `WsRpcClient::call`. The param and result structs mirror the generated contracts. This branch does not add an `ai` module to `ad4m-client`. The wrapper should move there later. Issue 1743 CLI chat needs the same API.

`AiSessionChat` is the live `ChatPort`. `MemoryChat` stays the fake. The connected space screen binds the live port for one frame and clears it after. An offline frame stays unbound. It still says "No AI sessions" and "The Rust client has no AI session API yet."

The panel calls `follow` and asks for another paint after 200ms. That drains `ai-session-changed`. It is not a three second poll. Reconnect stays out.

A fresh executor has no agent DID. The executor then publishes `ai-session-changed` to nobody. The live tests call `agent.generate` first. The passphrase is `passphrase`. The account is local. The tests never dial staging and never use a personal account.

The acceptance test creates a session with `ai.sessionCreate` and stores "hello from web" with `ai.sessionSend`. Those are the same methods web We uses. `ChatModel` opens that id and sends "and from rust". The user row is on the same session. The test does not wait for a model reply. It cancels the running turn.

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

The live-port tests failed once each. The break was one line. The line was restored before the commit.

Command for the two new `we-data` tests:

`cargo test --locked --offline -p we-data --lib chat::tests`

The page test failed. The other chat tests were filtered out of that run.

```
thread 'chat::tests::a_page_is_the_rows_older_than_a_seq' (1694701) panicked at we-data/src/chat.rs:1776:9:
assertion failed: page.iter().any(|row| row.content.text.as_deref() == Some("one"))
```

`page_before` kept no rows. The retain test was `false`.

The follow test failed in its own run.

```
thread 'chat::tests::a_create_shows_up_when_the_port_polls' (1708963) panicked at we-data/src/chat.rs:1838:9:
assertion failed: model.follow()
```

`follow` returned false even when `poll` was true. The condition was `self.port.poll() || true`.

Command for the three `we-ad4m` unit tests:

`cargo test --locked --offline -p we-ad4m --lib ai_session::tests`

Result: 0 passed, 3 failed.

```
thread 'ai_session::tests::create_params_match_the_generated_names' (1716390) panicked at we-ad4m/src/ai_session.rs:667:9:
assertion failed: obj.contains_key("defaultPerspective")
```

`AiSessionCreate` used `snake_case`.

```
thread 'ai_session::tests::an_event_frame_keeps_the_generated_fields' (1716389) panicked at we-ad4m/src/ai_session.rs:728:9:
assertion `left == right` failed
  left: None
 right: Some("created")
```

The event frame renamed `type` to `eventType`.

```
thread 'ai_session::tests::a_timestamp_keeps_its_offset' (1716388) panicked at we-ad4m/src/ai_session.rs:743:9:
assertion `left != right` failed
  left: 0
 right: 0
```

`rfc3339_ms` rejected every string shorter than 200 bytes.

Command for the three live tests, with `EXECUTOR_PATH` set to the cached local binary `667d43e7640c0f2eca727819ce2e735fd113601d` and `--test-threads=1`:

`cargo test --locked --offline -p we-ad4m --test ai_session -- --test-threads=1`

Result: 0 passed, 3 failed, finished in 6.58s.

```
thread 'a_rust_chat_continues_a_session_the_web_api_started' (1722768) panicked at we-ad4m/tests/ai_session.rs:112:5:
assertion `left == right` failed: draft "and from rust"
  left: Some("RPC error 400: the message is empty")
 right: None
```

The send dropped the text "and from rust".

```
thread 'an_older_page_stops_before_the_named_seq' (1722878) panicked at we-ad4m/tests/ai_session.rs:176:5:
[1, 2, 3, 4]
```

`messages_before` asked for the newest page. `before` was null.

```
thread 'a_create_arrives_on_ai_session_changed' (1722487) panicked at we-ad4m/tests/ai_session.rs:152:5:
summaries []
```

`AiSessionChat::new` stored no event receiver.

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

`pnpm format:check` from the repo root failed on `f9d4dd0c1`. The script reported `prettier: not found`. pnpm warned that `node_modules` is missing.

On `fc4a320cb`, before this notes file, the same environment, still with `EXECUTOR_PATH` unset:

| command                                                          | result                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------- |
| `cargo fmt --all -- --check`                                     | OK                                                    |
| `cargo clippy --all-targets --locked --offline -- -D warnings`   | OK                                                    |
| `cargo test --locked --offline -- --test-threads=8`              | OK, 183 harness results, 0 failed, finished by 11:51Z |
| `cargo check --locked --offline --target wasm32-unknown-unknown` | OK, Finished in 27.26s                                |
| `bash scripts/check-egui-free.sh`                                | OK                                                    |

The 183 harnesses include the new `we-ad4m` test file. Without `EXECUTOR_PATH` those three tests return at once and do not start an executor. CI does the same.

A separate run set `EXECUTOR_PATH` to `/home/marvin/.cache/we/ad4m-executor/667d43e7640c0f2eca727819ce2e735fd113601d/ad4m-executor` and used `--test-threads=1`:

`cargo test --locked --offline -p we-ad4m --test ai_session -- --test-threads=1`

Result: 3 passed, 0 failed, finished in 1.72s. That binary is the npm pin already on disk. The rust client pin stays `d2e6fab93`.

`cargo test --locked --offline -p we-egui --test agent_chat` passed, 2 tests. The 200ms repaint did not pin the harness.

`corepack pnpm install --frozen-lockfile` then `pnpm format:check` from the repo root passed. Prettier reported that all matched files use its style.

## Could not test

- A completed model reply. The live tests cancel the running turn and check the user row.
- The web We browser. The session starts through the same RPC methods the web client calls.
- The other live executor tests with `EXECUTOR_PATH` set. The full suite left it unset, as CI does.
- Reconnect.
