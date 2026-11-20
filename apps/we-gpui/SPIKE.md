# Spike: a GPUI desktop shell for WE

A third desktop shell beside `apps/we-tauri` and `apps/we-electron`. Neither of those was changed.
Two code paths were tried:

- **A:** GPUI hosts the WE web build in an embedded webview.
- **B:** a native GPUI surface draws real executor data.

Both exist and both run on Linux.

## What a desktop shell has to provide, and where this one stands

| Duty                                            | Tauri / Electron do it in                                                                                                          | GPUI shell                                                                                                                                                                                                                         | State                                                                                                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App window with the WE web build                | `tauri.conf.json` window / `BrowserWindow`                                                                                         | `shell::open_main`: a GPUI window with a wry child webview, built by gpui-webview                                                                                                                                                  | Works on X11 and XWayland. Native Wayland is impossible (see the matrix)                                                                                                                   |
| Serving the bundle                              | Tauri asset protocol / Electron `protocol.handle`                                                                                  | `assets.rs`: a custom scheme serves `dist/` from disk with path-traversal refusal. The window opens at the origin root, because WE routes on the path                                                                              | Works                                                                                                                                                                                      |
| Executor lifecycle                              | Tauri links ad4m-executor in-process. Electron spawns it                                                                           | `executor.rs`: spawns the executor binary, probes readiness over RPC, watches it, and stops it on exit                                                                                                                             | Works. Details under "Bugs found"                                                                                                                                                          |
| Executor dies with the shell                    | Electron sets `AD4M_EXIT_WITH_PARENT`, which **no ad4m reads**, not even the pinned 27f7f91. Tauri needs nothing, being in-process | Linux: `PR_SET_PDEATHSIG` from a dedicated thread that outlives the spawn                                                                                                                                                          | Works on Linux (tested by a crashing child process). macOS: **seen failing**, since a SIGTERM to the shell left its executor running, which then ignored SIGTERM itself. Windows: not done |
| Custody sidecar (`we_custody`)                  | Linked as a crate                                                                                                                  | Linked as a crate, the same way Tauri does                                                                                                                                                                                         | Works. Runs used the sealed-file store, not the real keyring                                                                                                                               |
| Identity window                                 | A separate Tauri window running `@we/identity-window`                                                                              | A second GPUI+webview window. Its own bundle (`identity/`) is driven over the same IPC (`identity_flow_*`)                                                                                                                         | Works. Opening, stepping and cancelling were verified. Cancelling used to crash; fixed, see below                                                                                          |
| Navigation policy                               | `on_navigation` / `will-navigate`                                                                                                  | `navigation.rs`: same origin allowed, http(s)/mailto opened externally, everything else refused. Pop-ups denied and handed to the OS                                                                                               | Works, unit-tested                                                                                                                                                                         |
| IPC                                             | `@tauri-apps/api` invoke/listen / Electron preload                                                                                 | `bridge.rs` + `src/platform/bridge.ts`: `window.__WE_GPUI__.invoke/listen` over wry's IPC, nonce-checked so only the shell's own init script may call. Command and argument names are Tauri's, so `gpuiPlatform.ts` is a near-copy | Works                                                                                                                                                                                      |
| Account registry                                | `accounts.rs` (Tauri)                                                                                                              | **The same file**, included by `#[path]`, as is `executor_log.rs`. Nothing is forked                                                                                                                                               | Works                                                                                                                                                                                      |
| Deep links (`we://`)                            | Tauri deep-link plugin / Electron `open-url`                                                                                       | —                                                                                                                                                                                                                                  | **Not done**                                                                                                                                                                               |
| Single instance                                 | Plugin / `requestSingleInstanceLock`                                                                                               | —                                                                                                                                                                                                                                  | **Not done**                                                                                                                                                                               |
| Seed app servers (`portMap`)                    | Tauri serves seed apps on ports                                                                                                    | — (`portMap: {}`)                                                                                                                                                                                                                  | **Not done**                                                                                                                                                                               |
| Stale lock/socket cleanup, stray-executor sweep | Electron supervisor                                                                                                                | —                                                                                                                                                                                                                                  | **Not done**                                                                                                                                                                               |
| Packaging, signing, auto-update                 | `tauri bundle` + updater / electron-builder + electron-updater                                                                     | —                                                                                                                                                                                                                                  | **Not done**. Nothing in the GPUI ecosystem provides these; see below                                                                                                                      |

## Platform matrix

