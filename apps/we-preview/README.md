# we-preview — WE with nothing behind it

The fourth host, beside `we-web` / `we-electron` / `we-tauri`. It runs **the whole application** —
the same `<App/>`, the same thirteen stores, the same renderer, the same design system — over
`@we/backend-inmemory` instead of an AD4M executor.

```sh
pnpm --filter @we/app-preview dev      # http://localhost:3100
pnpm --filter @we/app-preview build
```

No executor, no agent setup, no neighbourhood, no network. It boots in a headless browser in a
couple of seconds, which is what makes a render → screenshot → adjust loop possible at all.

## What it is not

It is **not** a stripped-down template preview. The shell is itself templates — `Sidebar`,
`Settings`, `Profile`, `BootScreen`, `TemplateEditor`, `ModuleRail`, the marketplace and spaces
surfaces all live in `@we/template-shell` — so all of it renders here, and you can click around.
The only difference from `we-web` is which `BackendConnector` `PlatformProvider` receives.

That property is the point. A harness with stubbed stores would drift from the real ones, and every
screenshot would then be of a fiction — templates matched against behaviour the application does not
have. Here the stores are the real stores.

## Why it is a separate app rather than a flag on we-web

Apps *are* deployments in this monorepo, which is what the seed file expresses. A preview
deployment wants modules off and no `ad4m` block, and it must not drag `@we/backend-inmemory` or
fixture data into the production web bundle — which a runtime `?backend=inmemory` flag would, unless
fought. The cost of the split is one 25-line entry and a platform adapter.

## The seed is derived, not declared

There is deliberately no `we-preview.seed.json`. `templates` is not read at runtime:
`pnpm --filter @we/app-shell generate-templates` compiles the **root** seed's list into
`bundledTemplates.generated.ts`, one registry for the whole monorepo. A second seed naming a
different set would declare templates this build cannot import. So `src/index.tsx` spreads the root
seed and overrides only what this host genuinely differs on — `modules: []`, `apps: []`, no `ad4m`.

Set `modules` back to the root list to photograph module chrome. It is off by default because the
globe mounts Cesium and the call module wants media devices: neither survives a headless screenshot
usefully, and a spinning globe makes every render of the same template differ from the last.

## What it cannot show truthfully

Worth knowing before pointing it at shell design work rather than at templates:

- **Backend-specific settings surfaces render degraded.** `createInMemoryBackendPorts` omits the
  optional `runtime` port and this host omits `AccountHost`, so RuntimeSettings, LanguageSettings,
  HostSettings and AccountSettings show their capability-gated empty states. Both omissions are
  supported states, feature-detected member by member — the same shape the web host has.
- **Join and publish are simulated** against `inmemory://` URIs. Useful rather than limiting: those
  flows become screenshottable.
- **The agent starts unlocked.** A locked agent is the port's honest default and what the
  executor-free boot suite exercises, but here it would put a password prompt in front of every
  screenshot.

## Typecheck

```sh
pnpm --filter @we/app-preview typecheck
```

Clean, and it typechecks the shell's source along with its own — which `we-web` cannot do, because
its tsconfig lacks the `@shared` / `@solid` path aliases that exist only in Vite (audit P3-1). If
you are copying this app as a starting point, copy its `tsconfig.json` too.
