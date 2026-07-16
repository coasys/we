/**
 * Phase 0 (portable-UI slice) — an in-memory, **AD4M-free** backend for the schema renderer.
 *
 * This is the proof that WE's renderer runs against an arbitrary data source: it implements the
 * contract the `SchemaRenderer` expects — `$getModel(name)` → a class with
 * `query(dataset, opts)` / `findAll(dataset, opts)`, and a `stores` bag whose `$currentDataset()`
 * yields an opaque `{ uuid }` handle — with a tiny query engine over plain JS arrays. No
 * `@coasys/ad4m`, no `adamStore`, no perspective: this file's package can't even import AD4M (deps
 * are only `@we/design-types` + `@we/schema-shared`).
 *
 * Phase 1 note: the renderer now reads the injected `$currentDataset()` (falling back to the legacy
 * `adamStore.currentPerspective` only for the not-yet-migrated AD4M app). This backend uses the
 * clean seam directly.
 */

export type Row = { id: string | number } & Record<string, unknown>;

export interface RelationDef {
  type: 'hasOne' | 'hasMany';
  target: string; // table name
  foreignKey: string; // hasOne: fk on this row → target.id; hasMany: fk on target → this row.id
}

export interface BackendConfig {
  /** Opaque dataset id — the `.uuid` the renderer reads off the handle. */
  uuid: string;
  /** model/table name → rows */
  tables: Record<string, Row[]>;
  /** model name → relationName → definition (drives `include`) */
  relations?: Record<string, Record<string, RelationDef>>;
}

type Where = Record<string, unknown>;
interface QueryOpts {
  where?: Where;
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
  include?: Record<string, unknown>;
}

function matchesWhere(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some((c) => matchesWhere(row, c));
    if (key === 'AND') return (cond as Where[]).every((c) => matchesWhere(row, c));
    if (key === 'NOT') return !matchesWhere(row, cond as Where);
    const val = row[key];
    if (cond && typeof cond === 'object') {
      const c = cond as Record<string, unknown>;
      if ('contains' in c)
        return String(val ?? '')
          .toLowerCase()
          .includes(String(c.contains).toLowerCase());
      if ('exists' in c) return c.exists ? val != null : val == null;
      if ('not' in c) return val !== c.not;
    }
    return val === cond;
  });
}

function applyOrder(rows: Row[], order?: Record<string, 'asc' | 'desc'>): Row[] {
  if (!order) return rows;
  const keys = Object.entries(order);
  return [...rows].sort((a, b) => {
    for (const [field, dir] of keys) {
      const av = a[field] as number | string;
      const bv = b[field] as number | string;
      if (av === bv) continue;
      const cmp = av < bv ? -1 : 1;
      return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

export function createInMemoryBackend(config: BackendConfig) {
  // A single global subscriber set is enough for the slice: any mutation re-emits every live query.
  const subscribers = new Set<() => void>();
  const notify = () => subscribers.forEach((fn) => fn());

  function hydrate(rows: Row[], model: string, include?: Record<string, unknown>): Row[] {
    if (!include) return rows;
    const rels = config.relations?.[model] ?? {};
    return rows.map((row) => {
      const out: Row = { ...row };
      for (const relName of Object.keys(include)) {
        const def = rels[relName];
        if (!def) continue;
        const targetRows = config.tables[def.target] ?? [];
        out[relName] =
          def.type === 'hasOne'
            ? (targetRows.find((r) => r.id === row[def.foreignKey]) ?? null)
            : targetRows.filter((r) => r[def.foreignKey] === row.id);
      }
      return out;
    });
  }

  function run(model: string, opts: QueryOpts = {}): Row[] {
    let rows = config.tables[model] ?? [];
    if (opts.where) rows = rows.filter((r) => matchesWhere(r, opts.where!));
    rows = applyOrder(rows, opts.order);
    if (opts.offset) rows = rows.slice(opts.offset);
    if (opts.limit != null) rows = rows.slice(0, opts.limit);
    return hydrate(rows, model, opts.include);
  }

  function getModel(name: string) {
    return {
      // Live path — matches `ModelClass.query(dataset, opts).subscribe(cb)` in SchemaRenderer.
      query(_dataset: unknown, opts: QueryOpts) {
        const emit = () => run(name, opts);
        let push: ((rows: Row[]) => void) | null = null;
        const notifier = () => push?.(emit());
        return {
          subscribe(cb: (rows: Row[]) => void) {
            push = cb;
            subscribers.add(notifier);
            queueMicrotask(() => cb(emit()));
            return Promise.resolve(emit());
          },
          dispose() {
            subscribers.delete(notifier);
          },
        };
      },
      // One-shot path — matches `ModelClass.findAll(dataset, opts, { signal })`.
      findAll(_dataset: unknown, opts: QueryOpts) {
        return Promise.resolve(run(name, opts));
      },
    };
  }

  const stores = {
    // The clean, backend-neutral seam (Phase 1): the host injects the current dataset handle.
    // No `adamStore`, no AD4M concept — just an opaque `{ uuid }` the renderer reads.
    $currentDataset: () => ({ id: config.uuid }),
    $getModel: (name: string) => getModel(name),
  };

  return {
    stores,
    getModel,
    /** Mutate the seed and re-emit to all live subscriptions — demonstrates reactivity end-to-end. */
    mutate(fn: (tables: Record<string, Row[]>) => void) {
      fn(config.tables);
      notify();
    },
  };
}
