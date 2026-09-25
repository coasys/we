/* @refresh reload */
import '@we/app-shell/shared/index.scss';

import {
  componentRegistry,
  PlatformProvider,
  StoreProvider,
  TemplateProvider,
  templateRegistry,
  type WeSeedFile,
} from '@we/app-shell/solid';
import { ToastContainer } from '@we/components/solid';
import { RenderSchema } from '@we/schema-solid';
import { datasetIdFor, pathFor } from '@we/template-fixtures';
import { render } from 'solid-js/web';

import rootSeed from '../../../we-seed.json';
import { inMemoryConnector, requestedFixture } from './platform/inMemoryConnector';
import { previewPlatform } from './platform/previewPlatform';
import { PreviewBootstrap } from './PreviewBootstrap';

const params = new URLSearchParams(window.location.search);
const templateUrl = params.get('templateUrl');
let externalTemplate: ExternalTemplate | undefined;
if (templateUrl) {
  const res = await fetch(templateUrl);
  if (res.ok) {
    externalTemplate = (await res.json()) as ExternalTemplate;
    const id = externalTemplate.id || 'cli-external';
    (templateRegistry as Record<string, unknown>)[id] = externalTemplate;
    (window as unknown as Record<string, unknown>).__externalTemplateId = id;
  }
}

type SchemaNode = { type?: string; props?: Record<string, unknown>; children?: unknown[]; [key: string]: unknown };
type ExternalTemplate = SchemaNode & { id?: string; routes?: Array<SchemaNode & { path?: string }> };

/**
 * The template alone, with no shell around it: `?bare=1`.
 *
 * The full host mounts a template as a space's content, inside the sidebar and the module rail, and
 * that content area is a query container — so a template cannot even paint over the chrome with a
 * fixed-position root. A mockup of a screen that is not a space (an onboarding step, an account
 * page) needs the viewport to itself. Bare mode renders the template's root with its `$routes` slot
 * replaced by the one route asked for (`?route=`, default `/`), through the same renderer and the
 * same component registry as the app, inside a surface as the app provides, over empty stores —
 * which is what a static mockup reads.
 */
function bareNode(template: ExternalTemplate, path: string): SchemaNode {
  const route = template.routes?.find((r) => r.path === path) ?? template.routes?.[0];
  const { routes: _routes, id: _id, schemaVersion: _v, meta: _meta, ...root } = template;
  const swap = (children: unknown[] | undefined): unknown[] | undefined =>
    children?.map((child) =>
      child && typeof child === 'object' && (child as SchemaNode).type === '$routes' ? route : child,
    );
  return route ? { ...root, children: swap(root.children) } : root;
}

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
const routeOverride = new URLSearchParams(window.location.search).get('route');

/**
 * The root, composed rather than the packaged `<App/>`.
 *
 * `<App/>` is exactly `StoreProvider > TemplateProvider + ToastContainer`; spelling it out is what
 * lets {@link PreviewBootstrap} sit *inside* the store scope, which it has to, because selecting the
 * fixture's dataset and route is store work. See its docstring for why a URL cannot do it.
 */
const bare = params.get('bare') === '1' && externalTemplate !== undefined;

if (bare) {
  const path = routeOverride ?? '/';
  // The app pins html/body/#root to the viewport and scrolls inside; a mockup should grow with its
  // content, so a full-page capture shows the whole screen.
  const release = document.createElement('style');
  release.textContent =
    'html, body, #root { height: auto !important; min-height: 100%; overflow: visible !important; }';
  document.head.appendChild(release);
  render(
    () => (
      <RenderSchema
        // The host's surface, as the full app puts one wherever it mounts a schema tree — without it
        // no `*UpProps` tier would ever match, and every render would be the phone layout.
        node={{ type: '$surface', children: [bareNode(externalTemplate!, path)] } as never}
        stores={{}}
        registry={componentRegistry}
      />
    ),
    document.getElementById('root')!,
  );
  (window as unknown as Record<string, unknown>).__wePreview = { templateId: externalTemplate!.id, path, bare: true };
} else {
  render(
    () => (
      <PlatformProvider seed={previewSeed} platform={previewPlatform} backend={inMemoryConnector}>
        <StoreProvider>
          <PreviewBootstrap datasetId={datasetIdFor(fixture)} route={routeOverride ?? pathFor(fixture)} />
          <TemplateProvider />
          <ToastContainer />
        </StoreProvider>
      </PlatformProvider>
    ),
    document.getElementById('root')!,
  );
}
