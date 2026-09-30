/**
 * The built-in views this build ships — a space's sections, as data.
 *
 * The sibling of `templateRegistry`, and the split between them is the point. A **template** is a
 * whole interface: chrome, arrangement, route table. A **view** is one section inside one. Both are
 * schemas the renderer walks, both are installable and forkable, and they are separate registries
 * because they answer different questions — "what does this space look like" versus "what does this
 * space have in it".
 *
 * ## Why the set is a deployment's choice
 *
 * Same mechanism as templates and modules: `we-seed.json`'s `views` list drives
 * `bundledViews.generated.ts`, so a view the seed does not name is never imported and never reaches
 * the bundle. A deployment building a project tool rather than a community platform ships the tasks
 * and calendar views and pays nothing for the globe.
 *
 * ## What "built in" buys a view, and what it does not
 *
 * Only that it was compiled in rather than installed at runtime. It confers no privilege: a built-in
 * view is resolved, enabled, disabled and overridden through exactly the same list as one installed
 * from the marketplace, and renders against the same space tier of the store surface. There is no
 * path by which shipping in the bundle grants a view something a stranger's view cannot have — which
 * is what makes the marketplace category honest rather than decorative.
 */
import { bundledViews } from './bundledViews.generated';

export const viewRegistry = bundledViews;

export type ViewId = keyof typeof viewRegistry;

export function isValidViewId(key: unknown): key is ViewId {
  return typeof key === 'string' && key in viewRegistry;
}

/**
 * The order sections appear in when nobody has said otherwise.
 *
 * The registry's own insertion order, which is the seed's order — so a deployment arranges its
 * default section list by writing the `views` array in the order it wants, and needs no second
 * mechanism to do it.
 */
export function defaultViewOrder(): string[] {
  return Object.keys(viewRegistry);
}
