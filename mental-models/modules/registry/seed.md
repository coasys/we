# Seed

A **seed** is the JSON file that describes one deployment: which modules, templates, views, bundles, elements and embedded apps it builds in, its deployment-level settings, and its host settings. `we-seed.json` is WE's own seed. A different seed is chosen at build time with `WE_SEED`.

**Why:** The seed is the list of modules, and the module registry is generated from it, so adding a module is one seed entry and not edits to several files in step. A module that the seed does not name is never imported, so it leaves the bundle, not only the rail (`generateModuleRegistry.mjs` header).

**Parent:** [Module registry](README.md)

<details><summary>How it works</summary>

A `modules` entry is an id (`"call"`) or a `WeSeedModule` `{ id, package?, enabled? }`:

- `package` names the package that exports `createModule`. The default is `@we/module-<id>`. A module from outside this repository is a dependency of `@we/app-shell`, named here, and the deployment rebuilds.
- `enabled: false` ships the module, but a space that has not decided has it off. In `we-seed.json`, `polls` is the one module with `enabled: false`.

```
we-seed.json (or WE_SEED)  ── scripts/seed.cjs readSeed()
      │
      ▼  generate-modules  (generateModuleRegistry.mjs, part of the app shell's build:steps)
bundledModules.generated.ts   import { createModule as module_<id> } from '<package>'
                              bundledModules = { <id>: module_<id>, … }   (seed order = rail order)
```

The generator refuses an entry without a valid id, an id named twice, and a package that is not installed for `@we/app-shell`. `pnpm validate:seed` (`scripts/validate-seed.cjs`) checks the same entries, and warns where the build would fail.

The default seed's generated files are checked in. `scripts/seed.cjs` writes the generated files for any other seed into `.seed-build/<name>/` beside the package, and `scripts/seed-vite.mjs` points the apps at them.

At run time, `initializeIntegrations` gives the parsed seed to `provideSeed`, and `seedModuleIds(seed)` gives the ids to `activateSeedModules`. An id that the build does not contain is reported as missing. The seed's top-level `settings` is the `deployment` level of [module settings](../contract/settings.md).

`seed-examples/` has two starting seeds (`we-native`, `we-with-apps`), and `seeds/` has other deployments' seeds. `packages/app-shell/src/seed/` is the `we-seed` command line tool: `validateSeed`, `loadSeed`, and `SeedProcessor`, which generates integration code for a seed's embedded apps.

</details>

<details><summary>Where in the code</summary>

- [we-seed.json](../../../we-seed.json): WE's own seed.
- [packages/app-shell/src/types/seed.ts](../../../packages/app-shell/src/types/seed.ts): `WeSeedFile`, `WeSeedModule`, `WeSeedElements`.
- [packages/app-shell/scripts/generateModuleRegistry.mjs](../../../packages/app-shell/scripts/generateModuleRegistry.mjs): the generator.
- [packages/app-shell/src/shared/registries/bundledModules.generated.ts](../../../packages/app-shell/src/shared/registries/bundledModules.generated.ts): its output.
- [packages/app-shell/src/shared/seedModules.ts](../../../packages/app-shell/src/shared/seedModules.ts): `seedModuleEntry`, `seedModuleIds`, `seedDefaultEnabledModules`.
- [scripts/seed.cjs](../../../scripts/seed.cjs), [scripts/validate-seed.cjs](../../../scripts/validate-seed.cjs), [scripts/seed-vite.mjs](../../../scripts/seed-vite.mjs): which seed, its checks, and the build's view of it.
- [packages/app-shell/src/seed/](../../../packages/app-shell/src/seed): the `we-seed` tool and its [README](../../../packages/app-shell/src/seed/README.md).
- [seed-examples/](../../../seed-examples), [seeds/](../../../seeds): other seeds.
- [docs/getting-started/seed-system.md](../../../docs/getting-started/seed-system.md): the seed system guide.
- [scripts/create-module.mjs](../../../scripts/create-module.mjs): `pnpm create-module`, which scaffolds a module package.

</details>
