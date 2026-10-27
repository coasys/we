import { hasViewsMarker, isTemplatePage, type RouteSchema } from '@we/schema-shared';

/**
 * Whether a change of template should take the address to the new template's root.
 *
 * Only on a change (`previous` set and different), only in a space, only for a template that routes
 * itself (one hosting the space's sections is kept on one elsewhere), and only when the address is
 * not one of its pages. See the effect in `TemplateProvider` for why each.
 */
export function landsOnRoot(options: {
  previous: string | undefined;
  current: string;
  routes: readonly RouteSchema[];
  segments: readonly string[];
  templateSegments: readonly string[];
}): boolean {
  const { previous, current, routes, segments, templateSegments } = options;
  if (previous === undefined || previous === current) return false;
  if (hasViewsMarker(routes as RouteSchema[]) || !routes.length) return false;
  if (segments[0] !== 'space') return false;
  return !isTemplatePage(routes, templateSegments);
}