| Platform                               | App window (A: webview)                                                                                                                                                                                                                                                                                                                                                                                               | Native surface (B: launcher)                                                               | Evidence                                                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux X11 (Xvfb, software GL)          | **Works end to end:** create an account, sign in, WE home, settings, identity window open and cancel                                                                                                                                                                                                                                                                                                                  | Works                                                                                      | Screenshots `02`–`09`; logs from runs 1–4                                                                                                                |
| Linux XWayland (GNOME, Radeon, Vulkan) | **Works** after one fix (wry panicked on an X screen reporting 0 mm wide). Welcome screen rendered                                                                                                                                                                                                                                                                                                                    | Works                                                                                      | Screenshots `10`, `11`; run 6 log                                                                                                                        |
| Linux native Wayland                   | **Impossible with this stack.** gpui-webview: "WebView on Linux requires an X11 window". Raw wry: "the window handle kind is not supported". WebKitGTK cannot be a child of a foreign Wayland surface                                                                                                                                                                                                                 | **Works**: GPUI on Vulkan (RADV), client-side decorations, executor started and supervised | Logs `/tmp/probe-wl.log`, `/tmp/probe-wl-raw.log`, run 7. No screenshot: GNOME Wayland has no capture tool here short of grabbing the whole real desktop |
| macOS (Apple Silicon, 15.7)            | **Runs, not seen.** Builds only with **Rust ≥ 1.98**: gpui-pre-macos uses `Option::map_or_default`, stabilised in 1.98.0, and WE pins 1.96.1. With 1.98 it builds without warnings. Run from ssh: the executor became ready, the app window opened, a WKWebView WebContent process started, and the page loaded WE's bundle and called the shell over IPC (`list_accounts`, `get_port`, `request_credential`, all ok) | Opened (log); not seen                                                                     | Mac run 2 log. 67/67 native tests pass there. No screenshot: `screencapture` over ssh has no Screen Recording permission and returns only the wallpaper  |
| Windows                                | Untested: no Windows host was available. gpui-webview lists WebView2 as supported, and the README says the webview covers GPUI overlays there                                                                                                                                                                                                                                                                         | Untested                                                                                   | —                                                                                                                                                        |

"Works on Linux" means **X11 or XWayland only**. A WE GPUI app on a Wayland desktop runs as an X
client, as Electron does without `--ozone-platform=wayland`. For the webview path that is a dead
end, not a stage on the way: the limit is that WebKitGTK cannot be a child of another toolkit's
Wayland surface, and gpui-webview's README lists Wayland as "not supported; run on XWayland".

## Measurements

All on this machine (Ryzen AI Max / Radeon 8060S, Ubuntu 26.04), from this branch.

**Binary**

|                                                   | Size       |
| ------------------------------------------------- | ---------- |
| `we-gpui` release, unstripped                     | 60.4 MB    |
| `we-gpui` release, stripped                       | 46.6 MB    |
| `dist/` (the WE web build it serves)              | 26 MB      |
| `ad4m-executor` it spawns (ad4m 0.13.1-staging.6) | 396 MB     |
| A clean release build                             | 1 min 18 s |

The binary links webkit2gtk-4.1, gtk3 and gstreamer dynamically, as Tauri's does.

