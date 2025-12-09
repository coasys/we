import { Route, Router, useLocation, useNavigate } from '@solidjs/router';
import { PageNotFound } from '@we/pages/solid';
import type { RouteSchema, TemplateSchema } from '@we/schema-renderer/shared';
import { RenderSchema } from '@we/schema-renderer/solid';
import type { JSX, ParentProps } from 'solid-js';
import { createEffect, createMemo } from 'solid-js';

import { componentRegistry as registry } from '@/registries/componentRegistry';
import { useAdamStore, useModalStore, useRouteStore, useSpaceStore, useTemplateStore, useThemeStore } from '@/stores';
import type { Stores } from '@/types';

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
  const stores = { adamStore, spaceStore, modalStore, themeStore, templateStore, routeStore };

  // Get the current template schema
  const templateSchema = templateStore.currentTemplate;

  const appSchema: TemplateSchema = {
    meta: { name: 'AppLayout', description: 'Root application layout', icon: '' },
    children: [
      {
        type: '$if',
        props: {
          condition: { $ne: [{ $store: 'adamStore.bootState' }, 'ready'] },
          then: {
            type: 'Column',
            props: {
              width: '100%',
              height: '100%',
              ax: 'center',
              ay: 'center',
              gap: '400',
              bg: '#ddd',
              position: 'absolute',
              opacity: 0.8,
            },
            children: [
              { type: 'we-text', props: { size: '800', weight: '600' }, children: ['WE'] },
              {
                type: '$if',
                props: {
                  condition: { $eq: [{ $store: 'adamStore.bootState' }, 'initialising'] },
                  then: {
                    type: 'Row',
                    props: { gap: '300', ay: 'center' },
                    children: [
                      { type: 'we-spinner', props: { size: 'sm' } },
                      { type: 'we-text', children: ['Initialising AD4M client...'] },
                    ],
                  },
                },
              },
              {
                type: '$if',
                props: {
                  condition: { $eq: [{ $store: 'adamStore.bootState' }, 'login'] },
                  then: {
                    type: 'Column',
                    props: { gap: '400', ax: 'center' },
                    children: [
                      { type: 'we-icon', props: { name: 'key', color: 'ui-600', size: 'lg' } },
                      { type: 'we-text', props: { size: '600', weight: '600' }, children: ['Unlock your agent'] },
                      {
                        type: 'we-input',
                        props: {
                          placeholder: 'Password...',
                          type: 'password',
                          value: { $store: 'adamStore.password' },
                          onInput: { $action: 'adamStore.setPassword' },
                        },
                      },
                      { type: 'we-button', props: { text: 'Login', onClick: { $action: 'adamStore.unlockAgent' } } },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
      templateSchema,
    ],
  };

  // Build the routes
  const routes = createMemo(() => flattenRoutes(stores, templateSchema.routes ?? []));

  // Return the router with the root layout and routes
  return (
    <Router root={createLayout(stores, appSchema)}>
      {routes().map((route) => (
        <Route path={route.path} component={route.component} />
      ))}
      {/* Fallback incase the schema doesn't define a wildcard route */}
      {!routes().find((route) => route.path === '*') && <Route path="*" component={() => <PageNotFound />} />}
    </Router>
  );
}
