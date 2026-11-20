/**
 * A record's provenance and container, answered for a class that does not declare them.
 *
 * Every record WE defines carries `extractedFrom` and `partOf`: the conversation it was extracted
 * from and the collection it is part of, each the reverse of a link a `CollectionBlock` owns
 * (`extracted`, `children`). Those are declared on `WeNode`, so a class WE generated has them. A
 * class another app or a bot installed does not, and the executor reads an `include` by the shape
 * stored in the perspective, so asking one of its records where it came from answers nothing. The
 * link is there all the same: the call that produced an action item links to it exactly as it links
 * to a task.
 *
 * The visible cost was a canvas lens that dimmed every card a bot's model held, even with the call
 * that produced them selected. Requiring every app that writes into a space to declare WE's
 * relations is not a fix: the next app would not know to. So the read goes the other way round, from
 * the side that does declare the link. When a row comes back without a relation it asked to include
 * (`undefined`, which is how the executor leaves one the class does not declare, where one it
 * declares and finds empty is `null`), the collections pointing at those rows through that
 * predicate are read in one batch, and each row is given the first of them.
 *
 * This is a second read, and a second read is not the same snapshot. A live query re-reads on each
 * change to its own rows. A link added later to a record that has not otherwise changed shows up on
 * the next change, not at once. The executor reading an undeclared reverse link itself, in the same
 * query, is the real answer, and is what this is waiting for.
 */
import type { DatasetHandle, EntityClass, QueryOptions, QuerySubscription } from '@we/backend-shared';
import { CORE_MANIFEST, WE_NODE_RELATIONS } from '@we/entities/manifest';

import { toAd4mPredicate } from './containment';

type Row = Record<string, unknown>;

/** One reverse relation, and an entity that owns its forward half. */
export interface ReverseRead {
  /** The relation a row asks to include: `extractedFrom`. */
  relation: string;
  /** An entity that owns the forward link: `CollectionBlock`. */
  holder: string;
  /** The holder's relation, whose ids say which row each holder points at: `extracted`. */
  via: string;
  /** The link's predicate, as AD4M stores it. */
  predicate: string;
}

/**
 * The reverse relations every node carries that can be read from their forward side, worked out from
 * the manifest rather than listed.
 *
 * Only the ones whose forward half belongs to particular entities. `respondsTo` reads `responses`,
 * which every node has, so its owner could be anything in the space and there is no class to ask.
 */
export function reverseReadsOf(
  manifest: { entities: Record<string, { relations?: Record<string, { predicate?: string }> }> } = CORE_MANIFEST,
  base: Record<string, { predicate?: string; reverseOf?: string }> = WE_NODE_RELATIONS,
): ReverseRead[] {
  const reads: ReverseRead[] = [];
  for (const [relation, spec] of Object.entries(base)) {
    if (!spec.reverseOf || !spec.predicate || spec.reverseOf in base) continue;
    for (const [holder, entity] of Object.entries(manifest.entities)) {
      const forward = entity.relations?.[spec.reverseOf];
      if (forward?.predicate !== spec.predicate) continue;
      reads.push({ relation, holder, via: spec.reverseOf, predicate: toAd4mPredicate(spec.predicate) });
    }
  }
  return reads;
}

const READS = reverseReadsOf();

/** The ids a relation holds, as ids or as included records. */
function idsIn(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return list
    .map((item) => (typeof item === 'string' ? item : (item as { id?: unknown } | null)?.id))
    .filter((id): id is string => typeof id === 'string' && id !== '');
}

/** The reverse relations a read asks to include, if any. */
function wanted(opts: QueryOptions, reads: readonly ReverseRead[]): string[] {
  const include = opts.include;
  if (!include) return [];
  return [...new Set(reads.map((read) => read.relation))].filter((relation) => Boolean(include[relation]));
}

export interface ReverseReadDeps {
  /** The entity a holder is read through. */
  holder: (entity: string) => EntityClass | undefined;
  /** Defaults to the reads the core manifest gives every node. */
  reads?: readonly ReverseRead[];
}

/**
 * Fill each row's missing reverse relations, in place, and answer with the rows.
 *
 * A row is filled only where the relation was asked for and is `undefined`: a class that declares it
 * has already answered, `null` included. A holder that cannot be read leaves its rows `null`, which is
 * what the relation reads as on a record nothing points at.
 */
export async function fillUndeclaredReverse(
  rows: readonly unknown[],
  opts: QueryOptions,
  dataset: DatasetHandle,
  deps: ReverseReadDeps,
  ctl?: { signal?: AbortSignal },
): Promise<unknown[]> {
  const reads = deps.reads ?? READS;
  for (const relation of wanted(opts, reads)) {
    const missing = rows.filter(
      (row): row is Row =>
        Boolean(row) &&
        typeof row === 'object' &&
        (row as Row)[relation] === undefined &&
        typeof (row as Row).id === 'string',
    );
    if (!missing.length) continue;
    const ids = missing.map((row) => row.id as string);
    // What the include asked of the record it hydrates, beyond whether to: its own includes and fields.
    const spec = (opts.include as Record<string, unknown>)[relation];
    const sub = spec && typeof spec === 'object' ? (spec as Row) : {};
    const asked = {
      ...(sub.include ? { include: sub.include } : {}),
      ...(sub.properties ? { properties: sub.properties } : {}),
    };
    const found = await Promise.all(
      reads
        .filter((read) => read.relation === relation)
        .map(async (read) => {
          const Model = deps.holder(read.holder);
          if (!Model) return [];
          try {
            const holders = await Model.findAll(
              dataset,
              { ...asked, parent: { ids, predicate: read.predicate, direction: 'in' } } as QueryOptions,
              ctl,
            );
            return holders.map((holder) => ({ holder: holder as Row, via: read.via }));
          } catch (error) {
            console.warn(`[ad4m] cannot read ${relation} from ${read.holder}:`, error);
            return [];
          }
        }),
    );
    const sourceOf = new Map<string, Row>();
    for (const { holder, via } of found.flat()) {
      for (const id of idsIn(holder[via])) if (!sourceOf.has(id)) sourceOf.set(id, holder);
    }
    for (const row of missing) row[relation] = sourceOf.get(row.id as string) ?? null;
  }
  return rows as unknown[];
}

/**
 * A model handle whose reads answer the reverse relations its class does not declare. A read that
 * asks for none of them goes straight through, untouched.
 *
 * A live read's answers are filled one at a time, in the order they arrived, so a slow fill of an
 * older answer can never be delivered after a newer one.
 */
export function withUndeclaredReverse(Model: EntityClass, deps: ReverseReadDeps): EntityClass {
  const reads = deps.reads ?? READS;
  return {
    query(dataset, opts): QuerySubscription {
      const subscription = Model.query(dataset, opts);
      if (!wanted(opts, reads).length) return subscription;
      let chain: Promise<unknown> = Promise.resolve();
      const inOrder = (rows: readonly unknown[]) => {
        const filled = chain.then(() => fillUndeclaredReverse(rows, opts, dataset, deps));
        chain = filled.catch(() => undefined);
        return filled;
      };
      return {
        subscribe: (cb) =>
          subscription
            .subscribe((rows) => {
              inOrder(rows).then(cb, () => cb(rows));
            })
            .then((rows) => inOrder(rows).catch(() => rows)),
        dispose: () => subscription.dispose(),
      };
    },
    async findAll(dataset, opts, ctl) {
      const rows = await Model.findAll(dataset, opts, ctl);
      return wanted(opts, reads).length ? fillUndeclaredReverse(rows, opts, dataset, deps, ctl) : rows;
    },
  };
}
