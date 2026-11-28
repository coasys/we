# Preview host

The preview host (`@we/app-preview`) runs the app shell over `@we/backend-inmemory`, loaded with one fixture from `@we/template-fixtures`. URL parameters choose the fixture, a template, a route and a bare mode. When the page is drawn, the host writes the result on `window.__wePreview`, which [`we-render`](cli.md) waits for.

**Why:** This host exists to be photographed, so a production build must behave the same as the dev server. For that reason `previewPlatform.isDevelopment` is always `false` and not `import.meta.env.DEV` (`previewPlatform.ts`). A fixture or template from a URL must be same-origin, so a link cannot make the host load content from another site (`loadSameOrigin` in `src/index.tsx`).

**Parent:** [Development hosts](README.md)

<details><summary>How it works</summary>

1. `?fixture=<id>` picks a bundled fixture, and the default is the first one. `?fixtureUrl=` loads a fixture from the same origin.
2. `?templateUrl=` loads a template from the same origin, for example the one that `we-render` serves. If it does not load, the host stops and writes the reason on `__wePreview`, and does not draw the fixture's own template.
3. `?route=` overrides the start route. `?bare=1` with a template draws only that template's node for the route (`bareNode` in `bare.ts`), without the shell.
4. Else it renders `PlatformProvider` with `previewPlatform` and `inMemoryConnector`, then `StoreProvider`, `PreviewBootstrap`, `TemplateProvider` and the toasts. `PreviewBootstrap` selects the fixture's space and navigates to its route after the boot.
5. `previewPlatform` has no `accounts` and no `executor`, which is the same shape as the web target.

Port 3100 in development.

</details>

<details><summary>Where in the code</summary>

- [src/index.tsx](../../../../apps/we-preview/src/index.tsx): parameters, `loadSameOrigin`, `__wePreview`; [src/PreviewBootstrap.tsx](../../../../apps/we-preview/src/PreviewBootstrap.tsx); [src/bare.ts](../../../../apps/we-preview/src/bare.ts): `bareNode`.
- [src/platform/](../../../../apps/we-preview/src/platform/): `previewPlatform`, `inMemoryConnector`.
- [scripts/](../../../../apps/we-preview/scripts/): `shoot.mjs` (photograph fixtures), `measure.mjs` (measure a reference screenshot).
- [packages/templates/fixtures/](../../../../packages/templates/fixtures/): `@we/template-fixtures`; the templates themselves: [Interface](../../../interface/README.md).

</details>
