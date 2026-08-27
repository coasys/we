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
 * One route per view, at `/<segment>`, whose body is the view template's own root node.
 *
 * **No index redirect, and no route removed for a section that is switched off.** The list handed
 * in is every view that *could* render here, not the ones currently enabled — because the route
 * table remounts the main Router when it changes, and the Router's root mounts the whole shell
 * overlay. Deriving the table from a set of switches meant flicking one rebuilt the application:
 * a member removing a section from that space's settings page lost their scroll position, any open
 * editor and every piece of in-flight form state.
 *
 * Which sections a space *offers* is applied at render time instead, two ways, because one is not
 * enough. An effect moves you off a section that is not among them — but it can only do that when
 * there is somewhere to go, and a space with every section switched off leaves it nowhere. So each
 * body is also gated on membership (see {@link ViewGate}), which is what stops a removed section
 * from carrying on rendering at a URL nothing points at.
 *
 * Pure, and takes the resolved list as an argument, so it can be tested without a store, a router or
 * a renderer — which matters because its failure modes (a duplicate segment, a lost redirect, a
 * marker nested two levels down) are all shape, and none of them are visible in a render.
 */
import type { RouteSchema, SchemaNode, TemplateSchema } from './types';

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
 * Where one template stops and another begins, marked in the DOM.
 *
 * A view is a *different template* from the shell around it, and nothing downstream could tell.
 * That is invisible until something walks the rendered tree expecting one schema to explain all of
 * it — which the visual editor does: it finds the nearest `data-we-node-id` and looks it up in the
 * template being edited. A view's nodes carry no such id, so a click inside one walked straight past
 * the whole section and selected a *shell* node several levels up. Nothing said why, so a section
 * read as a hole in the editor rather than as a boundary.
 *
 * The name rides along beside the id so a reader of the DOM needs no second lookup — and, more to
 * the point, so `@we/editor` can say which section it is without taking a dependency on the view
 * registry to find out.
 */
export const VIEW_BOUNDARY_ATTR = 'data-we-view';
export const VIEW_BOUNDARY_NAME_ATTR = 'data-we-view-name';

/**
 * Put the boundary where the DOM will actually show it.
 *
 * On the view's own root wherever that root is a Solid component, which costs nothing: the renderer
 * spreads unrecognised props onto the element, so the attribute simply appears.
 *
 * A custom-element root is the exception and needs the wrapper. The renderer delivers a web
 * component's props as **DOM properties** rather than attributes (`hostRef[key] = …`), so an
 * attribute selector would never match one and the boundary would go missing on exactly the views
 * nobody tested — silently, and looking like the bug this exists to remove. `display: contents`
 * generates no box, so the wrapper costs a DOM node and no layout.
 */
function markBoundary(node: Record<string, unknown>, view: ResolvedView): Record<string, unknown> {
  const marks = {
    [VIEW_BOUNDARY_ATTR]: view.id,
    [VIEW_BOUNDARY_NAME_ATTR]: view.schema.meta?.name ?? view.id,
  };

  // The renderer's own test for a custom element — see `isWebComponent` in SchemaRenderer.
  if (!(typeof node.type === 'string' && node.type.includes('-'))) {
    return { ...node, props: { ...((node.props as Record<string, unknown>) ?? {}), ...marks } };
  }

  return { type: 'Column', props: { styles: { display: 'contents' }, ...marks }, children: [node] };
}

/**
 * What decides, at render time, whether a section is one this space offers.
 *
 * The table holds a route for every view that *could* render here — that is what keeps a toggle from
 * rebuilding it — so something else has to answer whether a given section is actually in this space.
 * Doing it in the body rather than by omitting the route is the difference between a question
 * answered on every render and one answered by rebuilding the application.
 *
 * The host supplies both halves. `activeIds` is a `$store` path to the ids currently offered, and
 * `notInSpace` is what to draw instead — passed in rather than written here, because this file has
 * no business inventing UI text that no template could restyle.
 */
export type ViewGate = {
  /** `$store` path to the ids of the sections this space currently offers. */
  activeIds: string;
  /** Rendered in place of a section the space does not offer. */
  notInSpace: SchemaNode;
};

/**
 * One view as a route.
 *
 * The view's root node becomes the route body directly rather than being wrapped in a container:
 * a wrapper would sit between the shell's layout and the view's own root, and every view would then
 * have to be written to survive an element it cannot see. `keepAlive` comes from the view's meta,
 * which is the only route-level decision a view is allowed to make about itself.
 *
 * With a gate the body becomes a `$if` instead, which is a wrapper — but one every view already has
 * to survive, since a route body is not a place a view can reach out of anyway.
 */
function viewAsRoute(view: ResolvedView, gate?: ViewGate): RouteSchema {
  const stripped = { ...view.schema } as Record<string, unknown>;
  for (const key of TEMPLATE_ONLY) delete stripped[key];

  // Marked before the gate rather than after: the boundary belongs to the *view*, and the gate's
  // other arm is the host saying this space does not have this section — which is chrome, not a
  // section, and should behave like the rest of the shell.
  const node = markBoundary(stripped, view);

  const body: Record<string, unknown> = gate
    ? {
        type: '$if',
        props: {
          condition: { $in: [view.id, { $store: gate.activeIds }] },
          then: node,
          else: gate.notInSpace,
        },
      }
    : node;

  const route = { ...body, path: `/${view.segment}` } as RouteSchema;
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
 * template can restyle it.
 */
export function expandViewRoutes(routes: RouteSchema[], views: ResolvedView[], gate?: ViewGate): RouteSchema[] {
  const out: RouteSchema[] = [];

  for (const route of routes) {
    if (route.path === VIEWS_MARKER) {
      for (const view of views) out.push(viewAsRoute(view, gate));
      continue;
    }

    out.push(route.routes?.length ? { ...route, routes: expandViewRoutes(route.routes, views, gate) } : route);
  }

  return out;
}

/** Whether a route tree contains a marker at all — what tells a host it must resolve a view list. */
export function hasViewsMarker(routes: RouteSchema[] | undefined): boolean {
  if (!routes?.length) return false;
  return routes.some((route) => route.path === VIEWS_MARKER || hasViewsMarker(route.routes));
}
