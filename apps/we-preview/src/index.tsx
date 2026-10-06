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
import {
  buildValidationContext,
  contextData,
  validateSemantic,
  validateStructure,
  type ValidationError,
} from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import { datasetIdFor, type Fixture } from '@we/template-fixtures';
import { render } from 'solid-js/web';

import rootSeed from '../../../we-seed.json';
import { bareNode, type ExternalTemplate } from './bare';
import { inMemoryConnector, requestedFixture, startRoute, useExternalFixture } from './platform/inMemoryConnector';
import { previewPlatform } from './platform/previewPlatform';
import { PreviewBootstrap } from './PreviewBootstrap';

const params = new URLSearchParams(window.location.search);

/*
  A fixture from a URL, beside the bundled ones — how a cartridge brings its own content, shapes and
  templates without being compiled into this host. Same-origin for templateUrl's reason: a link must
  not be able to load whatever JSON its author pointed it at.
*/
const fixtureUrl = params.get('fixtureUrl');
if (fixtureUrl) {
  const loaded = await loadSameOrigin<Fixture>(fixtureUrl, 'fixtureUrl');
  if (!loaded)
    throw new Error(
      `[preview] ${((window as unknown as Record<string, unknown>).__wePreview as { error: string }).error}`,
    );
  useExternalFixture(loaded);
}

const templateUrl = params.get('templateUrl');
const externalTemplate = templateUrl ? await loadExternalTemplate(templateUrl) : undefined;
if (templateUrl && !externalTemplate) {
  // Stop here. Rendering the fixture's own template instead would hand back a picture of the wrong
  // template, and one that looks entirely plausible.
  throw new Error(
    `[preview] ${((window as unknown as Record<string, unknown>).__wePreview as { error: string }).error}`,
  );
}
if (externalTemplate) {
  const id = externalTemplate.id || 'cli-external';
  (templateRegistry as Record<string, unknown>)[id] = externalTemplate;
  (window as unknown as Record<string, unknown>).__externalTemplateId = id;
  reportSchemaFindings(externalTemplate);
}

/**
 * The template `we-render` serves beside the page, or undefined with the reason on `__wePreview`,
 * which is what the CLI is waiting on — so a failure answers at once instead of after its timeout.
 *
 * Same origin only. The CLI serves the template from the server that serves this page; a URL from
 * anywhere else would let a link render whatever JSON its author pointed it at.
 */
async function loadExternalTemplate(url: string): Promise<ExternalTemplate | undefined> {
  return loadSameOrigin<ExternalTemplate>(url, 'templateUrl');
}

/** A JSON object from this origin, or undefined with the reason on `__wePreview`. */
async function loadSameOrigin<T>(url: string, param: string): Promise<T | undefined> {
  const fail = (error: string) => {
    (window as unknown as Record<string, unknown>).__wePreview = { error };
    return undefined;
  };
  let target: URL;
  try {
    target = new URL(url, window.location.href);
  } catch {
    return fail(`${param} is not a URL: ${url}`);
  }
  if (target.origin !== window.location.origin) return fail(`${param} must be on ${window.location.origin}`);
  try {
    const res = await fetch(target);
    if (!res.ok) return fail(`${target.pathname} answered ${res.status}`);
    const value = (await res.json()) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return fail(`${param} is not a JSON object`);
    }
    return value as T;
  } catch (error) {
    return fail((error as Error).message);
  }
}

/**
 * WE's own verdict on an injected template, as console warnings — which `we-render` already relays
 * under "problems".
 *
 * The renderer forgives much of what these checks catch: a spacing step the scale lacks renders no
 * space rather than an error. A render alone cannot show that, and the author reading it is often
 * an agent that only has the picture.
 */
function reportSchemaFindings(template: unknown): void {
  const warn = (f: ValidationError) => console.warn(`schema ${f.severity} at ${f.path || '(root)'}: ${f.message}`);
  let structural: ValidationError[] = [];
  try {
    structural = validateStructure(template).errors;
    // Semantic findings go first because they are specific. The checks assume a well-formed tree and
    // can throw on a malformed one, which must not cost the render.
    validateSemantic(template, buildValidationContext(contextData)).errors.forEach(warn);
  } catch (error) {
    console.warn(`schema check failed: ${(error as Error).message}`);
  }
  // zod reports a bad value once per union branch it failed, all at one path: keep the first.
  structural.filter((f, i) => structural.findIndex((g) => g.path === f.path) === i).forEach(warn);
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
 *   same template differ from the last. A fixture that needs one names it in `modules`.
 * - **`apps: []`** — embedded apps are iframes onto other dev servers that are not running here.
 * - **no `ad4m` block** — there is no executor to point at, which is the entire premise.
 */
const previewSeed: WeSeedFile = {
  ...(rootSeed as unknown as WeSeedFile),
  project: { ...(rootSeed as unknown as WeSeedFile).project, name: 'WE Preview' },
  // None, unless the fixture's template needs one — a cartridge that draws a globe says so.
  modules: requestedFixture().modules ?? [],
  apps: [],
  ad4m: undefined,
};

const fixture = requestedFixture();
const routeOverride = params.get('route');

/**
 * The root, composed rather than the packaged `<App/>`.
 *
 * `<App/>` is exactly `StoreProvider > TemplateProvider + ToastContainer`; spelling it out is what
 * lets {@link PreviewBootstrap} sit *inside* the store scope, which it has to, because selecting the
 * fixture's dataset and route is store work. See its docstring for why a URL cannot do it.
 */
const bare = params.get('bare') === '1' && externalTemplate !== undefined;

if (bare) {
  const { node, path } = bareNode(externalTemplate!, routeOverride);
  if (routeOverride && path !== routeOverride)
    console.warn(`no route ${routeOverride} in the template; rendered ${path}`);
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
        node={{ type: '$surface', children: [node] } as never}
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
          <PreviewBootstrap datasetId={datasetIdFor(fixture)} route={startRoute(fixture)} />
          <TemplateProvider />
          <ToastContainer />
        </StoreProvider>
      </PlatformProvider>
    ),
    document.getElementById('root')!,
  );
}
