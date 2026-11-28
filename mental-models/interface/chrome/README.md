# Chrome

The **chrome** is the app furniture around a template that stays across spaces: the **sidebar** on the left (80px, spaces, profile, settings), the **module rail** on the right (56px, module launchers and pickers), the call bar, and the editor's editing bar. The **app template** (`meta.role: 'app'`) places the sidebar and the module rail as **host parts**.

**Why:** The app template is data, so an agent can choose another app, or a bundle can bring one, and the host still draws the pieces. The geometry does not assume a sidebar: the app declares how much of each edge its chrome holds in `meta.frame`, and every measurement uses that frame (`dockGeometry.ts`).

**Parent:** [Interface](../README.md)

## Parts

- [Panels](panels.md): docks, lanes, seats, the four panel states, and who moves for whom.
- [Routing](routing.md): the four tiers of UI state, who owns which part of the path, and relative paths.
- [Boards](boards.md): a board as columns that are saved queries with an arrangement.
- [Protected pieces](protected-pieces.md): the password field, the safety prompts and safe mode.

<details><summary>How it works</summary>

1. WE's own app is `WeApp.schema.ts`, with `meta.frame: { left: 80, right: 56 }`. It places `{ type: '$part', props: { id: 'host.sidebar' } }` and `host.rail`.
2. `HOST_PART_IDS` lists the four host parts: `host.sidebar`, `host.rail`, `host.signIn.form` and `host.signIn.accounts`. `HOST_PARTS` maps the sidebar and the rail to their slots (`core:sidebar`, `core:chromeRail`), and the two sign-in parts to nodes. The sign-in form takes the inputs `unlockLabel` and `passwordLabel`. Only an app template places host parts.
3. The app in use is `AgentSettings.appTemplateId`, else the deployment's app, else `we-app` (`resolveAppTemplate`). In safe mode the app is always `we-app` ([Protected pieces](protected-pieces.md)).
4. `declareAppFrame` and `declareAppEdges` hold the app's `meta.frame` and `meta.edges`. The **content region** is the window minus the frame and minus each panel that displaces. Its edges are published as `--we-chrome-left`, `-right`, `-top` and `-bottom`.
5. **Layouts.** `TemplateLayout` holds the main router, which renders the space template. The shell overlay (profile, settings, the landing page) renders in a `MemoryRouter` with its own route store ([Routing](routing.md)). `PersistentAppFrames` keeps embedded app frames mounted outside the keyed router.
6. Settings, the boot screen and the sidebar are schemas from `@we/template-shell`. The editor inspector is code, because it must work while the schema that it edits is broken (`design-system/CONVENTIONS.md`).

Module chrome (`panels`, `slots`, `launchers`, `reserve`): [Contributions](../../modules/contract/contributions.md).

</details>

<details><summary>Where in the code</summary>

- [WeApp.schema.ts](../../../packages/templates/shell/src/WeApp.schema.ts), [Sidebar.schema.ts](../../../packages/templates/shell/src/Sidebar.schema.ts), [ChromeRail.schema.ts](../../../packages/templates/shell/src/ChromeRail.schema.ts).
- [hostPartIds.ts](../../../packages/schema-system/shared/src/hostPartIds.ts), [hostParts.ts](../../../packages/app-shell/src/shared/registries/hostParts.ts), [appFrame.ts](../../../packages/app-shell/src/shared/registries/appFrame.ts), [appTemplates.ts](../../../packages/app-shell/src/shared/registries/appTemplates.ts).
- [dockGeometry.ts](../../../packages/app-shell/src/shared/dockGeometry.ts): `AppFrame`, `DEFAULT_APP_FRAME`, `SIDEBAR_PX`, `CHROME_RAIL_PX`.
- [packages/app-shell/src/frameworks/solid/layouts/](../../../packages/app-shell/src/frameworks/solid/layouts): `TemplateLayout`, `PersistentAppFrames`.
- [docs/architecture/chrome-and-panels.md](../../../docs/architecture/chrome-and-panels.md): chrome and panels in depth.

</details>
