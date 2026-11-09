/**
 * The base host: the app before a session, and the hand-off to WE's app once one is chosen.
 *
 * `BaseBoot` is what a host renders in place of `<PlatformProvider><App/></PlatformProvider>` when its
 * deployment's app brings a `base` template (a bundle's, `meta.role: 'base'`). It draws that template
 * with `BaseApp` — the same renderer, component registry and design system as everything else, against
 * a bag holding `baseStore` alone at the chrome tier — until the person has chosen where to connect.
 * Then, in the same page, it mounts WE's `App` with the connector the host made for that choice. A
 * deployment whose app has no `base` skips straight to the hand-off with the first connection the host
 * offers, so nothing changes for it.
 *
 * A small host of its own rather than a mode of `TemplateProvider`: that provider is built around a
 * session — every store it composes waits for one — and a screen asked before any backend exists has
 * nothing to wait for. What the two share is below the stores: `RenderSchema`, `componentRegistry`,
 * `buildTemplateBag` and the themes.
 *
 * The hand-off holds one more case: a connection that fails because its place could not be reached
 * (a phone offline, a server down) comes back here, to the base app's offline state with "Try again",
 * rather than ending on the session's own error screen. The host says which failures those are
 * (`BaseHost.isUnreachable`).
 */
import type { BackendConnector } from '@shared/backend/types';
import { svgDataUrl, WE_PRODUCT_NAME } from '@shared/bundles/brand';
import { type BundlePieces } from '@shared/bundles/bundlePieces';
import type { BaseConnection, BaseHost } from '@shared/platform/baseHost';
import type { PlatformAdapter } from '@shared/platform/types';
import { seedBundlePieces } from '@shared/registries/seedBundles';
import { buildTemplateBag, CHROME_TIER } from '@shared/registries/templateSurface';
import { applyThemeVars, installGestureTracking, parseOverrides, type TemplateSchema } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import { baseFallback } from '@we/template-shell';
import { sanitiseCss } from '@we/themes/sanitiseCss';
import { createSignal, type JSX, onCleanup, onMount, Show, untrack } from 'solid-js';

import type { WeSeedFile } from '../../../types/seed';
import App from '../App';
import { PlatformProvider } from '../providers/PlatformProvider';
import { componentRegistry } from '../registries/componentRegistry';
import { type BaseBrand, type BaseStore, createBaseStore } from '../stores/BaseStore';

/** The theme a base template is drawn in: the bundle's first, as it is the app's default. */
export interface BaseTheme {
  id: string;
  overrides: Record<string, unknown>;
  css?: string;
}

const BASE_THEME_STYLE_ID = 'we-base-theme-css';

/**
 * Paints the document in the bundle's theme, as `ThemeStore` paints it once a session runs: the
 * attribute its selectors match, its variables, and its stylesheet through the same filter.
 */
function applyBaseTheme(theme: BaseTheme): () => void {
  const root = document.documentElement;
  const overrides = parseOverrides(JSON.stringify(theme.overrides ?? {}));
  const name = typeof overrides.themeName === 'string' && overrides.themeName ? overrides.themeName : theme.id;
  root.setAttribute('data-we-theme', name);
  applyThemeVars(root, overrides, { crossFade: false });
  const style = document.createElement('style');
  style.id = BASE_THEME_STYLE_ID;
  style.textContent = theme.css ? sanitiseCss(theme.css, { namespace: 'we-base-theme' }).css : '';
  document.head.appendChild(style);
  // The session's theme store takes the document over from here; only the sheet is the base's own.
  return () => style.remove();
}

/** The base template and what it is drawn with, from one bundle's pieces. */
export interface BaseBundle {
  template: TemplateSchema & { id: string };
  brand: BaseBrand;
  theme?: BaseTheme;
}

/**
 * The deployment's base, if its app brings one: the seed's `host.ui.app`, else the first seed bundle
 * with an app — the same rule that picks the app a session opens in. `undefined` for a deployment
 * whose app has none (WE's own seed), which then boots as it always has.
 */
