/**
 * `parent: { id, relation }`, on AD4M's model layer.
 *
 * The contract names where a record goes by the relation it joins (`ParentRef`); AD4M's `Ad4mModel`
 * takes a predicate, or a model class neutral code cannot hold. So every static that takes a `parent`
 * — `create`, and the reads that narrow to one parent's members — translates a relation-named parent
 * here, through `relationPredicates.ts`, before AD4M sees it. A parent already naming a predicate is
 * this package's own (the query adapter's drill-down builds those) and passes through untouched.
 *
 * Installed on the base class for `relationWrites.ts`'s reason: generated, manifest-compiled and
 * foreign-SHACL classes all extend `Ad4mModel`, so all of them — including one a community defines
 * this afternoon — take the neutral form with nothing further registered.
 */
import type { Ad4mModel } from '@coasys/ad4m';

import { parentPredicate } from './relationPredicates';

/** Marker so a second call is a no-op — the adapter can be initialised more than once per process. */
const PATCHED = Symbol.for('we.ad4m.parentByRelation');

type Args = unknown[];
type Static = (this: unknown, ...args: Args) => unknown;

/**
 * A relation-named parent as AD4M takes one; anything else as it came. A read walking below the
 * parent (`levels`, `transitive`) is the executor's traverse form, which names its anchors as `ids` —
 * the same form the query adapter builds for a `$query` scope that walks.
 */
function translate(parent: unknown): unknown {
  if (!parent || typeof parent !== 'object') return parent;
  const named = parent as {
    id?: unknown;
    relation?: unknown;
    entity?: unknown;
    levels?: unknown;
    transitive?: unknown;
  };
  if (typeof named.relation !== 'string' || typeof named.id !== 'string') return parent;
  const { id, predicate } = parentPredicate({
    id: named.id,
    relation: named.relation,
    ...(typeof named.entity === 'string' ? { entity: named.entity } : {}),
  });
  const levels = Array.isArray(named.levels) ? (named.levels as number[]) : undefined;
  if (!levels && named.transitive !== true) return { id, predicate };
  return { ids: [id], predicate, ...(levels ? { levels } : { transitive: true }) };
}

/**
 * The argument holding `parent`, by static: `create`'s options, a read's query. The union reads,
 * `findAllOf` and `queryOf`, take their classes second and the query third.
 */
const PARENT_AT: Record<string, number> = {
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

export function installParentByRelation(model: typeof Ad4mModel): void {
  const target = model as unknown as Record<string | symbol, unknown>;
  if (target[PATCHED]) return;
  target[PATCHED] = true;
  for (const [name, at] of Object.entries(PARENT_AT)) {
    const original = target[name] as Static | undefined;
    if (typeof original !== 'function') continue;
    target[name] = function withNamedParent(this: unknown, ...args: Args) {
      const holder = args[at] as { parent?: unknown } | undefined;
      if (holder && typeof holder === 'object' && 'parent' in holder) {
        args[at] = { ...holder, parent: translate(holder.parent) };
      }
      return original.apply(this, args);
    };
  }
}
