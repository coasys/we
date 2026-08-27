/**
 * The shell's own views — profile, settings, the marketplace, the landing page — and how one is
 * looked up.
 *
 * Each view names the stores it renders against through an optional factory, so it gets exactly what
 * it needs and nothing more. Returning `$schema` from that factory overrides the rendered schema
 * with a mutable reactive store, which is how the schema-tests view makes mutations visible.
 *
 * ## Two records, not one
 *
 * Most views are ordinary chrome and are cheap to carry, so they are imported and held eagerly.
 * `lazyShellViews` is for the ones whose *code* should not exist in a build that cannot open them —
 * currently just the schema-test harness, which is ~97KB of test schemas. A lazy entry is a
 * `() => import(...)`, and the dynamic import is the whole mechanism: it is what makes the module a
 * separate chunk rather than part of the main bundle. Gating a static import behind a boolean does
 * not do that, however true the boolean is — see `schemaTestsView`.
 */
import { landingPageTemplate, marketplaceTemplate, profileTemplate, settingsTemplate } from '@shared/schemas';
import type { RouteStore } from '@solid/stores/RouteStore';
import type { Stores } from '@solid/types';
import type { TemplateSchema } from '@we/schema-shared';
import { type Accessor, createResource } from 'solid-js';

export type ShellViewEntry = {
  schema: TemplateSchema;
  stores?: (base: Stores, shellRouteStore: RouteStore) => Partial<Stores> & { $schema?: TemplateSchema };
};

/** Views held in the main bundle. Ordinary chrome — every build can open all of them. */
const shellViews: Record<string, ShellViewEntry> = {
  'landing-page': { schema: landingPageTemplate },
  marketplace: { schema: marketplaceTemplate },
  profile: { schema: profileTemplate },
  settings: { schema: settingsTemplate },
};

/**
 * Views fetched on demand, and only in a build that has them.
 *
 * The `import.meta.env.DEV` guard here is doing the job it can actually do: keeping the *loader*
 * out, so a production build has no route to the chunk. The chunk's absence from the main bundle is
 * the dynamic import's doing, not the guard's.
 */
const lazyShellViews: Record<string, () => Promise<ShellViewEntry>> = {
  ...(import.meta.env.DEV
    ? { 'schema-tests': () => import('./schemaTestsView').then((module) => module.schemaTestsView()) }
    : {}),
};

/**
 * Look up a view by id.
 *
 * Returns `null` for an id this build has no view for — which is the honest answer for `schema-tests`
 * in production, and the same answer an unknown id has always got. Otherwise an accessor, undefined
 * until a lazy view's chunk arrives; an eager one is never undefined, so nothing about the common
 * path becomes asynchronous.
 */
export function resolveShellView(id: string): Accessor<ShellViewEntry | undefined> | null {
  const eager = shellViews[id];
  if (eager) return () => eager;
  const load = lazyShellViews[id];
  if (!load) return null;
  const [entry] = createResource(load);
  return entry;
}
