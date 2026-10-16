/**
 * A query over several entities at once — the part of it that is not any backend's business.
 *
 * `entity: ['TaskBlock', 'EventBlock']` asks one question of records of more than one kind: "what did
 * this call produce", "what is on this canvas". A backend answers one entity at a time (model
 * statics are per class; the in-memory engine reads one table), so the renderer asks each and this
 * puts the answers back together as the single list the template asked for.
 *
 * Above the adapters on purpose. Every backend gets it without implementing anything, and one that
 * can answer a union natively only replaces the fan-out — the combined list it must produce is the
 * one described here, through `$getEntitiesForDataset`; {@link unionByFanOut} is the same handle
 * for a backend that cannot.
 *
 * `combineEntityRows` is pure: rows in, rows out. The renderer owns asking, subscribing and cancelling.
 */
import type { DatasetHandle, EntityClass, QueryOptions, QuerySubscription } from './dataSource';
import { RECORD_TYPE_KEY } from './recordContract';

/**
 * The entity names a query's resolved `entity` asks for, or `undefined` when it has not answered yet.
 *
 * A name is a one-entity query. A list is a union — **including** a list of one, and including an
 * empty one: a template that computes its kinds from data has answered "none" when the list is
 * empty, which is a result (no rows, loaded), not a frame to wait through. Blank and repeated names
 * are dropped, keeping the first of each, so the order a template wrote is the order that decides
 * which kind a record shared by two is reported as — see {@link combineEntityRows}.
 */
export function entityNamesOf(resolved: unknown): { names: string[]; union: boolean } | undefined {
  if (typeof resolved === 'string') return resolved ? { names: [resolved], union: false } : undefined;
  if (!Array.isArray(resolved)) return undefined;
  const names = [...new Set(resolved.filter((name): name is string => typeof name === 'string' && name !== ''))];
  return { names, union: true };
}

export interface EntityRows {
  entity: string;
  rows: readonly unknown[];
}

/**
 * One entity's answers per entry, as the single list a union query answers with.
 *
 * - **Every row says what it is**, under {@link RECORD_TYPE_KEY} — the key a polymorphic relation read
 *   already carries its concrete class under, so a template reads the kind of a row the same way
 *   whichever way it arrived (`row.__subjectClass`). A row that already carries one keeps it: the
 *   backend knows a record's concrete class better than the name it was asked for.
 * - **A record appears once.** Two entities can answer with the same record — an abstract model and
 *   a concrete one it covers — and a list with the same id twice breaks keyed rendering. The first
 *   entity in the query's list keeps it.
 * - **`order` and `limit` apply to the whole list.** Each backend call already sorted and limited its
 *   own part, so the parts are merged, sorted again with the same keys, and cut: `limit` rows from
 *   each of N entities always contain the first `limit` of their union. `null` and `undefined` sort
 *   last, which is where the in-memory engine puts them.
 *
 * `id` is read explicitly before spreading, because a backend's instance may expose it as a
 * prototype getter that a spread does not copy.
 */
export function combineEntityRows(
  parts: readonly EntityRows[],
  options: { order?: Record<string, unknown>; limit?: unknown } = {},
): Record<string, unknown>[] {
  const seen = new Set<unknown>();
  const combined: Record<string, unknown>[] = [];
  for (const { entity, rows } of parts) {
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const id = record.id;
      if (id !== undefined) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      combined.push({ id, ...record, [RECORD_TYPE_KEY]: record[RECORD_TYPE_KEY] || entity });
    }
  }

  const keys = Object.entries(options.order ?? {}).filter(
    (entry): entry is [string, 'asc' | 'desc'] => entry[1] === 'asc' || entry[1] === 'desc',
  );
  if (keys.length > 0) {
    combined.sort((a, b) => {
      for (const [field, dir] of keys) {
        const av = a[field];
        const bv = b[field];
        if (av == null && bv == null) continue;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av === bv) continue;
        const cmp = (av as number) < (bv as number) ? -1 : 1;
        return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }

  return typeof options.limit === 'number' && options.limit >= 0 ? combined.slice(0, options.limit) : combined;
}

/** One entity a fan-out asks, with the relations it declares — which of an `include`'s keys it can answer. */
export interface UnionPart {
  entity: string;
  Model: EntityClass;
  relations: ReadonlySet<string>;
}

/**
 * Several entities as one handle, for a backend that answers one entity at a time: each is asked
 * separately and the answers are combined by {@link combineEntityRows}, so the list is the one a
 * native union answers with.
 *
 * An `include` key, or a `$` projection, over a relation an entity does not declare is left out of
 * that entity's read rather than sent — which is what a native union does with it, and what keeps
 * one kind that cannot answer a count from taking every kind off the list.
 *
 * A live read emits once every entity has answered, then on any change to any of them. A one-shot
 * read in which some entities fail answers with the rest, and fails only when all of them do.
 * `offset` is refused: a page of a union needs `offset + limit` rows from every entity, which is a
 * cost to design for rather than to pay silently.
 */
export function unionByFanOut(parts: readonly UnionPart[]): EntityClass {
  const combine = (answers: readonly (readonly unknown[])[], opts: QueryOptions) =>
    combineEntityRows(
      parts.map((part, i) => ({ entity: part.entity, rows: answers[i] ?? [] })),
      { order: opts.order, limit: opts.limit },
    );
  const refuseOffset = (opts: QueryOptions) => {
    if (opts.offset !== undefined) throw new Error('A read over several entities cannot take an offset');
  };

  return {
    query(dataset: DatasetHandle, opts: QueryOptions): QuerySubscription {
      refuseOffset(opts);
      const subscriptions = parts.map((part) => part.Model.query(dataset, optionsFor(part, opts)));
      return {
        subscribe(cb) {
          const answers: (readonly unknown[])[] = parts.map(() => []);
          let primed = false;
          return Promise.all(
            subscriptions.map((subscription, i) =>
              subscription
                .subscribe((rows) => {
                  answers[i] = rows;
                  if (primed) cb(combine(answers, opts));
                })
                .then((rows) => {
                  answers[i] = rows;
                }),
            ),
          ).then(() => {
            primed = true;
            const rows = combine(answers, opts);
            cb(rows);
            return rows;
          });
        },
        dispose() {
          for (const subscription of subscriptions) subscription.dispose();
        },
      };
    },

    async findAll(dataset, opts, ctl) {
      refuseOffset(opts);
      const settled = await Promise.allSettled(
        parts.map((part) => part.Model.findAll(dataset, optionsFor(part, opts), ctl)),
      );
      const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed && settled.every((result) => result.status === 'rejected')) throw failed.reason;
      return combine(
        settled.map((result) => (result.status === 'fulfilled' ? result.value : [])),
        opts,
      );
    },
  };
}

/** The read one entity of a union is sent: the union's, less what it cannot answer. */
function optionsFor(part: UnionPart, opts: QueryOptions): QueryOptions {
  if (!opts.include) return opts;
  const include = Object.fromEntries(
    Object.entries(opts.include).filter(([key, spec]) => {
      const from = key.startsWith('$') ? (spec as { from?: unknown } | null)?.from : key;
      return typeof from !== 'string' || part.relations.has(from);
    }),
  );
  const { include: _include, ...rest } = opts;
  return Object.keys(include).length ? { ...rest, include } : rest;
}
