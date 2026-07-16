/**
 * In-memory, AD4M-free backend for the schema renderer — the browser twin of the headless slice's
 * `inMemoryDataSource.ts`. Implements the injected `stores` contract: `$currentDataset()` →
 * `{ id }` handle, `$getModel(name)` → a class with `query(dataset, opts)` / `findAll(...)`, over a
 * tiny query engine on plain JS arrays. No `@coasys/ad4m` anywhere in this app's dependency graph.
 *
 * TODO: duplicated from the test copy — consolidate both into a shared `@we/backend-inmemory` package.
 */

export type Row = { id: string | number } & Record<string, unknown>;

export interface RelationDef {
  type: 'hasOne' | 'hasMany';
  target: string;
  foreignKey: string;
}

export interface BackendConfig {
  id: string;
  tables: Record<string, Row[]>;
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
      query(_dataset: unknown, opts: QueryOpts) {
        let push: ((rows: Row[]) => void) | null = null;
        const notifier = () => push?.(run(name, opts));
        return {
          subscribe(cb: (rows: Row[]) => void) {
            push = cb;
            subscribers.add(notifier);
            queueMicrotask(() => cb(run(name, opts)));
            return Promise.resolve(run(name, opts));
          },
          dispose() {
            subscribers.delete(notifier);
          },
        };
      },
      findAll(_dataset: unknown, opts: QueryOpts) {
        return Promise.resolve(run(name, opts));
      },
    };
  }

  const stores = {
    $currentDataset: () => ({ id: config.id }),
    $getModel: (name: string) => getModel(name),
  };

  return {
    stores,
    mutate(fn: (tables: Record<string, Row[]>) => void) {
      fn(config.tables);
      notify();
    },
  };
}
