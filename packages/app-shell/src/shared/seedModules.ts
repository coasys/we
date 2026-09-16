/**
 * What a seed says about modules, read one way.
 *
 * A seed's `modules` entry is a string or an object, because a bare id is what every seed had and
 * `{ id, enabled: false }` is the one thing a bare id cannot say. Every reader goes through here so
 * the two spellings are one list everywhere else.
 */
import type { WeSeedFile, WeSeedModule } from '../types/seed';

/** One module entry, whichever way it was written. */
export function seedModuleEntry(entry: string | WeSeedModule): WeSeedModule {
  return typeof entry === 'string' ? { id: entry } : entry;
}

/** Every module id a seed ships, in seed order. */
export function seedModuleIds(seed: Pick<WeSeedFile, 'modules'>): string[] {
  return (seed.modules ?? []).map((entry) => seedModuleEntry(entry).id);
}

/**
 * The modules a space has on until its community decides — what `Space.enabledModules` resolves to
 * while unset.
 *
 * Every shipped module unless the seed said `enabled: false`. It used to be every *registered*
 * module, so the first module a deployment added appeared in every existing space until somebody
 * opened settings. A deployment now says which modules a space starts with, and a module it ships
 * for people to opt into stays off until they do.
 */
export function seedDefaultEnabledModules(seed: Pick<WeSeedFile, 'modules'>): string[] {
  return (seed.modules ?? [])
    .map(seedModuleEntry)
    .filter((entry) => entry.enabled !== false)
    .map((entry) => entry.id);
}
