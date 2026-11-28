# Identity window

The **identity window** (`@we/identity-window`) is a separate desktop window and the only page that runs a change to the identity. It draws the custody service's screens and sends back what the person types. Each desktop host gives it an `IdentityTransport` and nothing more. The Tauri app and the Electron app use the same package.

**Why:** The window uses plain DOM with `textContent` only, with no template engine and no `innerHTML`. So its Content-Security-Policy can forbid every script except its own, and every string sink (`window.ts`, `csp.txt`). The main window opens the window for one step, and the window cannot choose a different step (`IdentityTransport`).

**Parent:** [Identity](README.md)

<details><summary>How it works</summary>

1. The main window calls `custody.open(change)` (Electron IPC `identity-open`, Tauri `identity_open`). The host opens the window for that step.
2. `runIdentityWindow(transport)` calls `transport.start()` and draws the first `Screen`. Each answer goes back with `transport.step(input)`. The window clears its fields when the call returns.
3. `screens.ts` holds the words that each screen says (`heading`), the time left on a device offer (`remaining`), the word numbers (`wordNumber`) and the last screen of a step (`isLast`). Tests check them without a window.
4. `transport.finish()` closes the window after the last screen. `transport.cancel()` ends the step and closes it. When the window closes before the step ends, the host cancels the step.
5. The main window hears only how the step ended (`done`, `cancelled` or `failed`), then reads the identity again.

Electron loads the window from the `we-identity://` scheme in its own session partition. Tauri gives the window its own capability file, so the window may call only the `identity_flow_*` commands.

</details>

<details><summary>Where in the code</summary>

- [src/window.ts](../../../packages/identity-window/src/window.ts): `runIdentityWindow`, `IdentityTransport`; [src/screens.ts](../../../packages/identity-window/src/screens.ts): `Screen`, `StepInput`, `heading`; [csp.txt](../../../packages/identity-window/csp.txt); [vite.js](../../../packages/identity-window/vite.js): `IDENTITY_CSP` and the theme module.
- Electron: [identityWindow.js](../../../apps/we-electron/electron/identityWindow.js), [identityPreload.js](../../../apps/we-electron/electron/identityPreload.js), [identity/main.ts](../../../apps/we-electron/identity/main.ts).
- Tauri: [commands/identity.rs](../../../apps/we-tauri/src-tauri/src/commands/identity.rs), [capabilities/identity.json](../../../apps/we-tauri/src-tauri/capabilities/identity.json), [identity/main.ts](../../../apps/we-tauri/identity/main.ts), [src/platform/identityHost.ts](../../../apps/we-tauri/src/platform/identityHost.ts).

</details>
