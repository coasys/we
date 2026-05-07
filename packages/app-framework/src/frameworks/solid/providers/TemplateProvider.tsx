import { launcherUIRegistry } from '@shared/registries/launcherUIRegistry';
import { getModel, getModelForPerspective } from '@shared/registries/modelRegistry';
import { createTestStore } from '@shared/schemas/shell/tests/testStore';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
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
import { Navigate, Route, Router, useLocation, useNavigate } from '@solidjs/router';
import { toastService } from '@we/components/solid';
import type { RouteSchema, TemplateSchema } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import type { JSX, ParentProps } from 'solid-js';
import { createEffect, createMemo, For, Show } from 'solid-js';

type FlattenedRoute = { path: string; component: () => JSX.Element; redirect?: string };
type ParentStackItem = { node: RouteSchema; fullPath: string; baseDepth: number };

// Creates the root layout component for the router
function createLayout(stores: Stores, shellSchema: TemplateSchema) {
  return function Layout(props: ParentProps): JSX.Element {
    // Access the router hooks now we're inside the router context
    const navigate = useNavigate();
    const location = useLocation();

    // Store the navigate function in the route store so schema actions can use it
    createEffect(() => stores.routeStore.setNavigateFunction(() => navigate));

    // React to route changes and update relevant stores
    createEffect(() => stores.routeStore.setCurrentPath(location.pathname));

    const aiRightMargin = () => (stores.aiStore.isOpen() ? '400px' : '0');
    const contentWidth = () => (stores.aiStore.isOpen() ? 'calc(100% - 72px - 400px)' : 'calc(100% - 72px)');

    return (
      <>
        {/* Shell chrome (boot screen, sidebar, chat panel) — always rendered */}
        <RenderSchema node={shellSchema} stores={stores} registry={registry} />

        {/* Content viewport — shared by templates and app iframes */}
        <div
          style={{
            position: 'fixed',
            top: '0',
            left: '72px',
            right: aiRightMargin(),
            width: contentWidth(),
            height: '100vh',
            transition: 'right 300ms ease, width 300ms ease',
          }}
        >
          {/* Persistent app iframes — always mounted, CSS-toggled visible/hidden */}
          <For each={stores.appStore.apps()}>
            {(app) => (
              <div
                style={{
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

          {/* Template content area — hidden when an app is active */}
          <div
            style={{
              display: stores.appStore.activeAppId() ? 'none' : 'block',
              width: '100%',
              height: '100%',
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
        </div>
      </>
    );
  };
}

// Recursively flattens nested route schemas into a single array of routes with full paths
function flattenRoutes(
  stores: Stores,
  routes: RouteSchema[],
  parentPath = '',
  parentStack: ParentStackItem[] = [],
): FlattenedRoute[] {
  return routes.flatMap((route) => {
    // Get the full route path and base depth (used for relative navigation)
    const fullPath =
      route.path === '/' && parentPath
        ? parentPath
        : parentPath + (route.path.startsWith('/') || !parentPath ? '' : '/') + route.path;
    const baseDepth = fullPath.split('/').filter(Boolean).length;
    const currentMeta = { node: route, fullPath, baseDepth };

    // Build the route component
    const buildComponent = () => {
      // Render the leaf with its own context
      const leaf = RenderSchema({ node: route, stores, registry, context: { $nav: { baseDepth } } });

      // Wrap with parents, each rendered with its own baseDepth context
      return parentStack.reduceRight((child, meta) => {
        const context = { $nav: { baseDepth: meta.baseDepth } };
        return RenderSchema({ node: meta.node, stores, registry, context, children: child as JSX.Element });
      }, leaf) as JSX.Element;
    };

    // Redirect routes don't render content — they navigate immediately
    if (route.redirect) {
      const target = parentPath + route.redirect;
      return [{ path: fullPath, component: () => <Navigate href={target} />, redirect: target }];
    }

    // If the route has children, recursively flatten them too, otherwise just return the route
    return route.routes?.length
      ? flattenRoutes(stores, route.routes, fullPath, [...parentStack, currentMeta])
      : [{ path: fullPath, component: buildComponent }];
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
      return Model.create(spaceStore.perspective()!, data, options);
    },
    update: (modelName: string, id: string, data: Record<string, unknown>) => {
      const Model = getModel(modelName);
      return Model.update(spaceStore.perspective()!, id, data);
    },
    delete: (modelName: string, id: string) => {
      const Model = getModel(modelName);
      return Model.delete(spaceStore.perspective()!, id);
    },
  };

  const stores = {
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

  // Get the current template schema and build its routes
  const templateSchema = templateStore.currentTemplate;
  const routes = createMemo(() => {
    // Read template ID to track it as a reactive dependency — routes rebuild on template switch
    void templateSchema.id;
    return flattenRoutes(stores, templateSchema.routes ?? []);
  });

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

  // Return the router with the root layout and routes
  return (
    <Router root={createLayout(stores, shellSchema)}>
      {routes().map((route) => (
        <Route path={route.path} component={route.component} />
      ))}
      <Route
        path="*"
        component={() => (routes().length > 0 ? RenderSchema({ node: notFoundNode, stores, registry }) : null)}
      />
    </Router>
  );
}