export function deploymentBase(
  seed: WeSeedFile,
  pieces: readonly BundlePieces[] = seedBundlePieces,
): BaseBundle | undefined {
  const appId = seed.host?.ui?.app || pieces.find((p) => p.app)?.app?.id;
  const owner = pieces.find((p) => p.app?.id === appId && p.base);
  if (!owner?.base) return undefined;
  return {
    template: owner.base,
    brand: { name: owner.brand?.name || owner.name || WE_PRODUCT_NAME, mark: svgDataUrl(owner.brand?.mark) },
    ...(owner.themes[0] ? { theme: owner.themes[0] } : {}),
  };
}

/** Draws a base template against `baseStore`, at the chrome tier, gestures enforced. */
export function BaseApp(props: { store: BaseStore; template: TemplateSchema; theme?: BaseTheme }): JSX.Element {
  // Only this store: before a session there is nothing else for a template to name.
  // The store is the boot's for its life: read once.
  const bag = buildTemplateBag({ baseStore: untrack(() => props.store) }, { grants: CHROME_TIER, gesture: 'enforce' });
  onMount(() => {
    onCleanup(installGestureTracking(window));
    if (props.theme) onCleanup(applyBaseTheme(props.theme));
  });
  return (
    <div data-we-base="" style={{ display: 'contents' }}>
      <RenderSchema node={props.template} stores={bag} registry={componentRegistry} />
    </div>
  );
}

export interface BaseBootProps {
  host: BaseHost;
  platform: PlatformAdapter;
  seed: WeSeedFile;
  /** The base to draw; `deploymentBase(seed)` when not given. `null` forces none. */
  base?: BaseBundle | null;
  /** Reached with the store once it exists, for a host that drives it (tests, a shell command). */
  onStore?: (store: BaseStore) => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The connector the app is given: the host's, with one difference — a failure to reach the place
 * goes back to the base app instead of to the session's error screen.
 */
export function handBackOnUnreachable(
  connector: BackendConnector,
  host: BaseHost,
  connection: BaseConnection,
  handBack: (reason: string) => void,
): BackendConnector {
  return {
    ...connector,
    initialize: async (ctx) => {
      try {
        return await connector.initialize(ctx);
      } catch (e) {
        if (host.isUnreachable?.(e)) {
          handBack(`${connection.label} could not be reached: ${message(e)}`);
          // The app is unmounted by the hand-back; nothing waits on this any more.
          return new Promise<never>(() => {});
        }
        throw e;
      }
    },
  };
}

export function BaseBoot(props: BaseBootProps): JSX.Element {
  // A boot's host, base and seed are fixed for its life: read once.
  const host = untrack(() => props.host);
  const base = untrack(() => (props.base === undefined ? deploymentBase(props.seed) : props.base));
  const [session, setSession] = createSignal<BackendConnector | null>(null);

  /*
    A deployment whose app brings no base asks nothing before a session, as it never did: no first
    run (its in-session one still runs), no choice — the first place the host offers is taken. Only
    what cannot wait for a session is drawn, by WE's own fallback: this device's backend starting or
    failing to, and a place that could not be reached.
  */
  const store = createBaseStore(base ? host : { ...host, identity: undefined }, {
    brand: base?.brand ?? { name: WE_PRODUCT_NAME, mark: '' },
    onHandOff: async (connection, how) => {
      const connector = await host.connector(connection, how);
      setSession(() => handBackOnUnreachable(connector, host, connection, back));
    },
    takeFirst: !base,
  });
  function back(reason: string) {
    setSession(null);
    store.handBack(reason);
  }
  untrack(() => props.onStore?.(store));

  return (
    <Show
      when={session()}
      keyed
      fallback={<BaseApp store={store} template={base?.template ?? baseFallback} theme={base?.theme} />}
    >
      {(connector) => (
        <PlatformProvider seed={props.seed} platform={props.platform} backend={connector}>
          <App />
        </PlatformProvider>
      )}
    </Show>
  );
}
