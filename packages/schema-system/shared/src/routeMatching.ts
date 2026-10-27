/**
 * Whether an address is one of a template's own pages.
 *
 * Asked when the template on screen changes: the address belonged to the one before, and only a
 * page the new template declares is worth keeping. One it does not declare would land on its
 * catch-all ("No such board."), which is a page about a mistake nobody made. So a catch-all route
 * (`*`) does not count as a match here, though the router would happily render it.
 */
import type { RouteSchema } from './types';

/** Whether `segments` (the address below the template's root) is a page `routes` declares. */
export function isTemplatePage(routes: readonly RouteSchema[], segments: readonly string[]): boolean {
  return routes.some((route) => matches(route, segments));
}

function matches(route: RouteSchema, segments: readonly string[]): boolean {
  const pattern = (route.path ?? '').split('/').filter(Boolean);
  if (pattern.some((part) => part.startsWith('*'))) return false;
  if (pattern.length > segments.length) return false;
  if (pattern.some((part, i) => !part.startsWith(':') && part !== segments[i])) return false;
  const rest = segments.slice(pattern.length);
  // A layout route is a page only through one of its own: the router renders it for a child it has.
  if (route.routes?.length) return isTemplatePage(route.routes, rest);
  return rest.length === 0;
}
