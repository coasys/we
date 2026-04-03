import { launcherUIRegistry } from '@shared/registries/launcherUIRegistry';
import { getModel } from '@shared/registries/modelRegistry';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import {
  useAdamStore,
  useModalStore,
  useRouteStore,
  useSpaceStore,
  useTemplateStore,
  useThemeStore,
} from '@solid/stores';
import type { Stores } from '@solid/types';
import { Route, Router, useLocation, useNavigate } from '@solidjs/router';
import type { RouteSchema, TemplateSchema } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import type { JSX, ParentProps } from 'solid-js';
import { createEffect, createMemo } from 'solid-js';

type FlattenedRoute = { path: string; component: () => JSX.Element };
type ParentStackItem = { node: RouteSchema; fullPath: string; baseDepth: number };

// Creates the root layout component for the router
function createLayout(stores: Stores, schema: TemplateSchema) {
  return function Layout(props: ParentProps): JSX.Element {
    // Access the router hooks now we're inside the router context
    const navigate = useNavigate();
    const location = useLocation();

    // Store the navigate function in the Route store so schema actions can use it
    createEffect(() => stores.routeStore.setNavigateFunction(() => navigate));

    // React to route changes and update relevant stores
    createEffect(() => stores.routeStore.setCurrentPath(location.pathname));

    return <RenderSchema node={schema} stores={stores} registry={registry} children={props.children} />;
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
    const fullPath = route.path === '/' && parentPath ? parentPath : parentPath + route.path;
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

    // If the route has children, recursively flatten them too, otherwise just return the route
    return route.routes?.length
      ? flattenRoutes(stores, route.routes, fullPath, [...parentStack, currentMeta])
      : [{ path: fullPath, component: buildComponent }];
  });
}

export default function TemplateProvider() {
  // Gather up the stores
  const adamStore = useAdamStore();
  const spaceStore = useSpaceStore();
  const modalStore = useModalStore();
  const themeStore = useThemeStore();
  const templateStore = useTemplateStore();
  const routeStore = useRouteStore();

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
    spaceStore,
    modalStore,
    themeStore,
    templateStore,
    routeStore,
    consoleStore,
    model: modelStore,
    $getModel: getModel, // Used by SchemaRenderer for $query descriptor → model class lookup
  };

  // Get the current template schema and build its routes
  const templateSchema = templateStore.currentTemplate;
  const routes = createMemo(() => flattenRoutes(stores, templateSchema.routes ?? []));

  // Build the full app schema - only include template when user is logged in
  const appSchema: TemplateSchema = {
    meta: { name: 'App Layout', description: 'Root application layout', icon: '' },
    // theme: {
    //   primaryHue: 210, // 350, //  teal/cyan instead of the default purple
    //   neutralSaturation: '10%', // desaturate UI colors for a more muted look, to let the content pop - feels more "app-like" and less "webpage-like"
    //   saturation: '70%', // bump saturation so it pops
    // },
    children: [
      launcherUIRegistry.bootScreen,
      launcherUIRegistry.shell,
      {
        type: '$if',
        props: {
          condition: { $eq: [{ $store: 'adamStore.bootState' }, 'ready'] },
          then: {
            type: 'Column',
            props: { ml: '66px', width: 'calc(100% - 66px)' },
            children: [templateSchema],
          },
        },
      },
    ],
  };

  // Return the router with the root layout and routes
  return (
    <Router root={createLayout(stores, appSchema)}>
      {routes().map((route) => (
        <Route path={route.path} component={route.component} />
      ))}
      {/* Fallback in case the schema doesn't define a wildcard route */}
      {!routes().find((route) => route.path === '*') && (
        <Route
          path="*"
          component={() =>
            RenderSchema({
              node: {
                type: 'Column',
                props: { ax: 'center', bg: 'neutral-0', p: '500' },
                children: [{ type: 'we-text', props: { size: '600' }, children: ['Page not found :_('] }],
              },
              stores,
              registry,
            })
          }
        />
      )}
    </Router>
  );
}
