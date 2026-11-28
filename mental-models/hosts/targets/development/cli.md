# CLI

`@we/cli` gives three commands. `we-build` is the `build` script of the WE packages: it prints a banner, runs the package's `build:steps` and prints how long they took. `we-banner` prints only the banner. `we-render` draws a template JSON to a PNG or SVG file through the [preview host](preview.md) in Chrome.

**Why:** `src/render.ts` holds the parts of `we-render` that make decisions, apart from the server, the browser and the file system, so tests can check them without those. A value that does not parse is refused and not passed on, because a default used in silence gives an image that looks right and is not the one asked for (`parseRenderArgs`).

**Parent:** [Development hosts](README.md)

<details><summary>How it works</summary>

1. `we-render <template.json>` reads its options with `parseRenderArgs`: `--output`, `--fixture` (discord, twitter, instagram, youtube, kanban, events), `--fixture-file`, `--viewport` (default 1440x900), `--scale` (2), `--svg`, `--wait` (1500 ms), `--port`, `--bare`, `--route`, `--full-page`.
2. It serves `apps/we-preview/dist` on `127.0.0.1`, with the template at `/__cli_template__` and a fixture file at `/__cli_fixture__`. If the preview host is not built, it stops and says to run `pnpm --filter @we/app-preview build`.
3. It starts Chrome through `playwright-core` (`channel: 'chrome'`, an optional peer dependency) and opens the preview host with `templateUrl` and `fixtureUrl`.
4. It waits for `window.__wePreview`, then for `--wait`, and takes a screenshot. With `--svg` it wraps the page in an SVG `foreignObject`.

`tsup` builds `scripts/*.ts` to `dist/`. The package's own `build` runs `dist/we-build.js` if it exists, else `build:steps`.

</details>

<details><summary>Where in the code</summary>

- [scripts/](../../../../packages/cli/scripts/): `we-build.ts`, `we-banner.ts`, `we-render.ts`.
- [src/render.ts](../../../../packages/cli/src/render.ts): `RenderArgs`, `USAGE`, `parseRenderArgs`, `UsageError`; tested in [src/render.test.ts](../../../../packages/cli/src/render.test.ts).
- [src/banner.ts](../../../../packages/cli/src/banner.ts): `printBuildBanner`.

</details>
