# PR Plan: AD4M Executor Graceful Shutdown on SIGTERM/SIGINT

## Summary

Add proper signal handling to `ad4m-executor` so it shuts down cleanly when killed,
releasing RocksDB LOCK files, Holochain's port binding, and the lair-keystore socket
before exiting. This would allow WE's Electron main process to spawn the executor as
a normal (non-detached) child process and remove all the startup cleanup scaffolding
currently in `we-electron/electron/main.js`.

## Motivation

Currently `ad4m-executor` does not handle SIGTERM or SIGINT. When the Electron parent
is killed by Ctrl+C (or crashes), the executor — spawned with `detached: true` so its
process group can be killed via `process.kill(-pid)` — survives because
`electron.unref()` means it is never reaped by the parent. On the next launch:

- Holochain's WebSocket port is still bound → executor panics with `Address already in use`
- RocksDB LOCK files for every perspective's SPARQL store are still held → executor panics
  with `Resource temporarily unavailable`
- The lair-keystore socket may still exist on disk

To work around this, `we-electron/electron/main.js` currently:

1. Runs `pkill -SIGKILL -f ad4m-executor` at startup (with an 800 ms sleep)
2. Manually deletes all `~/.ad4m/perspectives/*/sparql_store/LOCK` files
3. Manually deletes the lair-keystore socket
4. Uses `detached: true` + `unref()` on the spawn so the group can be killed

All of this is defensive scaffolding for a problem that should be solved at the source.

## Proposed Fix (Rust / AD4M repo)

Register a `ctrlc` (or `signal-hook`) handler inside `ad4m-executor` that:

1. Sends a graceful shutdown signal to the Holochain conductor (or drops the conductor handle)
2. Flushes and closes all RocksDB / SPARQL store instances
3. Shuts down the lair-keystore connection cleanly
4. Exits with code 0

```rust
// rust-executor/src/main.rs (or bin entry point)
ctrlc::set_handler(move || {
    tracing::info!("Received shutdown signal — shutting down gracefully...");
    // signal the tokio runtime / conductor to stop
    shutdown_tx.send(()).ok();
})?;
```

A `tokio::select!` on the shutdown channel alongside the normal `run_forever` future
is the idiomatic pattern for Tokio-based services.

## What Changes in WE After This Is Done

Once the executor shuts down cleanly on SIGTERM/SIGINT, `we-electron/electron/main.js`
can be simplified:

- Remove the `pkill` call + 800 ms sleep from `startExecutor()`
- Remove the SPARQL LOCK file cleanup loop
- Remove the lair-keystore socket cleanup
- Remove `detached: true` from the `spawn()` call (use a normal child process)
- Remove `execSync` import (no longer needed)
- `killExecutor()` can use `executorProcess.kill('SIGTERM')` instead of
  `process.kill(-pid, 'SIGKILL')` on the process group

The executor's stdio can remain piped without the `unref()` workaround, and a single
Ctrl+C in the terminal will cleanly propagate through `concurrently → Electron → executor`.

## Relevant Files

**AD4M repo (changes needed):**

- `rust-executor/src/main.rs` — add signal handler
- `Cargo.toml` — add `ctrlc` or `signal-hook` dependency

**WE repo (cleanup after fix):**

- `apps/we-electron/electron/main.js` — remove startup cleanup scaffolding

## Notes

- The `detached: true` + group-kill approach already works as a stopgap
- The startup `pkill` is intentionally SIGKILL (not SIGTERM) because a stale executor
  that ignored SIGTERM would block the launch indefinitely
- This is a dev-experience issue only; production packaged builds use OS-level lifecycle
  management (systemd, launchd, WinSvc) which handles this differently
