/**
 * `$views` — where a shell template says "the space's sections go here".
 *
 * ## Why a marker rather than a fixed route list
 *
 * A shell used to name its sections outright: `[aboutRoute, cardsRoute, graphRoute, …]`, a literal
 * array in the template, with a second literal array beside it driving the nav strip. Two
 * consequences, both of which had already happened by the time this was written:
 *
 * - **The two arrays drift.** The default template's header layout listed About and Settings and had
 *   Flux commented out; its sidebar layout listed Flux and neither of the other two. One template,
 *   two ideas of what a space contains.
 * - **A section is not forkable.** Wanting a seventh one meant forking the whole shell, and every
 *   improvement to the shell after that was a merge conflict. The unit of sharing was far too big
 *   for the thing people actually wanted to change.
 *
 * The marker inverts it. A shell declares *that* it has sections and where they render; **which**
 * sections is data resolved per space, and the nav strip reads the same resolved list — so the two
 * cannot disagree, because there is only one.
 *
 * ## What it expands to
 *
 * One route per view, at `/<segment>`, whose body is the view template's own root node. Plus an
 * index redirect to the first view, which is why the shell must not declare its own: the landing
 * section has to follow the list, or a community that turns off the section their shell happens to
 * redirect to lands on a 404 in their own space.
 *
 * Pure, and takes the resolved list as an argument, so it can be tested without a store, a router or
 * a renderer — which matters because its failure modes (a duplicate segment, a lost redirect, a
 * marker nested two levels down) are all shape, and none of them are visible in a render.
 */
import type { RouteSchema, TemplateSchema } from './types';

/** The `path` a shell writes to mark where its sections render. */
export const VIEWS_MARKER = '$views';

/**
 * A section, resolved: which view template renders, and at which segment.
 *
 * The pairing is the point — `segment` comes from the space's section list rather than from the
 * template, so two views offering the same default segment can coexist and a community can put
 * either at `/cards`. See `TemplateMeta.segment`.
 */
export type ResolvedView = {
  /** Stable view id — what a space's enabled/disabled list names. */
  id: string;
  /** URL segment, without a leading slash. */
  segment: string;
  /** The view template itself. */
  schema: TemplateSchema;
};

/** Keys that belong to a template but mean nothing on a route node, stripped on the way in. */
const TEMPLATE_ONLY = ['id', 'meta', 'author', 'templateVersion', 'schemaVersion', '_fromSpace'] as const;

/**
 * One view as a route.
 *
 * The view's root node becomes the route body directly rather than being wrapped in a container:
 * a wrapper would sit between the shell's layout and the view's own root, and every view would then
 * have to be written to survive an element it cannot see. `keepAlive` comes from the view's meta,
 * which is the only route-level decision a view is allowed to make about itself.
 */
function viewAsRoute(view: ResolvedView): RouteSchema {
  const node = { ...view.schema } as Record<string, unknown>;
  for (const key of TEMPLATE_ONLY) delete node[key];

  const route = { ...node, path: `/${view.segment}` } as RouteSchema;
  if (view.schema.meta?.keepAlive) route.keepAlive = true;
  return route;
}

/**
 * Replace every `$views` marker in a route tree with the resolved section list.
 *
 * Recurses into nested `routes`, because a shell may put its sections below a layout route — which
 * the default template does: sections live under `/space/:spaceId`, not at the root.
 *
 * An empty list expands to nothing rather than to a placeholder. Nothing here knows what a space
 * with no sections should say, and a pure function inventing one would put UI text somewhere no
 * template can restyle it. The resolver upstream is what guarantees the list is never empty.
 */
export function expandViewRoutes(routes: RouteSchema[], views: ResolvedView[]): RouteSchema[] {
  const out: RouteSchema[] = [];

  for (const route of routes) {
    if (route.path === VIEWS_MARKER) {
      if (!views.length) continue;
      // The index redirect belongs to the list, not to the shell — see the docblock.
      out.push({ path: '/', redirect: `./${views[0].segment}` } as RouteSchema);
      for (const view of views) out.push(viewAsRoute(view));
      continue;
    }

    out.push(route.routes?.length ? { ...route, routes: expandViewRoutes(route.routes, views) } : route);
  }

  return out;
}

/** Whether a route tree contains a marker at all — what tells a host it must resolve a view list. */
export function hasViewsMarker(routes: RouteSchema[] | undefined): boolean {
  if (!routes?.length) return false;
  return routes.some((route) => route.path === VIEWS_MARKER || hasViewsMarker(route.routes));
}
