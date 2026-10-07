/**
 * A template written in code, with the ids it has in every build.
 *
 * A built-in is TypeScript run at load, so there is nowhere to keep an id between runs. Minting them
 * at random would give every node of every built-in a new identity on every launch, and anything
 * that names a node — a selection, a comment, a fork compared with its original — would stop
 * resolving the moment the app restarted. So they are worked out from the template's id and each
 * node's path instead; see `deriveNodeIds` in schema-shared.
 *
 * Cloned through JSON first, because an authored template reuses objects — a fragment called twice
 * with the same arguments returns the same one — and one object standing in two places can hold
 * only one id. Cached per source object, since the registries that call this are read repeatedly.
 */
import { deriveNodeIds, type SchemaNode, type TemplateSchema } from '@we/schema-shared';

import { deepClone } from '../utils';

const derived = new WeakMap<object, Map<string, TemplateSchema>>();

export function withDerivedIds<T extends TemplateSchema>(template: T, seed: string): T {
  let bySeed = derived.get(template);
  if (!bySeed) derived.set(template, (bySeed = new Map()));
  let out = bySeed.get(seed);
  if (!out) {
    out = deriveNodeIds(deepClone(template) as SchemaNode, seed) as TemplateSchema;
    bySeed.set(seed, out);
  }
  return out as T;
}

/** Every template of a registry, with its derived ids, seeded by its key. */
export function withDerivedIdsAll<T extends TemplateSchema>(registry: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(registry).map(([id, template]) => [id, withDerivedIds(template, id)]));
}
