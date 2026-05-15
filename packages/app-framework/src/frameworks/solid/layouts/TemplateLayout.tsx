/**
 * TemplateLayout
 *
 * Root layout component for the main <Router>. Mounted as `root={TemplateLayout}`
 * on the Router so it has access to useNavigate()/useLocation() from SolidJS Router.
 *
 * Responsibilities:
 * - Wire navigate + location into routeStore (same pattern as RouteStoreProvider)
 * - Render the content viewport (offset from shell sidebar, AI panel)
 * - Render the active template (visibility-hidden when an app is active)
 * - Render the shell overlay (profile, settings, etc.) above the template
 * - Render persistent app iframes (CSS-toggled, always mounted)
 *
 * The shell overlay uses ShellRouteStoreProvider + <MemoryRouter> so shell schema
 * $routes outlets work with a real router context, without touching the browser URL.
 */
import { landingPageTemplate, profileTemplate, schemaTestsTemplate, settingsTemplate } from '@shared/schemas';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import { ShellRouterRoot, ShellRouteStoreProvider, useShellRouteStore } from '@solid/stores/ShellRouteStore';
import type { Stores } from '@solid/types';
import { MemoryRouter, Route, useLocation, useNavigate } from '@solidjs/router';
import type { TemplateSchema } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import type { ParentProps } from 'solid-js';
import { createEffect, For, onCleanup, Show } from 'solid-js';

import { buildRoutes } from '../utils/buildRoutes';

// Width of the collapsed shell sidebar — also set as --we-sidebar-width on :root.
export const SHELL_SIDEBAR_WIDTH = '72px';

// Shell view schemas — rendered as an overlay when activeShellView is set.
const shellViewSchemas: Record<string, TemplateSchema> = {
  'landing-page': landingPageTemplate,
  profile: profileTemplate,
  settings: settingsTemplate,
  'schema-tests': schemaTestsTemplate,
};

// ---------------------------------------------------------------------------
// Shell overlay inner — rendered inside ShellRouteStoreProvider + MemoryRouter
// ---------------------------------------------------------------------------

function ShellOverlayInner({ stores, shellNode }: { stores: Stores; shellNode: TemplateSchema }) {
  const shellRouteStore = useShellRouteStore();
  const shellStores: Stores = { ...stores, routeStore: shellRouteStore };

  // benchRunAll navigates programmatically (outside the schema action system), so it needs
  // to use the shell MemoryRouter's navigate, not the main browser Router's.
  const testStore = stores.testStore as { benchSetNavigate?: (fn: (to: string) => void) => void } | undefined;
  testStore?.benchSetNavigate?.((to: string) => shellRouteStore.navigate(to));
  onCleanup(() => {
    // Restore to main router navigate so benchSetNavigate isn't left pointing at a dead router.
    testStore?.benchSetNavigate?.((to: string) => stores.routeStore.navigate(to));
  });

  return (
    <MemoryRouter
      root={(props) => (
        <ShellRouterRoot>
          <RenderSchema node={shellNode} stores={shellStores} registry={registry} children={props.children} />
        </ShellRouterRoot>
      )}
    >
      {buildRoutes(shellStores, shellNode.routes ?? [])}
      <Route path="*" component={() => null} />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// TemplateLayout — mounted as root prop of the main <Router>
// ---------------------------------------------------------------------------

export function TemplateLayout(props: ParentProps & { stores: Stores }) {
  const { stores } = props;

  // Wire useNavigate/useLocation (available here because we're inside <Router>) into routeStore
  const navigate = useNavigate();
  const location = useLocation();
  createEffect(() => stores.routeStore.setNavigateFunction(() => navigate));
  createEffect(() => stores.routeStore.setCurrentPath(location.pathname));

  const aiRightMargin = () => (stores.aiStore.isOpen() ? '400px' : '0');
  const contentWidth = () =>
    stores.aiStore.isOpen() ? `calc(100% - ${SHELL_SIDEBAR_WIDTH} - 400px)` : `calc(100% - ${SHELL_SIDEBAR_WIDTH})`;

  return (
    <>
      {/* Content viewport — offset from shell sidebar and AI panel */}
      <div
        style={{
          position: 'fixed',
          top: '0',
          left: `var(--we-sidebar-width, ${SHELL_SIDEBAR_WIDTH})`,
          right: aiRightMargin(),
          width: contentWidth(),
          height: '100vh',
          transition: 'right 300ms ease, width 300ms ease',
        }}
      >
        {/* Template content — WebGL canvas (Cesium) stays laid out even when hidden */}
        <div
          style={{
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            visibility: stores.appStore.activeAppId() ? 'hidden' : 'visible',
            'pointer-events': stores.appStore.activeAppId() ? 'none' : 'auto',
            'overflow-y': 'auto',
            'scrollbar-gutter': 'stable',
          }}
        >
          <Show when={stores.templateStore.currentTemplate.id || 'empty'} keyed>
            <RenderSchema
              node={stores.templateStore.currentTemplate}
              stores={stores}
              registry={registry}
              children={props.children}
            />
          </Show>
        </div>

        {/* Shell overlay — profile, settings, schema-tests, landing-page.
             Rendered above the template (z-index 11). ShellRouteStoreProvider + MemoryRouter
             give it a real isolated routing context without touching the browser URL bar.
             Keyed on shellViewId so switching views properly recreates the overlay. */}
        <Show when={stores.templateStore.activeShellView()} keyed>
          {(shellViewId) => {
            const shellNode = shellViewSchemas[shellViewId];
            if (!shellNode) return null;
            return (
              <div
                style={{
                  position: 'absolute',
                  top: '0',
                  left: '0',
                  width: '100%',
                  height: '100%',
                  'z-index': '11',
                  'overflow-y': 'auto',
                }}
              >
                <ShellRouteStoreProvider>
                  <ShellOverlayInner stores={stores} shellNode={shellNode} />
                </ShellRouteStoreProvider>
              </div>
            );
          }}
        </Show>

        {/* Persistent app iframes — always mounted, CSS-toggled */}
        <For each={stores.appStore.apps()}>
          {(app) => (
            <div
              style={{
                position: 'absolute',
                top: '0',
                left: '0',
                display: stores.appStore.activeAppId() === app.id ? 'block' : 'none',
                width: '100%',
                height: '100%',
              }}
            >
              <we-iframe src={app.url} title={app.name} allow={app.allow} width="100%" height="100%" display="block" />
            </div>
          )}
        </For>
      </div>
    </>
  );
}
