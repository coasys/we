/**
 * Containment, stored the way AD4M stores it.
 *
 * The rest of WE names containment as `CONTAINMENT_PREDICATE` — the backend-neutral key the manifest
 * declares and `schemas.entries` reports. Callers name it by relation (`{ id, relation: 'children' }`).
 * On this backend that relation is AD4M's own `ad4m://has_child`, so a container written here is a
 * container to anything else reading the perspective, and the executor's native containment
 * (ancestor wake-ups, declared roles) applies to it without a mapping triple.
 *
 * The neutral key is translated at the boundary, through this file and nowhere else: the decorators
 * the manifest compiles to, `relationPredicates.ts` (which every relation-named reference resolves
 * through, so `parent: { relation: 'children' }` lands on `has_child`), and a `parent` scope that
 * arrives already naming a predicate. The translation is idempotent, so a caller that already holds
 * the AD4M spelling — `containmentPredicate` reads it back off the native shape — passes through
 * unchanged.
 */
import type { Ad4mModel } from '@coasys/ad4m';
import { CONTAINMENT_PREDICATE } from '@we/backend-shared';

/** AD4M's containment predicate — what `CONTAINMENT_PREDICATE` is stored as on this backend. */
export const AD4M_CONTAINMENT_PREDICATE = 'ad4m://has_child';

/** A predicate in the form this backend stores it: containment becomes `has_child`, anything else is untouched. */
export function toAd4mPredicate(predicate: string): string;
export function toAd4mPredicate(predicate: string | undefined): string | undefined;
export function toAd4mPredicate(predicate: string | undefined): string | undefined {
  return predicate === CONTAINMENT_PREDICATE ? AD4M_CONTAINMENT_PREDICATE : predicate;
}

/**
 * An anchor (`{ id, predicate }`, or the traverse form's `{ ids, predicate, … }`) with its predicate
 * in this backend's terms. The model form, which names a relation instead of a predicate, carries
 * nothing to translate — the relation's decorator already says `has_child`.
 */
export function toAd4mScope<T>(scope: T): T {
  if (!scope || typeof scope !== 'object' || !('predicate' in scope)) return scope;
  const predicate = (scope as { predicate?: unknown }).predicate;
  if (typeof predicate !== 'string') return scope;
  const translated = toAd4mPredicate(predicate);
  return translated === predicate ? scope : { ...scope, predicate: translated };
}

/** `options.parent` translated, leaving the rest of the object as it was. */
function withAd4mParent<O>(options: O): O {
  if (!options || typeof options !== 'object' || !('parent' in options)) return options;
  const parent = (options as { parent?: unknown }).parent;
  const translated = toAd4mScope(parent);
  return translated === parent ? options : { ...options, parent: translated };
}

/**
 * Where each `Ad4mModel` static that takes a `parent` scope carries it, by argument position. The
 * union reads, `findAllOf` and `queryOf`, take their classes second and the query third.
 */
const PARENT_ARGUMENT: Record<string, number> = {
  create: 2,
  findAll: 1,
  findOne: 1,
  findAllAndCount: 1,
  count: 1,
  query: 1,
  paginate: 3,
  findAllOf: 2,
  queryOf: 2,
};

const INSTALLED = Symbol.for('we.ad4m.containmentPredicate');

/**
 * Make every model's `parent` scope accept the neutral containment key.
 *
 * Callers reach the model statics directly — through `@we/entities`' class proxy, not through any
 * function in this package — so the translation has to sit on the statics themselves. Patched once
 * on `Ad4mModel`, it reaches every class that extends it: generated, compiled from the manifest, or
 * built from a foreign shape. Same approach, and the same reason, as `installClearOnEmpty`.
 */
export function installContainmentPredicate(Model: typeof Ad4mModel): void {
  const statics = Model as unknown as Record<string | symbol, unknown>;
  if (statics[INSTALLED]) return;
  statics[INSTALLED] = true;

  for (const [name, position] of Object.entries(PARENT_ARGUMENT)) {
    const original = statics[name];
    if (typeof original !== 'function') continue;
    statics[name] = function (this: unknown, ...args: unknown[]) {
      if (args.length > position) args[position] = withAd4mParent(args[position]);
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
  }
}
