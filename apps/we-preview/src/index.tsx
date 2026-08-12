/* @refresh reload */
import '@we/app-shell/shared/index.scss';

import { PlatformProvider, StoreProvider, TemplateProvider, type WeSeedFile } from '@we/app-shell/solid';
import { ToastContainer } from '@we/components/solid';
import { datasetIdFor, pathFor } from '@we/template-fixtures';
import { render } from 'solid-js/web';

import rootSeed from '../../../we-seed.json';
import { inMemoryConnector, requestedFixture } from './platform/inMemoryConnector';
import { previewPlatform } from './platform/previewPlatform';
import { PreviewBootstrap } from './PreviewBootstrap';

/**
 * The deployment this host runs, derived from the root seed rather than declared beside it.
 *
 * A separate `we-preview.seed.json` would have been the obvious move and would have been a lie:
 * `templates` is not read at runtime. `pnpm --filter @we/app-shell generate-templates` compiles the
 * *root* seed's list into `bundledTemplates.generated.ts`, one registry for the whole monorepo, so a
 * second seed naming a different set would declare templates this build cannot import. Deriving
 * keeps the two in step by construction.
 *
 * What is overridden is only what this host genuinely differs on:
 *
 * - **`modules: []`** — the globe mounts Cesium and the call module wants media devices. Neither
 *   survives a headless screenshot usefully, and a spinning globe would make every render of the
 *   same template differ from the last. Set it back to the root list to photograph module chrome.
 * - **`apps: []`** — embedded apps are iframes onto other dev servers that are not running here.
 * - **no `ad4m` block** — there is no executor to point at, which is the entire premise.
 */
const previewSeed: WeSeedFile = {
  ...(rootSeed as unknown as WeSeedFile),
  project: { ...(rootSeed as unknown as WeSeedFile).project, name: 'WE Preview' },
  modules: [],
  apps: [],
  ad4m: undefined,
};

const fixture = requestedFixture();

/**
 * The root, composed rather than the packaged `<App/>`.
 *
 * `<App/>` is exactly `StoreProvider > TemplateProvider + ToastContainer`; spelling it out is what
 * lets {@link PreviewBootstrap} sit *inside* the store scope, which it has to, because selecting the
 * fixture's dataset and route is store work. See its docstring for why a URL cannot do it.
 */
render(
  () => (
    <PlatformProvider seed={previewSeed} platform={previewPlatform} backend={inMemoryConnector}>
      <StoreProvider>
        <PreviewBootstrap datasetId={datasetIdFor(fixture)} route={pathFor(fixture)} />
        <TemplateProvider />
        <ToastContainer />
      </StoreProvider>
    </PlatformProvider>
  ),
  document.getElementById('root')!,
);
