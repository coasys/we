# Development hosts

The development hosts run WE's code outside the shipped targets. The preview host renders a template against fixture data. The playgrounds run one part of the stack alone. The CLI builds packages and photographs templates. The end-to-end package runs the app against a real executor in a real browser.

**Why:** The preview host and the playgrounds run over `@we/backend-inmemory` and need no executor, so a template or a part of the design system can be drawn and measured without an AD4M runtime. Only the end-to-end tests start an executor, because they test the contract with it.

**Parent:** [Targets](../README.md)

## Parts

- [Preview host](preview.md): `@we/app-preview`, the app shell over fixture data, made to be photographed.
- [Playgrounds](playgrounds.md): browser harnesses for one part of the stack each.
- [CLI](cli.md): `@we/cli`, with `we-build`, `we-banner` and `we-render`.
- [End-to-end tests](e2e.md): `@we/e2e`, the shared test host for live tests.

<details><summary>How it works</summary>

```
we-render (CLI) ─► serves apps/we-preview/dist ─► Chrome ─► PNG or SVG
preview host ─► PlatformProvider(previewPlatform, inMemoryConnector) ─► App shell ─► template over a fixture
playgrounds  ─► one part of the stack over an in-memory dataset
@we/e2e      ─► executor (fresh data, multi-user) + a built target under the production policy + Chrome
```

</details>

<details><summary>Where in the code</summary>

- [apps/we-preview/](../../../../apps/we-preview/), [apps/playgrounds/](../../../../apps/playgrounds/), [packages/cli/](../../../../packages/cli/), [packages/e2e/](../../../../packages/e2e/).
- [packages/backend-system/inmemory/](../../../../packages/backend-system/inmemory/): the in-memory backend under the preview host and the playgrounds.
- Depth: [docs/testing/e2e.md](../../../../docs/testing/e2e.md).

</details>
