/**
 * A list of a space's content is bounded by default.
 *
 * `cardList` is the shape every section of the cards route uses, so an unbounded default is every
 * content type in the space read whole — fetched, hydrated and fingerprinted — on every change to
 * any of it. A feed is read from the top, so a page of it is what anybody actually looks at.
 *
 * The two rules worth pinning are the default and its exception: a caller that named its own bound
 * keeps it, because it has decided something this fragment cannot see the reason for.
 */
import type { QueryStateField, SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { cardList } from './cards.ts';

const empty: SchemaNode = { type: 'we-text', children: ['none'] };
const build = (query: QueryStateField | undefined, pageSize?: number | null) =>
  cardList({ ...(query && { query }), as: 'post', empty, children: [], ...(pageSize !== undefined && { pageSize }) });

/** The declared query, wherever `cardList` put it. */
const queryOf = (node: SchemaNode) =>
  Object.values((node as { $queries: Record<string, QueryStateField> }).$queries)[0];

describe('cardList paging', () => {
  it('bounds a query that named no limit, and offers more', () => {
    const node = build({ entity: 'CollectionBlock' } as QueryStateField);
    expect(queryOf(node).limit).toEqual({ $: 'local.postPageSize' });
    expect((node as { $localState: Record<string, unknown> }).$localState.postPageSize).toMatchObject({
      type: 'number',
    });
    expect(JSON.stringify(node)).toContain('Load more');
  });

  /*
    The exception. A list that wrote its own bound has already decided how much it wants — the
    recorded-calls list asks for twenty — and replacing that with a page would be this fragment
    overruling a decision it cannot see the reason for.
  */
  it("leaves a caller's own limit alone, and adds no control", () => {
    const node = build({ entity: 'CollectionBlock', limit: 20 } as unknown as QueryStateField);
    expect(queryOf(node).limit).toBe(20);
    expect(JSON.stringify(node)).not.toContain('Load more');
  });

  /*
    And an explicit refusal, for a list whose completeness is load-bearing rather than merely long —
    a vocabulary, a set of folders, anything where showing some of it would be wrong.
  */
  it('reads everything when asked to', () => {
    const node = build({ entity: 'CollectionBlock' } as QueryStateField, null);
    expect(queryOf(node).limit).toBeUndefined();
    expect(JSON.stringify(node)).not.toContain('Load more');
  });

  /** A list handed an array has nothing to page — the rows are already in hand. */
  it('leaves an items-backed list alone', () => {
    const node = cardList({ items: { $: 'local.rows' }, as: 'post', empty, children: [] });
    expect(JSON.stringify(node)).not.toContain('Load more');
    expect(node).not.toHaveProperty('$queries');
  });
});
