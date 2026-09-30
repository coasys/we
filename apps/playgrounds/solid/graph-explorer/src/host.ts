/**
 * The host binding, over plain arrays.
 *
 * This is the whole surface the graph needs from a data layer — `query`, `defaultDataset`, `models`
 * — so implementing it against in-memory rows is both what makes this harness run without AD4M and,
 * incidentally, the clearest statement of what a second backend would have to provide.
 *
 * Notably it answers **reverse** drill-downs natively, which the AD4M binding currently cannot: with
 * the rows in hand, "what points at this?" is a filter. That asymmetry is the point — the graph asks
 * the same question of both, and each backend answers as well as it can.
 */
import type { GraphHostBindings } from '@we/graph-solid';

import { DATASET, type Row, SHAPES, TABLES } from './fixture';

interface ScopeRequest {
  anchor: string;
  via: string;
  anchorId: string;
  direction?: 'in' | 'out';
}

interface QueryRequest {
  entity: string;
  dataset?: string;
  where?: Record<string, unknown>;
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
  include?: Record<string, unknown>;
  scope?: ScopeRequest;
}

/** Rows the harness has served, so the UI can show how much traffic an interaction actually caused. */
export interface QueryLog {
  entries: { entity: string; kind: string; rows: number }[];
}

function relationValue(row: Row, name: string): string[] {
  const value = row[name];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return typeof value === 'string' ? [value] : [];
}

/**
 * Hydrate the relations `include` asks for.
 *
 * Returns a *copy* — the graph reads freely from what it is handed, and letting it see the fixture
 * rows themselves would make a bug in the engine look like a bug in the data.
 */
function hydrate(row: Row, entity: string, include: Record<string, unknown> | undefined): Row {
  if (!include) return { ...row };
  const shape = SHAPES.find((s) => s.name === entity);
  const result: Row = { ...row };

  for (const name of Object.keys(include)) {
    const relation = shape?.relations.find((r) => r.name === name);
    if (!relation) continue;
    const ids = relationValue(row, name);
    const targets = ids
      .map((id) => (TABLES[relation.target] ?? []).find((candidate) => candidate.id === id))
      .filter((found): found is Row => Boolean(found))
      .map((found) => ({ ...found }));
    result[name] = relation.cardinality === 'one' ? (targets[0] ?? null) : targets;
  }
  return result;
}

function matchesWhere(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const ops = expected as Record<string, unknown>;
      if ('contains' in ops) {
        return typeof actual === 'string' && actual.toLowerCase().includes(String(ops.contains).toLowerCase());
      }
      if ('not' in ops) return actual !== ops.not;
      if ('exists' in ops) return (actual != null) === Boolean(ops.exists);
    }
    return actual === expected;
  });
}

export function createHost(log?: QueryLog): GraphHostBindings {
  function record(entity: string, kind: string, rows: number) {
    log?.entries.push({ entity, kind, rows });
  }

  return {
    defaultDataset: () => DATASET,

    models: () => SHAPES,

    async query(request) {
      const { entity, where, order, limit, offset, include, scope } = request as unknown as QueryRequest;
      const table = TABLES[entity] ?? [];

      if (scope) {
        const anchorTable = TABLES[scope.anchor] ?? [];

        if (scope.direction === 'in') {
          // What points at the anchor: rows of this entity whose `via` relation holds the anchor id.
          const rows = table
            .filter((row) => relationValue(row, scope.via).includes(scope.anchorId))
            .slice(0, limit ?? 50)
            .map((row) => hydrate(row, entity, include));
          record(entity, `reverse via ${scope.anchor}.${scope.via}`, rows.length);
          return rows;
        }

        // Drill-down: the anchor's `via` list, filtered to rows of this entity. The untyped-relation
        // path — nothing in the schema says a collection may hold a collection, so the ids are
        // resolved against whichever table was asked for.
        const anchor = anchorTable.find((row) => row.id === scope.anchorId);
        const ids = anchor ? relationValue(anchor, scope.via) : [];
        const rows = table
          .filter((row) => ids.includes(row.id as string))
          .slice(0, limit ?? 50)
          .map((row) => hydrate(row, entity, include));
        record(entity, `children of ${scope.anchor}.${scope.via}`, rows.length);
        return rows;
      }

      let rows = table.filter((row) => matchesWhere(row, where));

      if (order) {
        const [key, direction] = Object.entries(order)[0] ?? [];
        if (key) {
          rows = [...rows].sort((a, b) => {
            const left = String(a[key] ?? '');
            const right = String(b[key] ?? '');
            return direction === 'desc' ? right.localeCompare(left) : left.localeCompare(right);
          });
        }
      }

      const paged = rows.slice(offset ?? 0, (offset ?? 0) + (limit ?? 100));
      const result = paged.map((row) => hydrate(row, entity, include));
      record(entity, where?.id ? 'by id' : 'list', result.length);
      return result;
    },
  };
}
