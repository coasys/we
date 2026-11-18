/**
 * Query-compilation vector inputs. Three shapes cover the three exports of propResolvers/query.ts:
 *
 * - `{ id, op: 'query', query }` → `resolveQueryProp({ $query: query })` — what the descriptor
 *   keeps (`entity`, `params`, `subscribe` default true, `dataset`, `include`, `when`).
 * - `{ id, op: 'where', where }` → `pruneUnresolvedWhere(where)` — `undefined` operands and
 *   `{ not: [] }` drop; `null`, `''` and `false` stay.
 * - `{ id, op: 'scope', scope }` → `scopeIsAnchored(scope)` — an absent/empty anchor widens;
 *   an empty *list* of anchors is anchored.
 *
 * Operands are written encoded (`{$undefined:true}` marks an unresolved reactive reference).
 */
import type { EncodedValue } from '../encode';

export interface QueryCase {
  id: string;
  op: 'query' | 'where' | 'scope';
  query?: EncodedValue;
  where?: Record<string, EncodedValue>;
  scope?: EncodedValue;
}

const U = { $undefined: true } as const;

export const QUERY_CASES: QueryCase[] = [
  /* --- resolveQueryProp --- */
  { id: 'q.minimal', op: 'query', query: { entity: 'TaskBlock' } },
  { id: 'q.where', op: 'query', query: { entity: 'TaskBlock', where: { state: 'open' } } },
  { id: 'q.order-limit', op: 'query', query: { entity: 'Post', order: { created: 'desc' }, limit: 20 } },
  { id: 'q.subscribe-false', op: 'query', query: { entity: 'Post', subscribe: false } },
  { id: 'q.subscribe-true', op: 'query', query: { entity: 'Post', subscribe: true } },
  { id: 'q.dataset', op: 'query', query: { entity: 'Post', dataset: 'personal' } },
  { id: 'q.include', op: 'query', query: { entity: 'Post', include: { signals: true, author: { level: 2 } } } },
  { id: 'q.when', op: 'query', query: { entity: 'Post', when: 'local.ready' } },
  { id: 'q.when-false', op: 'query', query: { entity: 'Post', when: false } },
  { id: 'q.scope', op: 'query', query: { entity: 'Comment', scope: { anchorId: 'we://p/1', predicate: 'comment' } } },
  {
    id: 'q.everything',
    op: 'query',
    query: {
      entity: 'TaskBlock',
      dataset: 'space',
      subscribe: false,
      include: { signals: true },
      when: 'local.x',
      where: { state: 'open' },
      order: { name: 'asc' },
      limit: 5,
      offset: 10,
      select: ['id', 'name'],
      custom: 'kept',
    },
  },
  { id: 'q.where-in', op: 'query', query: { entity: 'E', where: { state: { in: ['open', 'wip'] } } } },
  { id: 'q.expr-entity', op: 'query', query: { entity: { $: 'local.entity' } } },
  { id: 'q.where-ops', op: 'query', query: { entity: 'E', where: { a: { not: 'x' }, b: { contains: 'y' } } } },
  { id: 'q.empty', op: 'query', query: {} },

  /* --- pruneUnresolvedWhere --- */
  { id: 'w.clean', op: 'where', where: { state: 'open' } },
  { id: 'w.undefined-field', op: 'where', where: { state: 'open', author: U } },
  { id: 'w.all-undefined', op: 'where', where: { a: U, b: U } },
  { id: 'w.empty', op: 'where', where: {} },
  { id: 'w.null-stays', op: 'where', where: { parent: null } },
  { id: 'w.empty-string-stays', op: 'where', where: { text: '' } },
  { id: 'w.false-stays', op: 'where', where: { retired: false } },
  { id: 'w.zero-stays', op: 'where', where: { level: 0 } },
  { id: 'w.list-operand', op: 'where', where: { author: { not: ['did:a', 'did:b'] } } },
  { id: 'w.in', op: 'where', where: { state: { in: ['open', 'wip'] } } },
  { id: 'w.in-undefined', op: 'where', where: { state: { in: U } } },
  { id: 'w.not-empty-list', op: 'where', where: { author: { not: [] }, state: 'open' } },
  { id: 'w.not-only-empty-list', op: 'where', where: { author: { not: [] } } },
  { id: 'w.op-object', op: 'where', where: { name: { contains: 'x', startsWith: 'a' } } },
  { id: 'w.op-undefined-operand', op: 'where', where: { name: { contains: U, startsWith: 'a' } } },
  { id: 'w.op-all-undefined', op: 'where', where: { name: { contains: U } } },
  { id: 'w.exists-false', op: 'where', where: { tags: { exists: false } } },
  { id: 'w.range', op: 'where', where: { seats: { gt: 5, lte: 20 } } },
  { id: 'w.or-clean', op: 'where', where: { OR: [{ name: 'Bob' }, { name: 'Anna' }] } },
  { id: 'w.or-pruned-branch', op: 'where', where: { OR: [{ name: 'Bob' }, { name: U }], state: 'x' } },
  { id: 'w.or-all-pruned', op: 'where', where: { OR: [{ a: U }, { b: U }] } },
  { id: 'w.or-non-branch', op: 'where', where: { OR: [{ a: 1 }, 'stray', { b: 2 }] } },
  { id: 'w.and-mixed', op: 'where', where: { AND: [{ a: U, b: 1 }, { c: U }] } },
  { id: 'w.not-clause', op: 'where', where: { NOT: { state: 'done' } } },
  { id: 'w.not-pruned', op: 'where', where: { NOT: { state: U } } },
  { id: 'w.not-nonobject', op: 'where', where: { NOT: 'x' as unknown as EncodedValue } },
  { id: 'w.nested-logic', op: 'where', where: { OR: [{ AND: [{ a: 1 }, { b: U }] }, { NOT: { c: U } }], keep: true } },
  { id: 'w.field-list', op: 'where', where: { tags: ['a', 'b'] } },
  { id: 'w.date-range', op: 'where', where: { startDate: { gte: '2026-09-15', lt: '2026-10-01' } } },
  { id: 'w.mixed', op: 'where', where: { a: U, b: { not: [] }, c: null, d: '', e: { contains: 'x' } } },

  /* --- scopeIsAnchored --- */
  { id: 's.string', op: 'scope', scope: { anchorId: 'we://p/1' } },
  { id: 's.empty-string', op: 'scope', scope: { anchorId: '' } },
  { id: 's.null', op: 'scope', scope: { anchorId: null } },
  { id: 's.undefined', op: 'scope', scope: { anchorId: U } },
  { id: 's.absent', op: 'scope', scope: { predicate: 'comment' } },
  { id: 's.empty-list', op: 'scope', scope: { anchorId: [] } },
  { id: 's.list', op: 'scope', scope: { anchorId: ['a', 'b'] } },
  { id: 's.nonobject', op: 'scope', scope: 'anchor' },
  { id: 's.null-scope', op: 'scope', scope: null },
  { id: 's.zero-anchor', op: 'scope', scope: { anchorId: 0 } },
];
