import {
  type ResolvedView,
  type RouteSchema,
  type SchemaNode,
  SPACE_ROUTE_PATH,
  type TemplateSchema,
  VIEWS_MARKER,
} from '@we/schema-shared';

/**
 * The page of a space that draws one module part — where `ModuleStoreDeps.showPart` sends somebody.
 *
 * A module that offers a part both as a panel and as something a template places on a page cannot
 * know where any template put it: templates cannot import modules, and a part is named by a string
 * the host resolves. The host holds the template, so the host answers. Pure and separate for the
 * reason `recordNavigation.ts` is: a wrong answer is silent both ways, a window over a page that
 * already draws the thing, or a page that does not.
 *
 * Read from the template as written — `$part` nodes still in it — rather than the route table the
 * router is given, which has every part expanded into its fragment and nothing left to find.
 */

/** Keys a route carries that are not part of what it draws. */
const NOT_DRAWN = new Set(['routes', 'path', 'redirect', 'keepAlive']);

/** Whether `node`, or anything it holds, places `part` — following `$ref` into the template's `$defs`. */
function places(node: unknown, part: string, defs: Record<string, SchemaNode>, seen: Set<string>): boolean {
  if (Array.isArray(node)) return node.some((child) => places(child, part, defs, seen));
  if (!node || typeof node !== 'object') return false;
  const record = node as { type?: unknown; props?: { id?: unknown; def?: unknown } };
  if (record.type === '$part' && record.props?.id === part) return true;
  if (record.type === '$ref' && typeof record.props?.def === 'string' && !seen.has(record.props.def)) {
    seen.add(record.props.def);
    if (places(defs[record.props.def], part, defs, seen)) return true;
  }
  // Children, slots, and an `$if`'s branches in its props: wherever a node can hold another.
  return Object.entries(node).some(([key, value]) => !NOT_DRAWN.has(key) && places(value, part, defs, seen));
}

/** A route path as a piece of the address, without its slashes: `''` for the index. */
const segmentOf = (path: string): string => path.replace(/^\/+|\/+$/g, '');

/**
 * The first page that draws `part`, as the part of the address below `/space/<id>`: `''` for the
 * space itself, `'talk'` for `/space/<id>/talk`. `null` where no page draws it.
 *
 * - **Sections** (`$views`) are the space's own list — `views` is the one the space's navigation shows
 *   — so a section the space does not have is never the answer.
 * - **A page reached only with a value** — a `:param`, a catch-all — names no one address, and a
 *   redirect draws nothing; neither is an answer.
 * - **Behind a condition** still counts: the Coasys space draws its Feed on its index only while the
 *   channel named is the root one, which is what the index shows when none is named.
 */
export function pageOfPart(
  template: Pick<TemplateSchema, 'routes' | '$defs'> | undefined,
  views: readonly ResolvedView[],
  part: string,
): string | null {
  const defs = template?.$defs ?? {};

  function search(routes: readonly RouteSchema[], above: string): string | null {
    for (const route of routes) {
      if (route.path === VIEWS_MARKER) {
        const view = views.find((candidate) => places(candidate.schema, part, defs, new Set()));
        if (view) return [above, view.segment].filter(Boolean).join('/');
        continue;
      }
      if (route.redirect) continue;
      // A template that lays out its sections says where the space is itself; that prefix is the space.
      const own = route.path === SPACE_ROUTE_PATH ? '' : segmentOf(route.path);
      if (own.includes(':') || own.includes('*')) continue;
      const here = [above, own].filter(Boolean).join('/');
      if (places(route, part, defs, new Set())) return here;
      const below = route.routes?.length ? search(route.routes, here) : null;
      if (below !== null) return below;
    }
    return null;
  }

  return search(template?.routes ?? [], '');
}
