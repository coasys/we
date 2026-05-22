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
import {
  landingPageTemplate,
  forCommunitiesTemplate,
  forBuildersTemplate,
  howItWorksTemplate,
  seeItInPracticeTemplate,
  profileTemplate,
  schemaTestsTemplate,
  settingsTemplate,
} from '@shared/schemas';
import { schemaMutationActions } from '@shared/schemas/shell/tests/SchemaMutations.actions';
import { createTestStore } from '@shared/schemas/shell/tests/testStore';
import { deepClone } from '@shared/utils';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import type { RouteStore } from '@solid/stores/RouteStore';
import { ShellRouterRoot, ShellRouteStoreProvider, useShellRouteStore } from '@solid/stores/ShellRouteStore';
import type { Stores } from '@solid/types';
import { MemoryRouter, Route, useLocation, useNavigate } from '@solidjs/router';
import { Column } from '@we/components/solid';
import type { TemplateSchema } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import type { ParentProps } from 'solid-js';
import { createEffect, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';

import { buildRoutes } from '../utils/buildRoutes';

// Width of the collapsed shell sidebar — also set as --we-sidebar-width on :root.
export const SHELL_SIDEBAR_WIDTH = '72px';

// Shell view registry — maps activeShellView id → schema + optional extra stores.
// The stores factory is called with (baseStores, shellRouteStore) at mount time,
// so each view gets exactly the stores it needs and nothing more.
// Returning { $schema } from the factory overrides the rendered schema with a
// mutable reactive store — used by schema-tests to make mutations visible.
type ShellViewEntry = {
  schema: TemplateSchema;
  stores?: (base: Stores, shellRouteStore: RouteStore) => Partial<Stores> & { $schema?: TemplateSchema };
};

const shellViews: Record<string, ShellViewEntry> = {
  'landing-page': { schema: landingPageTemplate },
  'for-communities': { schema: forCommunitiesTemplate },
  'for-builders': { schema: forBuildersTemplate },
  'how-it-works': { schema: howItWorksTemplate },
  'see-it-in-practice': { schema: seeItInPracticeTemplate },
  profile: { schema: profileTemplate },
  settings: { schema: settingsTemplate },
  'schema-tests': {
    schema: schemaTestsTemplate,
    stores: (base, shellRouteStore) => {
      const [schemaState, setSchemaState] = createStore<TemplateSchema>(deepClone(schemaTestsTemplate));
      const mutations = schemaMutationActions(schemaState, setSchemaState);
      return {
        templateStore: { ...base.templateStore, ...mutations },
        testStore: createTestStore(base.adamStore.testPerspective, (to) => shellRouteStore.navigate(to)),
        $schema: schemaState,
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Shell overlay inner — rendered inside ShellRouteStoreProvider + MemoryRouter
// ---------------------------------------------------------------------------

function ShellOverlayInner({ stores, view }: { stores: Stores; view: ShellViewEntry }) {
  const shellRouteStore = useShellRouteStore();
  const { $schema: reactiveSchema, ...storeEntries } = view.stores?.(stores, shellRouteStore) ?? {};
  const shellStores: Stores = { ...stores, routeStore: shellRouteStore, ...(storeEntries as Partial<Stores>) };
  const schema = reactiveSchema ?? view.schema;

  return (
    <MemoryRouter
      root={(props) => (
        <ShellRouterRoot>
          <RenderSchema node={schema} stores={shellStores} registry={registry} children={props.children} />
        </ShellRouterRoot>
      )}
    >
      {buildRoutes(shellStores, schema.routes ?? [])}
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
      <Column
        position="fixed"
        top="0"
        left={`var(--we-sidebar-width, ${SHELL_SIDEBAR_WIDTH})`}
        right={aiRightMargin()}
        width={contentWidth()}
        height="100vh"
        transition="right 300ms ease, width 300ms ease"
      >
        {/* Main template content */}
        <Column
          display="block"
          position="absolute"
          top="0"
          left="0"
          width="100%"
          height="100%"
          visibility={stores.appStore.activeAppId() ? 'hidden' : 'visible'}
          pointerEvents={stores.appStore.activeAppId() ? 'none' : 'auto'}
          overflow="auto"
          scrollbarGutter="stable"
        >
          <Show when={stores.templateStore.currentTemplate.id || 'empty'} keyed>
            <RenderSchema
              node={stores.templateStore.currentTemplate}
              stores={stores}
              registry={registry}
              children={props.children}
            />
          </Show>
        </Column>

        {/* Shell overlay rendered above the template */}
        <Show when={stores.templateStore.activeShellView()} keyed>
          {(shellViewId) => {
            const view = shellViews[shellViewId];
            if (!view) return null;
            return (
              <Column
                display="block"
                position="absolute"
                top="0"
                left="0"
                width="100%"
                height="100%"
                zIndex={11}
                overflow="auto"
              >
                <ShellRouteStoreProvider>
                  <ShellOverlayInner stores={stores} view={view} />
                </ShellRouteStoreProvider>
              </Column>
            );
          }}
        </Show>

        {/* Persistent app iframes — always mounted, CSS-toggled */}
        <For each={stores.appStore.apps()}>
          {(app) => (
            <Column
              position="absolute"
              top="0"
              left="0"
              display={stores.appStore.activeAppId() === app.id ? 'block' : 'none'}
              width="100%"
              height="100%"
            >
              <we-iframe src={app.url} title={app.name} allow={app.allow} width="100%" height="100%" display="block" />
            </Column>
          )}
        </For>
      </Column>
    </>
  );
}