**Startup** (from process launch; the executor's data dir already initialised)

| Run                                   | Executor answering RPC | App window and webview created |
| ------------------------------------- | ---------------------- | ------------------------------ |
| X11 relaunch                          | 504 ms                 | 695 ms                         |
| X11 relaunch                          | 509 ms                 | 710 ms                         |
| X11 first run (no agent yet)          | 514 ms                 | 784 ms                         |
| XWayland first run                    | 518 ms                 | 762 ms                         |
| macOS first run (M-series)            | 595 ms                 | 1065 ms                        |
| macOS first run, again (new data dir) | —                      | 740 ms                         |

On macOS the release binary is 23.8 MB (it links the system WebKit), and RSS after the page's first
IPC was 99 MB for `we-gpui` plus 298 MB for WebKit's WebContent process.

"Window created" is when the window and the webview exist. It is not when WE has painted; the page
paints within roughly a second after that, judging by screenshots, but that was not timed.

**Memory**

Signed in, X11 run 4, software GL:

| Process              | RSS     | PSS    |
| -------------------- | ------- | ------ |
| `we-gpui`            | 288 MB  | 204 MB |
| WebKitWebProcess     | 512 MB  | 432 MB |
| WebKitNetworkProcess | 68 MB   | 35 MB  |
| ad4m-executor        | ~330 MB | —      |
| systemd unit total   | ~724 MB | —      |

On XWayland, at the Welcome screen with GPU GL, the shell was RSS 220 MB / PSS 133 MB, WebKit
489 + 68 MB, and the executor 91 MB (no agent yet). The launcher alone on native Wayland was RSS
155 MB / PSS 117 MB: that is GPUI's own floor, with a Vulkan device and the font atlas.

**Against Tauri and Electron, from the same commit**

- **Tauri: could not be built from this commit.** Its generated `Cargo.toml` takes ad4m-executor by
  path from the sibling `../ad4m` checkout. That checkout is on a commit with no
  `ad4m-identity-client`, so cargo fails before compiling. Moving that checkout belongs to other
  work and was left alone.
  - As an indication only: a Tauri release binary built 2026-10-28 in another worktree is
    **415.6 MB**. That is one file, executor included, against GPUI's 46.6 MB + 396 MB executor
    - 26 MB dist.
  - The two are the same order. In both, the executor dominates, and the shell itself is noise.
- **Electron: not run.** Its runtime from this lockfile (electron 44.10.1) is 284 MB on disk
  (`electron` binary 229 MB), before the app and before the executor it spawns.
- Tauri's in-process executor means its memory shows as one process. Electron's renderer is
  Chromium, which is heavier per page than WebKitGTK.
  - **Guess, not measured:** Electron is roughly +150–300 MB over the WebKit numbers above, and
    Tauri is close to GPUI's, since it runs the same WebKitGTK.

## GPUI against Tauri and Electron, beyond the numbers

- **GPU and driver needs.** GPUI on Linux renders through wgpu, Vulkan first. It ran on RADV (and
  in Xvfb on llvmpipe). A machine with no working Vulkan and no software fallback will not draw
  GPUI at all. Tauri and Electron degrade to software paths more gracefully.
  - The webview itself is WebKitGTK either way, with the same needs as Tauri's.
  - XWayland logged "Failed to get screen mode info from xrandr" and "no xinput mouse pointers".
    Both are harmless here, but they are a sign of how little GPUI's X11 path is exercised.
- **Maturity.**
  - GPUI has no stable release. `gpui` 0.2.2 on crates.io is older than Zed and has no webview
    crate. Used here: `gpui-pre` 0.3.11 (a republish of zed@f816e1f) through `gpui-kit` 0.9.0,
    and `gpui-webview` 0.9.0 on `lb-wry` 0.53.3, all longbridge's.
  - gpui-webview calls itself "experimental with limited features". That showed: two of the
    five bugs below are in the GPUI/wry seam (the close order, a documented contract the caller
    must keep by hand, and the XWayland scale panic) and each took the process down.
  - The macOS build needs rustc 1.98 where WE pins 1.96.1 (see the matrix). Since gpui-pre
    tracks Zed, expect it to keep needing a recent compiler.
  - Tauri 2 and Electron are both stable, with large user bases.
- **Accessibility.**
  - The WE UI is in the webview, so its accessibility is WebKitGTK's AT-SPI, exactly as in Tauri.
  - GPUI-drawn surfaces get accesskit through gpui-pre (`window/a11y.rs`). The launcher declares no
    roles or labels yet and was not checked with a screen reader.
  - Moving WE's UI into native GPUI would mean re-earning, per surface, what the web build already has.
- **IME.**
  - In the webview, input methods are WebKitGTK's (IBus/Fcitx through GTK), as in Tauri.
  - GPUI's own text input uses XIM on X11 and text-input-v3 on Wayland (`xim_handler.rs`,
    `wayland/client.rs`).
  - Typing into WE through XTest worked; composition through a real IME was not tested.
- **Packaging, signing and auto-update.**
  - Tauri ships bundlers (AppImage/deb/rpm/dmg/msi), notarisation hooks and an updater.
  - Electron has electron-builder and electron-updater.
  - GPUI has none of these. Zed built its own: a bundling script, notarisation in CI, and an
    updater with its own server. A WE GPUI shell would have to do the same. Here the binary is
    unpackaged and reads `dist/` and the executor from disk (`WE_GPUI_DIST`, `WE_AD4M_EXECUTOR`).

## What B, the native surface, cost

The executor window (`native/src/launcher.rs`, 257 lines) draws live state: the supervisor's
process, readiness time, data path and log path, and what the executor answers over RPC (version,
agent DID, initialised, unlocked). It also lists the shared account registry and has
Start/Stop/Restart/Open WE buttons. It needed no webview, so it is the only thing that runs on native
Wayland. Screenshot `11-xwayland-launcher.png`.

Its cost was low because gpui-component supplies the button, flex and theme primitives. What it
does not show is the cost that would matter: WE's UI is a schema renderer over Lit and Solid
components, and none of that exists in GPUI.

A native WE would mean a second renderer for the schema system, plus primitives re-implemented in
GPUI, and a second accessibility and IME story. That is a new framework adapter in the sense of
"The Three Seams" in `AGENTS.md`, but one that cannot reuse a single primitive, because the
primitives are web components. That is not a spike-sized step, and nothing measured here suggests it
pays back.

