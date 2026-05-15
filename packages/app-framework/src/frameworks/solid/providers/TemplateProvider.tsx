import { launcherUIRegistry } from '@shared/registries/launcherUIRegistry';
import { getModel, getModelForPerspective } from '@shared/registries/modelRegistry';
import { landingPageTemplate, profileTemplate, schemaTestsTemplate, settingsTemplate } from '@shared/schemas';
import { createTestStore } from '@shared/schemas/shell/tests/testStore';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import type { RouteStore } from '@solid/stores';
import {
  useAdamStore,
  useAiStore,
  useAppStore,
  useRouteStore,
  useSpaceStore,
  useTemplateStore,
  useThemeStore,
} from '@solid/stores';
import type { Stores } from '@solid/types';
import type { MemoryHistory } from '@solidjs/router';
import { createMemoryHistory, MemoryRouter, Navigate, Route, Router, useLocation, useNavigate } from '@solidjs/router';
import { toastService } from '@we/components/solid';
import type { RouteSchema, TemplateSchema } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import type { JSX, ParentProps } from 'solid-js';
import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js';

// Width of the collapsed shell sidebar — defines the left offset for the content area.
// Also set as --we-sidebar-width on :root for any position:fixed elements that need it.
const SHELL_SIDEBAR_WIDTH = '72px';

type ParentStackItem = { node: RouteSchema; fullPath: string; baseDepth: number };

// Shell view schemas — rendered as an overlay when activeShellView is set
const shellViewSchemas: Record<string, TemplateSchema> = {
  'landing-page': landingPageTemplate,
  profile: profileTemplate,
  settings: settingsTemplate,
  'schema-tests': schemaTestsTemplate,
};

// Creates the root layout component for the router
function createLayout(stores: Stores, shellRouter: RouteStore, shellHistory: MemoryHistory) {
  return function Layout(props: ParentProps): JSX.Element {
    // Access the router hooks now we're inside the router context
    const navigate = useNavigate();
    const location = useLocation();

    // Store the navigate function in the route store so schema actions can use it
    createEffect(() => stores.routeStore.setNavigateFunction(() => navigate));

    // React to route changes and update relevant stores
    createEffect(() => stores.routeStore.setCurrentPath(location.pathname));

    const aiRightMargin = () => (stores.aiStore.isOpen() ? '400px' : '0');
    const contentWidth = () =>
      stores.aiStore.isOpen() ? `calc(100% - ${SHELL_SIDEBAR_WIDTH} - 400px)` : `calc(100% - ${SHELL_SIDEBAR_WIDTH})`;

    return (
      <>
        {/* Content viewport — shared by templates, shell overlay, and app iframes */}
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
          {/* Template content area — always in layout so WebGL (Cesium) never loses its dimensions.
               visibility:hidden keeps it laid out but invisible when an app is active. */}
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

          {/* Shell overlay — profile, settings, schema-tests rendered above the active template.
               position:absolute keeps the sidebar visible and interactive.
               shellRouter provides an isolated routing context so shell schemas work correctly
               without touching the browser URL bar. */}
          <Show when={stores.templateStore.activeShellView()} keyed>
            {(shellViewId) => {
              const shellNode = shellViewSchemas[shellViewId];
              if (!shellNode) return null;
              const shellStores = { ...stores, routeStore: shellRouter };
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
                  {/* MemoryRouter gives shell templates a real routing context so
                       { type: '$routes' } outlets work. Driven by shellHistory so
                       shellRouter.navigate() controls navigation without touching the URL bar. */}
                  <MemoryRouter
                    history={shellHistory}
                    root={(props) => (
                      <RenderSchema
                        node={shellNode}
                        stores={shellStores}
                        registry={registry}
                        children={props.children}
                      />
                    )}
                  >
                    {buildRoutes(shellStores, shellNode.routes ?? [])}
                    <Route path="*" component={() => null} />
                  </MemoryRouter>
                </div>
              );
            }}
          </Show>

          {/* Persistent app iframes — always mounted, CSS-toggled, layered on top of template */}
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
                <we-iframe
                  src={app.url}
                  title={app.name}
                  allow={app.allow}
                  width="100%"
                  height="100%"
                  display="block"
                />
              </div>
            )}
          </For>
        </div>
      </>
    );
  };
}

