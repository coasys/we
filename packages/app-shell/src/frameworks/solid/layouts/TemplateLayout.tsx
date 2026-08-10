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
import { panelResizing, RAIL_STRIP_WIDTH, TEMPLATE_RAILS_WIDTH, THEME_RAIL_WIDTH } from '@we/editor/runtime';
import type { TemplateSchema } from '@we/schema-shared';
import { themeToStyle } from '@we/schema-shared';
import { lazy } from 'solid-js';

const EditorOverlay = lazy(() => import('@we/editor').then((m) => ({ default: m.EditorOverlay })));
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
/**
 * The right-edge chrome the *editor* is holding, in pixels.
 *
 * Split out because two different consumers need it separately. The content viewport wants it added
 * to whatever docks are taking, which is what `computeRightOffset` returns; the dock geometry wants
 * it on its own, as room already spoken for — a panel that ignored it opened directly on top of the
 * controls being used to edit the thing it was covering.
 */
export function computeEditorRightOffset(stores: Stores): number {
  let offset = 0;
  if (stores.editorStore.isEditingTheme()) {
    offset += THEME_RAIL_WIDTH;
    if (stores.editorStore.themePanelOpen()) offset += stores.editorStore.themePanelWidth();
  }
  if (stores.editorStore.isEditingTemplate()) {
    offset += TEMPLATE_RAILS_WIDTH;
    if (stores.editorStore.isOpen()) offset += stores.editorStore.aiPanelWidth();
    if (stores.editorStore.codePanelOpen()) offset += stores.editorStore.codePanelWidth();
    if (stores.editorStore.contentMode() === 'visual') {
      offset += RAIL_STRIP_WIDTH;
      if (stores.editorStore.visualPanelOpen()) offset += stores.editorStore.visualPanelWidth();
    }
  }
  return offset;
}

// Right-edge offset of the content viewport — shrinks it to make room for the editor's rails and
// panels, and for any docked module. Shared with PersistentAppFrames so the persistent app iframes
// (rendered outside the template Router) line up with the same viewport the template content
// occupies.
export function computeRightOffset(stores: Stores): string {
  const offset = stores.shellStore.contentInset().right + computeEditorRightOffset(stores);
  return offset ? `${offset}px` : '0px';
}

/**
 * The other three edges, from docked module panels alone.
 *
 * Separate from `computeRightOffset` because that one is also the editor's, and the editor only
 * ever grows from the right. Kept as CSS strings for the same reason: these feed DS props, and an
 * offset of zero should read as `'0px'` rather than as an omitted prop that inherits something.
 *
 * The left offset composes with the shell sidebar rather than replacing it — a left dock opens
 * *beside* the sidebar, not over it, so its width adds to the sidebar's.
 */
export function computeLeftOffset(stores: Stores): string {
  const dock = stores.shellStore.contentInset().left;
  const sidebar = `var(--we-sidebar-width, ${SHELL_SIDEBAR_WIDTH})`;
  return dock ? `calc(${sidebar} + ${dock}px)` : sidebar;
}

export function computeTopOffset(stores: Stores): string {
  return `${stores.shellStore.contentInset().top}px`;
}

export function computeBottomOffset(stores: Stores): string {
  return `${stores.shellStore.contentInset().bottom}px`;
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
        testStore: createTestStore(
          base.datasetStore.testDataset,
          () => base.sessionStore.backendPorts()?.schemas ?? null,
        ),
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
    if (stores.shellStore.activeShellView()) stores.editorStore.exitTemplateEditing();
  });

  // Scoped space theme — applied to the template content area only.
  // activeTemplateTheme() returns the editing theme (when editing in scoped mode) or the
  // space theme, and null in global mode (template inherits from documentElement).
  const spaceThemeStyle = createMemo(() => {
    const td = stores.themeStore.activeTemplateTheme();
    if (!td) return {};
    const overrides = td.overrides ? JSON.parse(td.overrides) : {};
    if (isValidThemeKey(td.id) && !overrides.themeName) overrides.themeName = td.id;
    return {
      ...themeToStyle(overrides),
      /**
       * Re-resolve the inherited text colour against this wrapper's own tokens.
       *
       * The global stylesheet sets `color: var(--we-color-neutral-1000)` on `html, body, #root`.
       * A custom property is substituted where the declaration lives, so that resolves against
       * documentElement — the *personal* theme in scoped mode — and then inherits down as a
       * finished colour. Re-declaring the token on this wrapper does not re-run that substitution,
       * so a light space under a dark personal theme rendered light surfaces with white text on
       * anything that did not set its own colour.
       *
       * `background-color` needs no equivalent: it does not inherit, so the wrapper's own surfaces
       * paint from the tokens it declares.
       */
      color: 'var(--we-color-neutral-1000)',
    };
  });

  const spaceThemeName = createMemo(() => {
    const td = stores.themeStore.activeTemplateTheme();
    if (!td) return undefined;
    const overrides = td.overrides ? JSON.parse(td.overrides) : {};
    return (overrides.themeName as string | undefined) ?? (isValidThemeKey(td.id) ? td.id : undefined);
  });

  const rightOffset = () => computeRightOffset(stores);
  const leftOffset = () => computeLeftOffset(stores);
  const topOffset = () => computeTopOffset(stores);
  const bottomOffset = () => computeBottomOffset(stores);

  return (
    <>
      {/* Content viewport — offset from the shell sidebar, the editor panels, and any docked module.
          Sized by its four offsets rather than by `height: 100vh`, so a dock on the top or bottom
          edge takes room from it the same way one on the left or right does. */}
      <Column
        position="fixed"
        top={topOffset()}
        bottom={bottomOffset()}
        left={leftOffset()}
        right={rightOffset()}
        // Suspended during either kind of drag, so the viewport edge tracks the cursor exactly rather
        // than lagging a third of a second behind it.
        transition={
          panelResizing() || stores.shellStore.dockResizing()
            ? 'none'
            : 'top 300ms ease, right 300ms ease, bottom 300ms ease, left 300ms ease'
        }
      >
        {/*
          Main template content, and the scoped space theme.

          These are one element on purpose. The theme used to live on a `display: contents` div
          inside this one, which declares the space's CSS vars but generates no box — so it could
          never paint, and the scroll container had no background at all. Everything the template's
          own content did not cover fell through to the canvas, which `html, body, #root` paints
          from documentElement's tokens: the *shell* theme. Scrolling past a template that sized
          itself to the viewport showed exactly that.

          A scrolling element's background covers its whole scrollable overflow area rather than
          just the visible box, so painting here — from vars declared here — means no template can
          leak the shell's background however it handles its own height. Overlays are siblings, so
          they correctly stay on the shell theme.
        */}
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
          bg="neutral-50"
          data-we-theme={spaceThemeName()}
          styles={spaceThemeStyle()}
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

        {/* Code / visual editor overlay — sits above template (z:5), below shell (z:11).
            Fetched with the rest of the editing surface, so a session that never edits never
            downloads it. */}
        <EditorOverlay />

        {/* Shell overlay rendered above the template */}
        <Show when={stores.shellStore.activeShellView()} keyed>
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
