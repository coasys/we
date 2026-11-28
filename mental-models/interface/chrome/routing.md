# Routing

**Routing** decides where each piece of UI state lives. There are four tiers: the location (the path), the view state (query parameters), the preferences (device or agent settings) and the ephemeral state (`$localState`). The host owns `/space/:spaceId`, and the template owns all of the path below it.

**Why:** The test for a field is "if I send this URL to a person, must they see the effect?". If yes, the state goes in the address, so a link shows the same thing to the person who gets it. If no, the state stays out of the address, so a link does not set the preferences of the person who gets it (`routing-and-view-state.md`).

**Parent:** [Chrome](README.md)

<details><summary>How it works</summary>

| Tier | Where | Example |
|---|---|---|
| Location | the path | a section, `/record/:entity?id=…` |
| View state | query parameters, through `syncParam` on a `$localState` field | sort, filter, search text |
| Preferences | `persist` (device) or `AgentSettings` (agent) | density, a lane width |
| Ephemeral | plain `$localState` | an open modal, a drag |

1. A `syncParam` field mirrors its value to a query parameter. The URL value comes first on mount, then the stored value, then `initial`. A value equal to `initial` removes its parameter ([Handler tokens](../schema/handlers.md)).
2. A record id is a URI with `:` and `/` in it, so it goes in the query (`?id=`), never in the path. `routeStore.navigate(to, { query })` writes it, and a template reads `routeStore.params.id`.
3. `resolvePath` resolves each path that a template writes. `.` and `..` are relative to the route of the node. `~/` is the template's root. An absolute path leaves the template. `..` stops at the root.
4. The renderer gives `navigate` the depth of the node's route (`$nav`), so the router resolves a relative path against its own address.
5. A template reads its positions from `routeStore.templateSegments`, which is relative to the template's root.
6. `canonicalSpaceId` gives one address for each space: the shared id if there is one, else the local id.
7. The shell overlay (profile, settings, the landing page) runs in a `MemoryRouter` and does not change the browser URL. So a template's route table cannot declare a settings path, and settings render the same with any template.
8. A link can carry `?template=` and `?theme=`. `TemplateProvider` applies an available one, and shows a warning toast for one that the agent does not have.

</details>

<details><summary>Where in the code</summary>

- [navigationPaths.ts](../../../packages/schema-system/shared/src/navigationPaths.ts): `resolvePath`.
- [RouteStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/RouteStore.tsx), [ShellRouteStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/ShellRouteStore.tsx): `navigate`, `setParam`, `params`, `templateSegments`.
- [TemplateLayout.tsx](../../../packages/app-shell/src/frameworks/solid/layouts/TemplateLayout.tsx): the main router and the shell overlay's `MemoryRouter`.
- [datasetIdentity.ts](../../../packages/app-shell/src/shared/datasetIdentity.ts): `canonicalSpaceId`.
- [viewRoutes.ts](../../../packages/schema-system/shared/src/viewRoutes.ts): `SPACE_ROUTE_PATH`.
- [docs/architecture/routing-and-view-state.md](../../../docs/architecture/routing-and-view-state.md).

</details>