## Bugs found on the way

Each is fixed, and each but one has a test.

1. **Readiness probe.** It waited on `runtime.info`, which answers "Agent not found" until an agent
   exists, so a first run timed out at 120 s. It now waits on `agent.status`
   (`an_executor_with_no_agent_yet_is_still_up`).
2. **Start URL.** The window opened at `/index.html`; WE routes on the path and showed "Page not
   found" after sign-in. It now opens at the origin root
   (`a_window_opens_at_the_root_its_router_knows`).
3. **Closing the identity window crashed the shell.** X BadWindow, then GDK exits the process,
   because the GPUI window was destroyed before the WebKit child it parents.
   - It now releases the webview first, then removes the window a moment later
     (`shell::close_webview_window`).
   - Verified live (screenshot `08`). **Not covered by an automated test**: it needs a real X
     server and WebKit.
4. **The executor outlived a crashed shell.** It now gets `PR_SET_PDEATHSIG` from a thread that
   lives as long as the child, because the signal follows the _thread_ that forked, not the
   process. Tested by `the_executor_dies_with_a_crashed_shell`, which fails with the fix removed.
   - This also showed that Electron's `AD4M_EXIT_WITH_PARENT` is read by no ad4m.
5. **XWayland panic.** wry scales logical initial bounds by the X screen's physical width; GNOME's
   XWayland reports 0 mm, so the scale is infinite and `dpi` asserts. The webview is now built with
   physical bounds (`initial_bounds_survive_a_screen_with_no_physical_size`, and
   `logical_bounds_are_what_panicked`, which pins the upstream behaviour).

## Other caveats

- The executor used was the sibling ad4m checkout's build (0.13.1-staging.6, commit 6ce770c57), not
  WE's pin 27f7f91. On macOS it was a locally built executor of unrecorded version, so the macOS
  run says nothing about executor compatibility, only that the shell hosts the page and its IPC.
- The macOS build was done from a copy of `native/`, `crates/custody`, `dist/` and the two shared
  Tauri sources, not from a checkout of this branch.
- `@we/app-shell`'s `tests/moduleRegistry.test.ts` ("warns, in development, about an activity a
  module publishes but never declared") fails on this branch. That is unrelated to this spike,
  whose only app-shell change adds `'gpui'` to two type unions.
- The holochain log showed "Failed to bind IPv6 listener: AddrInUse", most likely from another
  conductor on the machine.

## Recommendation

**Do not adopt GPUI as WE's desktop shell now. Keep Tauri.**

What GPUI offers WE is native drawing, and WE does not draw natively: its UI is a web build by
design, because templates are data rendered by web components. As a host for that build, GPUI is a
worse Tauri:

- It uses the same WebKitGTK, so it gains nothing in the page.
- It loses native Wayland outright, where Tauri runs as a GTK Wayland client.
- It has an experimental webview seam that crashed the whole shell twice in a day's use.
- It has no bundler, signer or updater.
- It needs a newer compiler than WE pins, on macOS.

Size and memory come out roughly even, because the executor dominates both.

Where GPUI would earn its place is a **native companion surface**: a tray-style executor and
identity window that runs everywhere, including Wayland, without a webview. If that is wanted, the
next step is a narrow one:

1. Promote the launcher into a small `we-gpui` companion app: the supervisor, custody status and
   the account list, with accesskit roles.
2. Keep the main WE window in Tauri.
3. Give the companion the missing single-instance lock, PDEATHSIG-equivalents on macOS and Windows
   (a kqueue `EVFILT_PROC` watch in the executor, or a job object), and a packaging step.
4. Separately, and whatever is decided here, fix `AD4M_EXIT_WITH_PARENT` in ad4m, or stop the
   Electron shell from relying on it.

## Running it

```sh
pnpm --filter '@we/app-gpui^...' run build        # workspace deps
pnpm --filter @we/app-gpui build                  # dist/ and the identity bundle
cd apps/we-gpui/native && cargo build --release
WE_GPUI_DIST=../dist WE_AD4M_EXECUTOR=/path/to/ad4m-executor ./target/release/we-gpui
# --launcher: only the native window. WE_GPUI_WINDOWING=wayland implies it.
```

On a Wayland desktop it runs through XWayland by default. On macOS, build with `cargo +1.98.0`.
`RUST_LOG=we_gpui=debug` logs each IPC call the page makes, by name and outcome only. Screenshots referenced above were taken to
`/tmp/we-gpui-shots/` from throwaway data dirs and are not committed.
