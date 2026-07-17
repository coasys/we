/**
 * The query IR — a backend-neutral, specified, versioned description of the data a template needs.
 * It is what a `$query` resolves to (bindings like `$local`/`$store` are evaluated *above* this, so
 * the IR only ever holds concrete values), and what a backend adapter compiles to its native query.
 *
 * One grammar: this is both what an author writes and what an adapter consumes (bindings resolved).
 * Defined against a `ModelManifest` (see manifest.ts) — the entity/field/relation names here are
 * expected to resolve there; that cross-check is a separate validation pass.
 */
import { z } from 'zod';

// ─── Filter ────────────────────────────────────────────────────────────────────

export type Op =
  'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'nin' | 'contains' | 'startsWith' | 'endsWith' | 'exists';

export type Scalar = string | number | boolean | null;

/** A boolean expression tree. Leaves compare a field; combinators nest; `rel` scopes to a relation. */
export type Filter =
  | { field: string; op: Op; value: Scalar | Scalar[]; caseSensitive?: boolean }
  | { and: Filter[] }
  | { or: Filter[] }
  | { not: Filter }
  | { rel: string; op: 'exists' | 'some' | 'none'; where?: Filter };

// ─── Sort / Page / Include / Aggregate ──────────────────────────────────────────

export interface SortKey {
  /** A property name, `id`, an aggregate alias, or a dotted path through to-one relations. */
  by: string;
  dir: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

export type Page = { limit: number; offset?: number } | { limit: number; after?: string };

export interface IncludeSpec {
  filter?: Filter;
  sort?: SortKey[];
  page?: Page;
  select?: string[];
  include?: IncludeMap;
  /** Unwrap a to-many relation to a single `object | null`. */
  first?: boolean;
}
export type IncludeMap = Record<string, IncludeSpec | true>;

export interface Aggregation {
  /** Alias — becomes a field on each result row and is referenceable in `sort.by`. */
  as: string;
  /** Relation to aggregate across. */
  over: string;
  fn: 'count' | 'sum' | 'min' | 'max' | 'avg';
  /** Required for sum/min/max/avg (a property on the related entity). */
  field?: string;
  /** Filter the related set before aggregating. */
  filter?: Filter;
}

// ─── Query ───────────────────────────────────────────────────────────────────────

export interface QueryIR {
  irVersion: 1;
  /** Root entity type — same noun as the manifest's `entities` keys. */
  entity: string;
  filter?: Filter;
  /** Ordered; first key is primary. */
  sort?: SortKey[];
  page?: Page;
  /** Scalar projection; omit = all scalar props. */
  select?: string[];
  include?: IncludeMap;
  aggregate?: Aggregation[];
  /** Subscription vs one-shot. */
  live?: boolean;
}

// ─── Zod schema (structural validation) ─────────────────────────────────────────

const op = z.enum(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'contains', 'startsWith', 'endsWith', 'exists']);
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const filterSchema: z.ZodType<Filter> = z.lazy(() =>
  z.union([
    z.object({
      field: z.string(),
      op,
      value: z.union([scalar, z.array(scalar)]),
      caseSensitive: z.boolean().optional(),
    }),
    z.object({ and: z.array(filterSchema) }),
    z.object({ or: z.array(filterSchema) }),
    z.object({ not: filterSchema }),
    z.object({ rel: z.string(), op: z.enum(['exists', 'some', 'none']), where: filterSchema.optional() }),
  ]),
);

const sortKeySchema = z.object({
  by: z.string(),
  dir: z.enum(['asc', 'desc']),
  nulls: z.enum(['first', 'last']).optional(),
});

const pageSchema = z.union([
  z.object({ limit: z.number(), offset: z.number().optional() }),
  z.object({ limit: z.number(), after: z.string().optional() }),
]);

const includeSpecSchema: z.ZodType<IncludeSpec> = z.lazy(() =>
  z.object({
    filter: filterSchema.optional(),
    sort: z.array(sortKeySchema).optional(),
    page: pageSchema.optional(),
    select: z.array(z.string()).optional(),
    include: includeMapSchema.optional(),
    first: z.boolean().optional(),
  }),
);
const includeMapSchema: z.ZodType<IncludeMap> = z.lazy(() =>
  z.record(z.string(), z.union([includeSpecSchema, z.literal(true)])),
);

const aggregationSchema = z.object({
  as: z.string(),
  over: z.string(),
  fn: z.enum(['count', 'sum', 'min', 'max', 'avg']),
  field: z.string().optional(),
  filter: filterSchema.optional(),
});

export const queryIRSchema: z.ZodType<QueryIR> = z.object({
  irVersion: z.literal(1),
  entity: z.string(),
  filter: filterSchema.optional(),
  sort: z.array(sortKeySchema).optional(),
  page: pageSchema.optional(),
  select: z.array(z.string()).optional(),
  include: includeMapSchema.optional(),
  aggregate: z.array(aggregationSchema).optional(),
  live: z.boolean().optional(),
});

export interface IRError {
  path: string;
  message: string;
}

/** Structural validation of a query IR (shape only; entity/field resolution is a separate pass). */
export function validateQueryIR(input: unknown): { valid: true; query: QueryIR } | { valid: false; errors: IRError[] } {
  const parsed = queryIRSchema.safeParse(input);
  if (parsed.success) return { valid: true, query: parsed.data };
  return {
    valid: false,
    errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}
