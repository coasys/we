# The Coasys app (web entry)

The Coasys cartridge (`seeds/coasys.seed.json`) as a web page. It is what a browser opens, and what the
phone app (`apps/we-mobile`) ships inside its WebView.

It boots with **no backend**. Before anything is connected it draws the cartridge's `base` template
(`packages/templates/cartridges/src/coasys/base.ts`) against `baseStore` alone:

- the first run, with three doors: make an identity, link this device to one, bring one back from
  the 12 words;
- a phone joining an identity;
- where to connect;
- offline, with "Try again";
- the identity's devices and security, read only.

When a place is chosen, `BaseBoot` (`@we/app-shell/solid`) mounts WE's `App` in the same page with
the connector for that place. No step of the base takes a secret. Each one opens the host's own
identity window. The design is in "Before a session" in `docs/architecture/apps-as-data.md`.

A guest link skips the base and boots the guest connector, as `apps/we-web` does.

## Hosts

`src/hosts/` holds one `BaseHost` per kind of device:

| File         | Host                                   | Identity                     | Places                                                       |
| ------------ | -------------------------------------- | ---------------------------- | ------------------------------------------------------------ |
| `web.ts`     | A browser                              | none                         | AD4M Connect                                                 |
| `phone.ts`   | The phone app's WebView                | the `DeviceKey` plugin       | the executor the phone's key logs in to, AD4M Connect        |
| `desktop.ts` | Electron and Tauri (their own entries) | the custody service          | this computer (the account's servers: listed, not wired yet) |
| `choose.ts`  | Picks the phone's or the browser's     | the plugin answering decides |                                                              |

`desktop.ts` is exported (`@we/app-coasys/hosts/desktop`) for `apps/we-electron` and `apps/we-tauri`,
which render `BaseBoot` from their own entries. `bridgedExecutor` reads Electron's executor state over
its preload bridge, so the window shows "starting" or a failure with "Try again" while the executor is
not up.

**The desktop's remote servers are not wired yet** (they come with coasys/we#428). A server the account
was given is listed as a place, but the only connector a desktop has reaches this computer's executor
with this computer's own admin credential, so choosing a server refuses (`ServerNotConnectable`) with
words saying so rather than connecting anywhere, and the shell's record of who serves the account is
left as it was.

## Commands

```bash
pnpm build:coasys                       # this app and everything it needs, from the repository root
pnpm dev:coasys                         # the dev server, on port 3004
pnpm --filter @we/app-coasys test       # the hosts' tests (node, over fakes)
pnpm --filter @we/app-coasys typecheck
pnpm --filter @we/app-coasys acceptance # the built page in Chrome, with no executor (after build:coasys)
```

The acceptance test (`acceptance/base.acceptance.mjs`) serves `dist/` and acts as a person does:
the phone's first run and its three doors, "Link to another device" leaving for the phone's identity
page, "Skip for now" → where to connect → the hand-off, and offline → "Try again" → back online; then the
browser's connection choice → the hand-off. The phone's native `DeviceKey` plugin is the one stand-in.
`WE_CHROME` names the Chrome to run (`/usr/bin/google-chrome` by default), and `WE_COASYS_SHOTS=<dir>`
keeps a screenshot after each step.

`scripts/seeded.mjs` runs each command for `seeds/coasys.seed.json` unless `WE_SEED` names another
seed. A seed other than the default writes its registries to `packages/app-shell/.seed-build/<name>/`,
so this build never overwrites the registries `apps/we-web` is built from.
