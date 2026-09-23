/**
 * A query over several entities at once — the part of it that is not any backend's business.
 *
 * `entity: ['TaskBlock', 'EventBlock']` asks one question of records of more than one kind: "what did
 * this call produce", "what is on this canvas". A backend answers one entity at a time (model
 * statics are per class; the in-memory engine reads one table), so the renderer asks each and this
 * puts the answers back together as the single list the template asked for.
 *
 * Above the adapters on purpose. Every backend gets it without implementing anything, and one that
 * can answer a union natively later only replaces the fan-out — the combined list it must produce is
 * the one described here.
 *
 * Pure: rows in, rows out. The renderer owns asking, subscribing and cancelling.
 */
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
