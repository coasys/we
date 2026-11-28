# Views

A **view** is a template with `meta.role: 'view'` that renders one section of a space, at one URL segment (`meta.segment`). A shell marks where its sections go with a `$views` route. The host expands that marker into one route per view. Which sections a space shows comes from three lists: the seed's `views` (the deployment), `Space.enabledViews` (the community) and `SpacePreference.hiddenViews` (each agent).

**Why:** The route table holds a route for every view that can render here, and a gate in each route body asks if the space offers that section. A section that is switched on or off then changes only what renders, and the router is not rebuilt (`viewResolution.ts`). Segments are assigned over all available views in a stable order, so a shared link keeps its address when the community changes its sections.

**Parent:** [Templates](README.md)

<details><summary>How it works</summary>

1. The seed's `views` list selects the views that the build includes (now `about`, `cards`, `graph`, `globe`, `boards`, `calendar`). `generate-views` writes `bundledViews.generated.ts` from it and from the `CATALOGUE` in `generateViewRegistry.mjs`.
2. `routableSections` gives a `ResolvedView` (id, segment, schema) for each available view.
3. `expandViewRoutes(routes, views, gate)` replaces each `$views` marker, also inside nested `routes`, with:
   - one route per view at `/<segment>`. Its body is a node operator `$if`: the view while its id is in `gate.activeIds`, else `gate.notInSpace`;
   - the `gate.extraRoutes`, for example the record page;
   - an index route at `/` that names no section;
   - a catch-all `/*` that draws `gate.notHere`, only if the shell has no catch-all at that level.
4. When a space is open, the host redirects its bare address to its first section.
5. `activeSections` reads the community's list with `resolveEnabledViews`, then removes the agent's hidden views. An unset list means "not decided", not "none", and the seed's order applies. The stored order is the navigation order. An id that this build does not have is left out of the resolved list but kept in the stored list.
6. A shell reads `spaceStore.viewNav` for its navigation, which is the same resolved list.
7. Each view root gets `data-we-view` and `data-we-view-name`, so the editor can find the boundary of a view.

The `Space` and `SpacePreference` records: [Data](../../data/README.md).

</details>

<details><summary>Where in the code</summary>

- [viewRoutes.ts](../../../packages/schema-system/shared/src/viewRoutes.ts): `VIEWS_MARKER`, `SPACE_ROUTE_PATH`, `ResolvedView`, `ViewGate`, `expandViewRoutes`, `hasViewsMarker`.
- [viewResolution.ts](../../../packages/app-shell/src/shared/viewResolution.ts): `resolveEnabledViews`, `preserveUnknownViews`, `parseIdList`, `routableSections`, `activeSections`, `viewSettings`.
- [packages/templates/views/src/views/](../../../packages/templates/views/src/views): `AboutView`, `BoardsView`, `CalendarView`, `CardsView`, `FluxView`, `GlobeView`, `GraphView`, `RecordPage`.
- [viewRegistry.ts](../../../packages/app-shell/src/shared/registries/viewRegistry.ts), [packages/app-shell/scripts/generateViewRegistry.mjs](../../../packages/app-shell/scripts/generateViewRegistry.mjs).
- [docs/architecture/views.md](../../../docs/architecture/views.md): views in depth.

</details>
