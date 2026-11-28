# Bundles

A **bundle** is a whole app as one JSON file of format `we-bundle`. It can hold an app template, space templates and views, app pages, themes, record types, workflows, a display policy, a brand, a sign-in screen and space starters. A deployment builds bundles in through the seed's `bundles` list. A person can also install one from a file. A **cartridge** is the TypeScript source of a bundle that WE ships.

**Why:** A bundle cannot bring code. It names modules, and a module that the build does not have stays empty (`bundle.ts`). The install screen shows what a bundle needs and what it can do. These facts come from a walk of what the bundle's templates reach, not from a list in the file, because a list that an author writes is a claim (`judgeBundle.ts`).

**Parent:** [Templates](README.md)

<details><summary>How it works</summary>

1. `readBundle(input)` checks the format and `formatVersion` (1) first, then each piece, and returns the problems with their paths.
2. `bundlePieces` puts every id under the bundle id (`field-guide--species`), so a second install writes the same records, and no piece takes the id of a built-in or of the agent's own template.
3. `judgeBundle` gives the facts for the install screen. `consent` compares a later version with what the agent agreed to, and asks only about what is new.
4. The install writes the templates into the agent's library and records each piece in `AgentSettings.installedBundles`. If the bundle has an app, the app becomes the agent's app template.
5. `display.spaces` is `ours` (the bundle's space template renders every space) or `theirs` (each space keeps its own template). The policy belongs to the app in use, so it writes nothing to a space.
6. An app page (`meta.role: 'page'`) opens with `shellStore.openShellView('<bundle id>--<page id>')`.
7. `bootScreen` replaces WE's sign-in screen and must place `CredentialField` or the `host.signIn.form` part (`placesCredentialField`, [Protected pieces](../chrome/protected-pieces.md)). `deviceApp` keeps the last app of the device, so the sign-in screen can be that app's before sign-in.
8. `setUpForApp` sets a space up for an app: record types, workflows and sections, in that order.

**Cartridges.** `@we/template-cartridges` holds the cartridges `coasys`, `field-guide` and `tool-library`. `pnpm --filter @we/template-cartridges bundle` writes them to `bundles/<id>.bundle.json` at the repository root. `cartridges.test.ts` fails when a file differs from its cartridge. `generate-bundles` writes the bundles that the seed names into `seedBundles.generated.ts`. WE's own seed names one bundle, `coasys`.

A bundle's record types become [shapes](../../data/spaces/shapes.md) of the space (`ShapeStore.addRecordTypes`).

</details>

<details><summary>Where in the code</summary>

- [bundle.ts](../../../packages/schema-system/shared/src/bundle.ts): `Bundle`, `BUNDLE_FORMAT`, `readBundle`, `bundleThemes`, `BundleDisplay`, `BundleBrand`.
- [packages/app-shell/src/shared/bundles/](../../../packages/app-shell/src/shared/bundles): `judgeBundle`, `bundlePieces`, `consent`, `installedBundles`, `display`, `brand`, `bootSnapshot`, `deviceApp`, `bundleStarter`, `installWorkflows`, `setUpForApp`.
- [BundleStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/BundleStore.tsx): the install flow.
- [packages/templates/cartridges/src/](../../../packages/templates/cartridges/src): the cartridges; [bundles/](../../../bundles): the bundle files.
- [docs/architecture/apps-as-data.md](../../../docs/architecture/apps-as-data.md): bundles in depth.

</details>
