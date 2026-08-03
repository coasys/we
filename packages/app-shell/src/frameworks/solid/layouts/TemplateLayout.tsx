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
 *
 * Persistent app iframes (e.g. Flux) are NOT rendered here — this component is
 * remounted whenever the active template changes (see the keyed <Show> around
 * <Router> in TemplateProvider), which would tear down and reload any embedded
 * app mid-use. They're rendered by PersistentAppFrames instead, mounted once
 * alongside the shell chrome in TemplateProvider, outside the keyed Router.
 *
 * The shell overlay uses ShellRouteStoreProvider + <MemoryRouter> so shell schema
 * $routes outlets work with a real router context, without touching the browser URL.
 */
import { isValidThemeKey } from '@shared/registries/themeRegistry';
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
import { EditorOverlay } from '@we/editor';
import { panelResizing, RAIL_STRIP_WIDTH, TEMPLATE_RAILS_WIDTH, THEME_RAIL_WIDTH } from '@we/editor';
import type { TemplateSchema } from '@we/schema-shared';
import { themeToStyle } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import type { ParentProps } from 'solid-js';
import { createEffect, createMemo, Show } from 'solid-js';
import { createStore } from 'solid-js/store';

import { buildRoutes } from '../utils/buildRoutes';

// Width of the collapsed shell sidebar — also set as --we-sidebar-width on :root.
export const SHELL_SIDEBAR_WIDTH = '80px';

// Right-edge offset of the content viewport — shrinks it to make room for the
// theme/template editor rails and panels. Shared with PersistentAppFrames so the
// persistent app iframes (rendered outside the template Router) line up with the
// same viewport the template content occupies.
export function computeRightOffset(stores: Stores): string {
  let offset = 0;
  if (stores.editSessionStore.isEditingTheme()) {
    offset += THEME_RAIL_WIDTH;
    if (stores.editSessionStore.themePanelOpen()) offset += stores.editSessionStore.themePanelWidth();
  }
  if (stores.editSessionStore.isEditingTemplate()) {
    offset += TEMPLATE_RAILS_WIDTH;
    if (stores.editSessionStore.isOpen()) offset += stores.editSessionStore.aiPanelWidth();
    if (stores.editSessionStore.codePanelOpen()) offset += stores.editSessionStore.codePanelWidth();
    if (stores.editSessionStore.contentMode() === 'visual') {
      offset += RAIL_STRIP_WIDTH;
      if (stores.editSessionStore.visualPanelOpen()) offset += stores.editSessionStore.visualPanelWidth();
    }
  }
  return offset ? `${offset}px` : '0px';
}

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
    stores: (base) => {
      const [schemaState, setSchemaState] = createStore<TemplateSchema>(deepClone(schemaTestsTemplate));
      const mutations = schemaMutationActions(schemaState, setSchemaState);
      return {
        templateStore: { ...base.templateStore, ...mutations },
        testStore: createTestStore(base.datasetStore.testDataset),
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
    if (stores.templateStore.activeShellView()) stores.editSessionStore.exitTemplateEditing();
  });

  // Scoped space theme — applied to the template content area only.
  // activeTemplateTheme() returns the editing theme (when editing in scoped mode) or the
  // space theme, and null in global mode (template inherits from documentElement).
  const spaceThemeStyle = createMemo(() => {
    const td = stores.themeStore.activeTemplateTheme();
    if (!td) return {};
    const overrides = td.overrides ? JSON.parse(td.overrides) : {};
    if (isValidThemeKey(td.id) && !overrides.themeName) overrides.themeName = td.id;
    return themeToStyle(overrides);
  });

  const spaceThemeName = createMemo(() => {
    const td = stores.themeStore.activeTemplateTheme();
    if (!td) return undefined;
    const overrides = td.overrides ? JSON.parse(td.overrides) : {};
    return (overrides.themeName as string | undefined) ?? (isValidThemeKey(td.id) ? td.id : undefined);
  });

  const rightOffset = () => computeRightOffset(stores);

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
          {/* Scoped space theme wrapper — display:contents keeps layout unaffected.
                Parametric overrides are applied as inline CSS vars; component-level CSS
                (theme.css) is injected into we-scoped-theme-css by ThemeStore and
                self-scopes via [data-we-theme='X'] attribute selectors. */}
          <div style={{ display: 'contents', ...spaceThemeStyle() }} data-we-theme={spaceThemeName()}>
            <Show when={stores.templateStore.currentTemplate.id || 'empty'} keyed>
              <RenderSchema
                node={stores.templateStore.currentTemplate}
                stores={stores}
                registry={registry}
                children={props.children}
              />
            </Show>
          </div>
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
                // Reserve the scrollbar gutter permanently. Without this, any shell view whose
                // content crosses the viewport height gains and loses its scrollbar as content
                // changes, and every reflow shifts the whole page horizontally. Most visible in the
                // benchmark runner, which swaps between routes of wildly different heights, but it
                // affects any shell view with variable-length content.
                scrollbarGutter="stable"
              >
                <ShellRouteStoreProvider>
                  <ShellOverlayInner stores={stores} view={view} />
                </ShellRouteStoreProvider>
              </Column>
            );
          }}
        </Show>
      </Column>
    </>
  );
}
