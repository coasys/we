/**
 * A read shared for a few seconds: callers that arrive together share the read in flight, and
 * callers inside the window reuse its answer.
 *
 * A failed read is never kept — the next caller reads again. An entry is only ever removed by the
 * read that put it there, so a slow failure cannot evict a newer read of the same key.
 */
export interface TtlCache<K, V> {
  /** The held read for `key` while it is younger than the window; otherwise `load()`, held. */
  get(key: K, load: () => Promise<V>): Promise<V>;
  /** Forget `key` — after a write the held read would not show. */
  drop(key: K): void;
  /** Forget everything. */
  clear(): void;
}

export interface TtlCacheOptions<V> {
  /** Whether a read that succeeded is worth holding. Answering `false` drops it once it settles. */
  keep?: (value: V) => boolean;
  /** Past this many entries, expired ones are pruned as a new one is added. */
  maxEntries?: number;
  /** The clock, in milliseconds. `Date.now` unless a test needs another. */
  now?: () => number;
}

export function ttlCache<K, V>(ttlMs: number, options: TtlCacheOptions<V> = {}): TtlCache<K, V> {
  const { keep, maxEntries, now = Date.now } = options;
  const entries = new Map<K, { at: number; value: Promise<V> }>();

  const dropIfStill = (key: K, entry: { at: number; value: Promise<V> }) => {
    if (entries.get(key) === entry) entries.delete(key);
  };

  return {
    get(key, load) {
      const at = now();
      const held = entries.get(key);
      if (held && at - held.at < ttlMs) return held.value;
      const value = load();
      const entry = { at, value };
      entries.set(key, entry);
      value.then(
        (v) => {
          if (keep && !keep(v)) dropIfStill(key, entry);
        },
        () => dropIfStill(key, entry),
      );
      if (maxEntries !== undefined && entries.size > maxEntries) {
        for (const [k, e] of entries) if (at - e.at >= ttlMs) entries.delete(k);
      }
      return value;
    },
    drop(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}
