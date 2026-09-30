export type SchemaNode = {
  type?: string;
  props?: Record<string, unknown>;
  children?: unknown[];
  [key: string]: unknown;
};
export type ExternalTemplate = SchemaNode & { id?: string; routes?: Array<SchemaNode & { path?: string }> };

/**
 * The template alone, with no shell around it: `?bare=1`.
 *
 * The full host mounts a template as a space's content, inside the sidebar and the module rail, and
 * that content area is a query container — so a template cannot even paint over the chrome with a
 * fixed-position root. A mockup of a screen that is not a space (an onboarding step, an account
 * page) needs the viewport to itself. Bare mode renders the template's root with its `$routes`
 * outlet replaced by the one route asked for, through the same renderer and the same component
 * registry as the app, inside a surface as the app provides, over empty stores — which is what a
 * static mockup reads.
 *
 * The route asked for, else `/`, else the first the template declares; `path` says which it was.
 * The outlet may sit at any depth, as it may in the app — a header and a tab strip above it is the
 * usual shape — so the swap walks the children rather than looking only at the root's.
 */
export function bareNode(template: ExternalTemplate, requested: string | null): { node: SchemaNode; path?: string } {
  const routes = template.routes ?? [];
  const route = routes.find((r) => r.path === (requested ?? '/')) ?? routes[0];
  const { routes: _routes, id: _id, schemaVersion: _v, meta: _meta, ...root } = template;
  if (!route) return { node: root };

  const swap = (node: SchemaNode): SchemaNode =>
    node.children
      ? {
          ...node,
          children: node.children.map((child) => {
            if (!child || typeof child !== 'object') return child;
            return (child as SchemaNode).type === '$routes' ? route : swap(child as SchemaNode);
          }),
        }
      : node;
  return { node: swap(root), path: route.path };
}