// Recursively builds nested <Route> JSX from a schema route tree.
// Routes that have both children and sub-routes become SolidJS layout routes —
// a persistent parent component that stays mounted while only the outlet (<$routes>) swaps.
// Routes with keepAlive:true are rendered permanently inside the parent layout and
// CSS-toggled, so their component tree (e.g. CesiumGlobe) never unmounts.
// Leaf routes and redirect routes behave as before.
function buildRoutes(
  stores: Stores,
  routes: RouteSchema[],
  parentPath = '',
  parentStack: ParentStackItem[] = [],
): JSX.Element[] {
  return routes.map((route) => {
    // Compute full path for baseDepth and absolute redirect resolution
    const fullPath =
      route.path === '/' && parentPath
        ? parentPath
        : parentPath + (route.path.startsWith('/') || !parentPath ? '' : '/') + route.path;
    const baseDepth = fullPath.split('/').filter(Boolean).length;

    // Redirect routes navigate immediately without rendering content.
    if (route.redirect) {
      const isRelative = route.redirect.startsWith('./') || route.redirect.startsWith('../');
      const target = isRelative ? route.redirect : parentPath + route.redirect;
      return <Route path={route.path} component={() => <Navigate href={target} />} />;
    }

    if (route.routes?.length) {
      // Layout route: stays mounted while sub-routes change.
      // Split THIS route's children into keepAlive leaves vs normal routes.
      // The keepAlive children are rendered persistently inside this layout component
      // and CSS-toggled; normal children go through the router outlet.
      const childDepth = fullPath.split('/').filter(Boolean).length + 1;
      const childKeepAliveRoutes = route.routes.filter((r) => r.keepAlive && !r.redirect && !r.routes?.length);
      const childNormalRoutes = route.routes.filter((r) => !r.keepAlive || r.redirect || r.routes?.length);
      const component = (props: ParentProps) => {
        const layout = RenderSchema({
          node: route,
          stores,
          registry,
          context: { $nav: { baseDepth } },
          // Inject outlet + keepAlive children into the { type: '$routes' } slot
          children: (
            <>
              {/* Always-mounted keepAlive routes — hidden when not active */}
              <For each={childKeepAliveRoutes}>
                {(kaRoute) => {
                  const kaPath = fullPath + kaRoute.path;
                  const kaDepth = kaPath.split('/').filter(Boolean).length;
                  const kaContent = RenderSchema({
                    node: kaRoute,
                    stores,
                    registry,
                    context: { $nav: { baseDepth: kaDepth } },
                  });
                  // Active when the URL segment at childDepth-1 matches this route's path segment
                  const segmentIndex = childDepth - 1;
                  const routeSegment = kaRoute.path.replace(/^\//, '');
                  const isActive = () => stores.routeStore.segments()[segmentIndex] === routeSegment;
                  return (
                    <div
                      style={{
                        display: isActive() ? 'contents' : 'none',
                        width: '100%',
                        height: '100%',
                      }}
                    >
                      {kaContent}
                    </div>
                  );
                }}
              </For>
              {/* Normal outlet — non-keepAlive routes render here */}
              {props.children}
            </>
          ),
        });
        return parentStack.reduceRight((child, meta) => {
          return RenderSchema({
            node: meta.node,
            stores,
            registry,
            context: { $nav: { baseDepth: meta.baseDepth } },
            children: child as JSX.Element,
          });
        }, layout) as JSX.Element;
      };
      // Emit stub Routes for keepAlive children so the router still matches their paths
      // (preventing 404); their actual content lives in the persistent divs above.
      const keepAliveStubs = childKeepAliveRoutes.map((r) => <Route path={r.path} component={() => null} />);
      const childRoutes = buildRoutes(stores, childNormalRoutes, fullPath, []);
      return (
        <Route path={route.path} component={component}>
          {keepAliveStubs}
          {childRoutes}
        </Route>
      );
    }

    // Normal leaf route
    const component = () => {
      const leaf = RenderSchema({ node: route, stores, registry, context: { $nav: { baseDepth } } });
      return parentStack.reduceRight((child, meta) => {
        return RenderSchema({
          node: meta.node,
          stores,
          registry,
          context: { $nav: { baseDepth: meta.baseDepth } },
          children: child as JSX.Element,
        });
      }, leaf) as JSX.Element;
    };
    return <Route path={route.path} component={component} />;
  });
}

export default function TemplateProvider() {
  // Gather up the stores
  const adamStore = useAdamStore();
  const aiStore = useAiStore();
  const appStore = useAppStore();
  const spaceStore = useSpaceStore();
  const themeStore = useThemeStore();
  const templateStore = useTemplateStore();
  const routeStore = useRouteStore();

  // Set CSS custom property on :root so any position:fixed elements can consume it
  onMount(() => {
    document.documentElement.style.setProperty('--we-sidebar-width', SHELL_SIDEBAR_WIDTH);
  });

  // Shell memory history — in-memory router for shell overlay views.
  // createMemoryHistory() gives us a history object we can drive programmatically
  // AND use as the source for a real <MemoryRouter> so $routes outlets work.
  const shellHistory = createMemoryHistory();
  const [shellPath, setShellPath] = createSignal('/');
  const shellSegments = createMemo(() => shellPath().split('/').filter(Boolean));
  // shellHistory.listen keeps shellPath signal in sync so schema $store expressions work
  shellHistory.listen((path) => setShellPath(path));
  const shellRouter: RouteStore = {
    currentPath: shellPath,
    segments: shellSegments,
    setNavigateFunction: () => {},
    setCurrentPath: () => {},
    navigate: (to: string) => shellHistory.set({ value: to, replace: false }),
  };

  // Reset shell router to '/' whenever the active shell view changes
  createEffect(() => {
    void templateStore.activeShellView();
    shellHistory.set({ value: '/', replace: true });
  });

  // Test store — isolated mock data + test perspective for test templates
  const testStore = createTestStore(adamStore.testPerspective);
  testStore.benchSetNavigate((to: string) => routeStore.navigate(to));

  // Console store for debugging actions in schema
  const consoleStore = {
    log: (...args: unknown[]) => console.log(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
    info: (...args: unknown[]) => console.info(...args),
  };

  // Model store for $action: "model.create" / "model.update" / "model.delete"
  // Wraps Ad4m static model methods with automatic perspective injection
  const modelStore = {
    create: (modelName: string, data: Record<string, unknown> = {}, options?: Record<string, unknown>) => {
      const Model = getModel(modelName);
      return Model.create(adamStore.currentPerspective()!, data, options);
    },
    update: (modelName: string, id: string, data: Record<string, unknown>) => {
      const Model = getModel(modelName);
      return Model.update(adamStore.currentPerspective()!, id, data);
    },
    delete: (modelName: string, id: string) => {
      const Model = getModel(modelName);
      return Model.delete(adamStore.currentPerspective()!, id);
    },
  };

  const stores: Stores = {
    adamStore,
    aiStore,
    appStore,
    spaceStore,
    themeStore,
    templateStore,
    routeStore,
    consoleStore,
    testStore,
    model: modelStore,
    $getModel: getModel, // Used by SchemaRenderer for $query descriptor → model class lookup
    $getModelForPerspective: getModelForPerspective, // UUID-aware fallback for dynamically-registered external models
    $onError: (msg: string) => toastService.error(msg),
  };

  // Shell schema — boot screen + sidebar chrome + chat panel (no template content)
  const shellSchema: TemplateSchema = {
    meta: { name: 'Shell', description: 'App shell chrome', icon: '' },
    children: [launcherUIRegistry.bootScreen, launcherUIRegistry.shell, launcherUIRegistry.aiChatSidebar],
  };

  // "Not found" fallback node for routed templates
  const notFoundNode = {
    type: 'Column',
    props: { ax: 'center', bg: 'neutral-0', p: '500' },
    children: [{ type: 'we-text', props: { size: '600' }, children: ['Page not found :_('] }],
  };

  const templateSchema = templateStore.currentTemplate;

  return (
    <>
      {/* Shell chrome — boot screen, sidebar, AI chat — rendered once outside the keyed Router
           so it never remounts on template switches. */}
      <RenderSchema node={shellSchema} stores={stores} registry={registry} />

      {/* Router — keyed on template ID so it fully remounts on template switch.
           This ensures buildRoutes is called fresh with the new template's route tree.
           Template switching is a rare user action so a full remount is acceptable. */}
      <Show when={templateSchema.id || 'empty'} keyed>
        {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
        {(_id) => (
          <Router root={createLayout(stores, shellRouter, shellHistory)}>
            {buildRoutes(stores, templateSchema.routes ?? [])}
            <Route
              path="*"
              component={() =>
                templateSchema.routes?.length ? RenderSchema({ node: notFoundNode, stores, registry }) : null
              }
            />
          </Router>
        )}
      </Show>
    </>
  );
}
