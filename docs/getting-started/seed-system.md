# The Seed System

Every WE deployment starts from a **seed file** — `we-seed.json` at the
workspace root. It declares what this deployment _is_: project metadata, which
feature modules ship, which external apps are embedded, how the bundled AD4M
executor is wired, and the shared spaces a fresh install is offered.
White-labeling a deployment is a matter of swapping the seed.

> **Source of truth:** the seed's shape is
> [`packages/app-shell/src/types/seed.ts`](../../packages/app-shell/src/types/seed.ts)
> (`WeSeedFile`), which is thoroughly commented. This page is the guided tour;
> when they disagree, the type wins — and please fix this page in the same PR.

## Validating

```bash
pnpm validate:seed        # validates ./we-seed.json against the schema
```

Run it after any seed edit; `setup-workspace` also depends on a valid seed.

## The sections

### `project` (required)

Name, version, description, author — plus optional `repository` and `license`.
Pure metadata.

### `modules`

The feature modules this deployment ships, by id — e.g.
`["globe", "graph", "notes", "call", "transcribe"]`. Declaring what the
deployment includes is what a seed is _for_; ids are matched against the
bundled module set at boot, and an unknown id is reported rather than silently
ignored. (Per-agent and per-space choices layer on top:
`AgentSettings.installedModules` and `Space.enabledModules`.)

**The order is load-bearing.** Modules register in the order listed here, and
the chrome rail renders their launchers in registration order — so this list is
also the top-to-bottom order of the rail. Reordering it for tidiness rearranges
the interface. The rail sorts rather than reshuffling on load order, so the
result is stable; it is simply this list's order.

### `features`

Experimental flags the running app reads. Currently `useQueryIR` — route
template queries through the neutral QueryIR before they reach the backend.
Safe to flip in dev (the seed is a watched import); a production build bakes
the seed in.

### `host`

Optional shell white-labeling: `host.theme` (color/font overrides) and
`host.ui.bootScreen` (a schema node replacing the default boot screen).

### `ad4m`

How the bundled executor is set up:

- `dataPath` — where the executor keeps the agent's keys and data. Defaults to
  `~/.ad4m` (shared with Flux and the ADAM launcher). **Changing it is a data
  migration, not a preference** — an existing agent does not follow the path.
- `executorPath` — the bundled `ad4m-executor` binary (required;
  `setup-workspace` and `validate-seed` fail without it).
- `repoPath` — an ad4m source checkout, needed by the Tauri build only.
- `ai`, `perspectives`, `languages`, `executor` — optional executor-side setup.

### `globalSpaceUrl` / `marketplaceUrl`

Neighbourhood URLs for the deployment's global discovery space and module
marketplace. When set, a fresh install is prompted to join the global space,
and a marketplace icon appears in the sidebar.

### `electron`

Desktop packaging knobs: `appDistPath`, and `basePort` for the local HTTP
servers that serve embedded app bundles.

### `apps` (required, may be empty)

External applications embedded in the shell sidebar. Each entry carries:

- `id`, `name`, `icon` (Phosphor name), optional `image` / `description`
- `capabilities` — the AD4M permissions the app needs
  (`perspectives` | `languages` | `agents` | `filesystem` | `network`)
- `commands` — `install` (required), `build`, `dev`
- `paths` — `projectRoot`, `dist`, optional `devServer` (`port`, `host`) and
  `webUrl` (used on the web platform)

How an embedded app receives its AD4M credentials at runtime is documented in
[`docs/guides/embedding-external-apps.md`](../guides/embedding-external-apps.md).

## Examples

`seed-examples/` holds starting points:

- `we-native.seed.json` — WE standalone, no embedded apps
- `we-with-apps.seed.json` — WE with an embedded external app (Flux)

Copy one to the workspace root as `we-seed.json`, adjust paths, and run
`pnpm validate:seed`.
