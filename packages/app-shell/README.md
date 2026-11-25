# @we/app-shell

The application shell every WE host runs: stores, registries, layouts, the boot
sequence, and the built-in template schemas. The apps (`@we/app-web`,
`@we/app-electron`, `@we/app-tauri`) are thin hosts over this package — each
supplies a `PlatformAdapter` (where am I running) and a `BackendConnector`
(how do I reach the data layer) and mounts the shell.

## The two ports a host supplies

**`PlatformAdapter`** (`src/shared/platform/types.ts`) — what the host machine
can do:

```typescript
interface PlatformAdapter {
  resolveAppUrl(app: AppConfig, isDevelopment: boolean): string;
  isDesktop: boolean;
  isDevelopment: boolean;
  platform: 'web' | 'electron' | 'tauri';
  accounts?: AccountHost; // local account registry (absent on web)
  executor?: ExecutorHost; // executor settings/restart (absent on web)
}
```

Desktop hosts build theirs with `createDesktopPlatform(options)` from
`@we/app-shell/shared`, supplying only the transport (Electron's IPC bridge or
Tauri's command surface).

**`BackendConnector`** (`src/shared/backend/types.ts`) — the backend's entire
connection choreography:

```typescript
interface BackendConnector {
  initialize(ctx: BackendPortsContext): Promise<BackendInitResult>;
}
// BackendInitResult: { client, ports: BackendPorts, connection?, host?, account?, disconnect? }
```

Desktop hosts use `createLocalAd4mConnector(getConnection)` from
`@we/backend-ad4m`; the web host connects through ad4m-connect. The `ports`
bundle is the backend contract declared in `@we/backend-shared` — the shell
never imports `@coasys/*` itself.

## Stores

`src/shared/stores/` — one store per concern, each a `createXStore(deps)` factory
written against the reactivity port (`@we/reactivity`), so none of them imports
Solid. `providers/BootController.tsx` composes them once, passing each the port
and the stores it reads as arguments (the order is the dependency graph: a store
may read the stores built before it):

Route → Clock → Shell → Chat → Account → Session → Runtime → Identity → Device →
Dataset → Shape → Record → Profile → Theme → Template → Editor → App → Space →
Presence → Interpretation → Workflow → Bundle.

The three largest are split by job and composed back into one store each:
`SpaceStore.ts` from the parts in `stores/space/` (spaces, navigation, roles,
modules and views, extraction, task states, involvements, unread, content, the
space's own record), `ShellStore.ts` from `stores/shell/` (overlays, prompts,
arrangement, docks, dragging, template panels) and `RecordStore.ts` from
`stores/records/` (kinds, connections, canvas, tree, forms, drops). A template
still reads one namespace per store.

Components reach them through one typed hook, `useStore('spaceStore')`, keyed by
the same names templates use (`StoreRegistry`, `shared/stores/storeRegistry.ts`).
`src/frameworks/solid/stores/` is only Solid's binding: that hook, Solid's live
template document, and the app's host state made over Solid's port.

The store surface a schema can reach through expressions and `$invoke` is documented in
the generated reference (`CLAUDE.md`, "Stores" section) and kept honest by
`@we/ai-context`'s extractor. The names to know: `sessionStore` (boot, agent
identity — `sessionStore.me`), `datasetStore` (datasets,
`currentDataset`, `rootDataset`), `spaceStore` (spaces, members, modules,
posts), `templateStore` / `themeStore` (what renders and how it looks),
`editorStore` (the editing surface + AI loop), `presenceStore`, `runtimeStore`
(backend administration), `accountStore` (local accounts on desktop).

## Directory map

```
src/
  frameworks/solid/     The Solid app: App.tsx, stores/, providers/, layouts/,
                        components/ (incl. GraphHost), registries/ (component,
                        template, theme, module), services/, dsInterop.ts
  shared/               Framework-neutral: platform/ (adapter types + desktop
                        factory), backend/ (connector types), registries/,
                        schemas/ (built-in shell template schemas), ai/
                        (AI infra used by the editor loop), seedRegistry,
                        tabCoordinator, integration loading
  seed/                 Seed-file loading & validation (exported as ./seed)
  types/                Seed & app config types (types/seed.ts is the seed
                        file's source of truth)
```

## Exports

| Entry                  | What it is                                             |
| ---------------------- | ------------------------------------------------------ |
| `@we/app-shell/solid`  | The Solid app entry — what a host mounts               |
| `@we/app-shell/shared` | Platform/backend contracts, desktop factory, utilities |
| `@we/app-shell/seed`   | Seed loading/validation                                |

Importing the Solid entry pulls in the design system (tokens, themes,
primitives, components, widgets) and the token CSS + hosted webfonts.

## Used by

`apps/we-web` (`@we/app-web`), `apps/we-electron` (`@we/app-electron`),
`apps/we-tauri` (`@we/app-tauri`). Embedding hosted apps is documented in
`docs/guides/embedding-external-apps.md`.

## Working here

- Conventions: see `CONVENTIONS.md` in this package.
- Tests: `pnpm --filter @we/app-shell test` — the boot suite runs against
  `@we/backend-inmemory`'s ports, no executor needed.
- Schema validation: `pnpm --filter @we/schema-shared validate` covers the
  built-in schemas under `src/shared/schemas/`.
