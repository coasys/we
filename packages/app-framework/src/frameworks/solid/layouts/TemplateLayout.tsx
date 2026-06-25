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
  marketplaceTemplate,
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

import { EditorOverlay } from '../components/template-editor/EditorOverlay';
import { panelResizing, TEMPLATE_RAILS_WIDTH, THEME_RAIL_WIDTH } from '../components/template-editor/RightPanelContainer';
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
  marketplace: { schema: marketplaceTemplate },
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

  // Exit template editing when a shell view (settings, profile, marketplace) opens.
  createEffect(() => {
    if (stores.templateStore.activeShellView()) stores.aiStore.exitTemplateEditing();
  });

  const rightOffset = () => {
    let offset = 0;
    if (stores.aiStore.isEditingTheme()) offset += THEME_RAIL_WIDTH;
    if (stores.aiStore.isEditingTemplate()) {
      offset += TEMPLATE_RAILS_WIDTH;
      if (stores.aiStore.isOpen()) offset += stores.aiStore.aiPanelWidth();
      if (stores.aiStore.codePanelOpen()) offset += stores.aiStore.codePanelWidth();
    }
    return offset ? `${offset}px` : '0px';
  };

  return (
    <>
      {/* Content viewport — offset from shell sidebar and AI panel */}
      <Column
        position="fixed"
        top="0"
        left={`var(--we-sidebar-width, ${SHELL_SIDEBAR_WIDTH})`}
        right={rightOffset()}
        height="100vh"
        transition={panelResizing() ? 'none' : 'right 300ms ease'}
      >
        {/* Main template content */}
        <Column
          display="block"
          position="absolute"
          top="0"
          left="0"
          width="100%"
          height="100%"
          zIndex={1}
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

        {/* Code / visual editor overlay — sits above template (z:5), below shell (z:11) */}
        <EditorOverlay />

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

        {/* Persistent app iframes — always mounted, opacity-toggled.
             opacity:0/1 creates an explicit GPU compositing layer (unlike visibility:hidden
             which does not). will-change:opacity pre-allocates that layer so the browser
             never needs to rasterize on show — it's a pure compositor operation. */}
        <For each={stores.appStore.apps()}>
          {(app) => (
            <Column
              position="absolute"
              top="0"
              left="0"
              opacity={stores.appStore.activeAppId() === app.id ? 1 : 0}
              pointerEvents={stores.appStore.activeAppId() === app.id ? 'auto' : 'none'}
              styles={{ 'will-change': 'opacity' }}
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
