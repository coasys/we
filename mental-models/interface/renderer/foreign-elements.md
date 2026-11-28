# Foreign elements

A **foreign element** is a custom element from a third-party library that a deployment bundles, such as a chart or a rating. The seed's `elements` list names the package and its tags. A generator writes the imports that define the elements. The **content security policy** of `@we/csp` sets which sources a page can load images, media and frames from.

**Why:** The renderer already mounts any tag with a hyphen. Without the import, the tag mounts as an empty element that nothing upgrades. The seed entry also records that the deployment includes this code, so the validator accepts the tags and the AI context documents them (`generateElementRegistry.mjs`). One policy builder serves Electron, the web build and Tauri, so the three hosts do not have three copies that drift (`packages/csp/src/index.js`).

**Parent:** [Renderer](README.md)

<details><summary>How it works</summary>

**Elements.**
1. A seed entry is `{ package, define, tags }`. `define` defaults to the package itself. `tags` defaults to the tags in the package's custom elements manifest.
2. `pnpm --filter @we/app-shell generate-elements` checks each entry. The package must be a dependency of `@we/app-shell`. Each tag must be a valid custom element name, must not start with `we-`, and must come from one package only.
3. The generator writes `foreignElements.generated.ts`: one import per `define` entry, and `foreignElementTags`. `componentRegistry.tsx` imports this file.
4. WE's own seed has no `elements` list, so `foreignElementTags` is empty.

**Content security policy.**
1. `buildContentSecurityPolicy({ host, dev, seed, meta })` builds the policy for `electron`, `tauri` or `web`.
2. `img-src`, `media-src` and `frame-src` list sources, not all of `https:`. `DEFAULT_SOURCES` holds what WE itself loads from. `seedSources(seed)` adds the seed's `contentSecurity.images`, `media` and `frames` origins, and the origin of each embedded app's `paths.webUrl`. A malformed origin stops the build.
3. A production `script-src` has no `'unsafe-inline'`. `object-src` is `'none'`.
4. Electron sets the policy as a header. The Vite plugin `contentSecurityPolicy({ host, seedFile })` writes it as a `<meta>` tag for the web and Tauri builds. A `<meta>` tag cannot carry `frame-ancestors`, so the web build also writes a Netlify `_headers` file with the policy.

How each host sets the policy: [Hosts](../../hosts/README.md).

</details>

<details><summary>Where in the code</summary>

- [packages/app-shell/scripts/generateElementRegistry.mjs](../../../packages/app-shell/scripts/generateElementRegistry.mjs): the generator.
- [foreignElements.generated.ts](../../../packages/app-shell/src/shared/registries/foreignElements.generated.ts): `foreignElementTags`.
- [packages/csp/src/index.js](../../../packages/csp/src/index.js): `buildContentSecurityPolicy`, `seedSources`, `DEFAULT_SOURCES`, `SKYBOX_TEXTURES`.
- [packages/csp/src/vite.js](../../../packages/csp/src/vite.js): `contentSecurityPolicy`.
- [we-seed.json](../../../we-seed.json): `contentSecurity`.

</details>
