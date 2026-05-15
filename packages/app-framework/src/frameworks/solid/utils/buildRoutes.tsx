/**
 * buildRoutes
 *
 * Recursively converts a RouteSchema tree into nested SolidJS <Route> JSX.
 *
 * Layout routes (routes with both `children` schema and sub-`routes`) become
 * SolidJS layout routes — the parent component stays mounted while only the
 * outlet swaps on sub-navigation.
 *
 * Routes marked `keepAlive: true` are rendered permanently inside their parent
 * layout and CSS-toggled (display: contents / none), so their component tree
 * (e.g. CesiumGlobe) never unmounts when navigating to sibling routes.
 *
 * Stub <Route> components are emitted for keepAlive paths so the router matches
 * them without 404, while the real content lives in the persistent div.
 */
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import type { Stores } from '@solid/types';
import { Navigate, Route } from '@solidjs/router';
import type { RouteSchema } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import type { JSX, ParentProps } from 'solid-js';
import { For } from 'solid-js';

export type ParentStackItem = { node: RouteSchema; fullPath: string; baseDepth: number };

export function buildRoutes(
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
      // Split THIS route's OWN children into keepAlive leaves vs normal routes.
      // keepAlive children are rendered persistently and CSS-toggled;
      // normal children go through the router outlet.
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

      // Emit stub Routes for keepAlive children so the router matches their paths
      // without 404; the actual content lives in the persistent CSS-toggled divs above.
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
