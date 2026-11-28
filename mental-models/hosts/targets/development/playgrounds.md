# Playgrounds

A playground is a small Vite app that runs one part of WE's stack in a browser, with no AD4M. Each one has its own package under `apps/playgrounds/`, and its `build` is `we-build`.

**Why:** The render bench measures the renderer and the design system in a real browser, including paint, and the published figures come from its production build (its `README.md`). The portable UI slice shows that WE's renderer and design system draw over a backend that is not AD4M: it picks a data source, a registry and a template, as a `mountWe(...)` integration does (its `README.md`).

**Parent:** [Development hosts](README.md)

<details><summary>How it works</summary>

| Playground | Package | What it runs |
|---|---|---|
| `solid/graph-explorer` | `@we/playground-graph-explorer` | the graph engine, its expanders and layouts over an in-memory dataset |
| `solid/portable-ui-slice` | `@we/playground-portable-slice` | the renderer and the design system over an in-memory backend (port 3200) |
| `solid/render-bench` | `@we/playground-render-bench` | the cost of the renderer and the design system against raw DOM and plain Solid controls (port 3300; `bench` for timings) |
| `vanilla/flicker-probe` | `@we/playground-flicker-probe` | the same buttons through the design system and through bare CSS, with the painted colour sampled each frame (port 3310) |

</details>

<details><summary>Where in the code</summary>

- [solid/graph-explorer/](../../../../apps/playgrounds/solid/graph-explorer/).
- [solid/portable-ui-slice/](../../../../apps/playgrounds/solid/portable-ui-slice/) and its [README.md](../../../../apps/playgrounds/solid/portable-ui-slice/README.md).
- [solid/render-bench/](../../../../apps/playgrounds/solid/render-bench/) and its [README.md](../../../../apps/playgrounds/solid/render-bench/README.md).
- [vanilla/flicker-probe/](../../../../apps/playgrounds/vanilla/flicker-probe/) and its [README.md](../../../../apps/playgrounds/vanilla/flicker-probe/README.md).
- Depth: [docs/architecture/performance.md](../../../../docs/architecture/performance.md).

</details>
