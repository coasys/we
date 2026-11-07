/**
 * The rows of a `$each` over a store's list, kept while they are the same record in the same place.
 *
 * ## Why
 *
 * A store that derives a list — `createMemo(() => records.map(...))` — builds new objects every time
 * anything in it changes. `<For>` keys by reference, so every row was destroyed and built again: the
 * DOM under it, its `$localState`, and the scroll position of a page made of such rows. Pressing one
 * switch on a settings screen threw the page. It was fixed twice in a store before it was fixed here,
 * and every store list was one memo away from it.
 *
 * Query results never had it: the query branch keeps its rows in a store reconciled by `id`. This is
 * the same for a store's list, so no store author needs to know.
 *
 * ## The rule
 *
 * A list whose rows are all plain objects with distinct ids is kept by id:
 *
 * - **A row whose record changed keeps its mount**, and its fields change in place. The rows are a
 *   Solid store, so `row.label` in an expression follows the change, as a query row's does.
 * - **A row whose place changed is drawn again**: a new index, or a different row before it. `index`
 *   and `prev` are handed to a row once, when it is drawn, and a template groups by `prev`. Keeping a
 *   moved row would keep a stale neighbour, which is a wrong drawing rather than a slow one, so a move
 *   costs exactly what every change cost before.
 *
 * Anything else — strings, rows without ids, duplicate ids, class instances — is drawn as it always
 * was, by reference. A class instance is left alone because copying it would drop what its prototype
 * answers (an AD4M model's getters), and the copy is what keeps the store from writing into somebody
 * else's objects (below).
 *
 * ## Why copy
 *
 * `reconcile` writes into the objects it already holds. Given the store's own rows, the next change
 * would write into objects the store, or a cache behind it, still holds: a row whose `author` moved
 * from one person to another would rewrite the first person's cached profile. So each row is copied
 * first, through plain objects and arrays; anything else inside a row is kept by reference, which
 * `reconcile` replaces rather than writes into.
 */
import { type Accessor, createComputed, createMemo } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

/** One drawn row: the record, where it sits, and the row before it. */
export interface KeptRow {
  item: Record<string, unknown>;
  index: number;
  prev: Record<string, unknown> | undefined;
}

type Id = string | number;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Whether a list is kept by id: all plain objects, each with an id of its own. */
export function keyable(items: readonly unknown[]): items is Record<string, unknown>[] {
  if (items.length === 0) return false;
  const seen = new Set<Id>();
  for (const item of items) {
    if (!isPlainObject(item)) return false;
    const id = item.id;
    if ((typeof id !== 'string' && typeof id !== 'number') || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/** A copy through plain objects and arrays, so `reconcile` never writes into the caller's. */
export function copyPlain<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value) as T;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const entry of value) out.push(copyPlain(entry, seen));
    return out as T;
  }
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const key of Object.keys(value)) out[key] = copyPlain(value[key], seen);
  return out as T;
}

/**
 * Keep `source`'s rows by id where it can.
 *
 * `keyed` says whether it could; while it is false the caller draws `source` as it always did. While
 * it is true, `rows` is the list to draw: an entry is the same object for as long as its record, its
 * index and the row before it are, so `<For>` keeps that row's mount.
 */
export function keepRows(source: Accessor<unknown[]>): { keyed: Accessor<boolean>; rows: Accessor<KeptRow[]> } {
  const keyed = createMemo(() => keyable(source()));
  const [kept, setKept] = createStore<Record<string, unknown>[]>([]);
  createComputed(() => {
    const items = source();
    if (keyable(items))
      setKept(
        reconcile(
          items.map((item) => copyPlain(item)),
          { key: 'id', merge: true },
        ),
      );
  });

  /** The entry each id was last drawn with. */
  let drawn = new Map<Id, KeptRow>();
  const rows = createMemo<KeptRow[]>(() => {
    if (!keyed()) {
      drawn = new Map();
      return [];
    }
    const next = new Map<Id, KeptRow>();
    const out = kept.map((item, index) => {
      const prev = index > 0 ? kept[index - 1] : undefined;
      const id = item.id as Id;
      const last = drawn.get(id);
      // The same store object for as long as the id is listed; a new entry only when it moved.
      const entry =
        last && last.item === item && last.index === index && last.prev === prev ? last : { item, index, prev };
      next.set(id, entry);
      return entry;
    });
    drawn = next;
    return out;
  });
  return { keyed, rows };
}
