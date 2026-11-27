/**
 * The query vectors this backend is known to fail, each with what is wrong. The live suite runs them
 * inverted (see `describeBackendConformance`).
 *
 * Two kinds, kept apart because only one can be checked without an executor. `REFUSED` are cases
 * the adapter refuses to send at all, because the executor has no such operator or ordering: a unit
 * test (`tests/queryVectorGaps.test.ts`) plans every vector through the adapter and holds this list
 * to exactly the ones it refuses. `EXECUTOR` are cases the executor answers, wrongly; only a live run
 * can say when one closes.
 */
const NO_EXISTS =
  'the executor has no `exists` operator, so a query using one is refused rather than answered as if it were not there';
const NO_ANCHORED_TEXT = 'the executor has no `startsWith` or `endsWith`; a query using one is refused';
const NUMBER_BOUNDS_ONLY =
  'the executor holds a range bound as a number, so a text bound is refused rather than misread';
const PROJECTION_WHERE =
  "a projection's or a count's `where` compiles equality only, and anything more is dropped so every member is listed or counted; the adapter refuses it (ad4m-issue:projection-where-operators)";
const ONE_SORT_KEY = "the executor's sort pushdown takes one key, so a query ordered by two is refused";

export const REFUSED_QUERY_VECTORS: Record<string, string> = {
  'query.core.where-starts-with': NO_ANCHORED_TEXT,
  'query.core.where-starts-with-case': NO_ANCHORED_TEXT,
  'query.core.where-ends-with': NO_ANCHORED_TEXT,
  'query.core.where-range-text': NUMBER_BOUNDS_ONLY,
  'query.core.where-range-mixed': NUMBER_BOUNDS_ONLY,
  'query.core.where-exists-false': NO_EXISTS,
  'query.core.where-exists-true': NO_EXISTS,
  'query.core.where-absent-explicitly': NO_EXISTS,
  'query.core.where-cleared-exists-false': NO_EXISTS,
  'query.core.order-several-keys': ONE_SORT_KEY,
  'query.core.projection-list': PROJECTION_WHERE,
  'query.aggregates.count-where': PROJECTION_WHERE,
  'query.core.projection-select':
    "a projection's records cannot be narrowed to a field list, so a projection with a select is refused rather than answered with every field",
  'query.traversal.scope-without-anchor':
    "the adapter reads `via` off the anchor's entity to find its predicate, so a scope naming no anchor entity is refused",
};

export const EXECUTOR_QUERY_VECTORS: Record<string, string> = {
  'query.core.order-absent-last-desc':
    'with no `limit` the executor sorts in memory, and `sort_instances` reverses the whole comparison for `desc`, the rule that puts no value last included, so a record with no value comes first; the SPARQL sort, taken with a `limit`, keeps it last both ways (ad4m-issue:desc-null-order)',
  'query.core.projection-first':
    "a projection's `order` honours only `id`/`base` and drops any other key, so `stars` is ignored and the member returned is whichever SPARQL yields first (build_projection_order_clause)",
};

export const QUERY_VECTOR_GAPS: Record<string, string> = { ...REFUSED_QUERY_VECTORS, ...EXECUTOR_QUERY_VECTORS };
