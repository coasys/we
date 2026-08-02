/**
 * Round-trip corpus: every distinct `$query` shape our real templates use, mapped to the QueryIR and
 * back. This is the load-bearing proof that the IR expresses what the app actually needs.
 *
 * The shapes are the **token-resolved** forms of the real queries (the IR sits below `$local`/`$store`/
 * `$if` resolution, so a `{ $local: 'searchText' }` becomes a concrete value, and an `order: { $if }`
 * becomes its resolved branch). Each is annotated with the source schema file it was lifted from.
 *
 * `SUPPORTED` must translate with an empty `unsupported` list AND round-trip losslessly
 * (`flat → IR → flat → IR` re-derives the identical IR). The one drill-down shape uses the neutral
 * `scope` — not a round-trip case (`irToFlatQuery` defers it to the adapter), so it's covered by the
 * `scope`→predicate resolution tests in `ad4mAdapter.test.ts`.
 */
import { compileQuery, type FlatQuery, irToFlatQuery } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

// Fully-neutral-expressible real query shapes (token values concretised).
const SUPPORTED: { name: string; query: FlatQuery }[] = [
  {
    name: 'SpacesList — sibling scalar + OR search, relation-path sort, hydrate relation',
    query: {
      entity: 'Space',
      where: { url: { not: 'cid://self' }, OR: [{ name: { contains: 'x' } }, { description: { contains: 'x' } }] },
      limit: 20,
      order: { 'location.country': 'asc' }, // resolved $if branch
      include: { location: true },
    },
  },
  {
    name: 'SpacesList — other sort branch (own scalar)',
    query: { entity: 'Space', where: { OR: [{ name: { contains: 'x' } }] }, limit: 20, order: { createdAt: 'desc' } },
  },
  {
    name: 'PostsList — count projection + aggregate-alias sort + plain include',
    query: {
      entity: 'CollectionBlock',
      where: { type: 'root', textContent: { contains: 'x' } },
      limit: 20,
      order: { $likeCount: 'desc' }, // resolved $if branch — sort by the count projection
      include: {
        signals: true,
        $likeCount: { from: 'signals', where: { signalTypeId: 'like-id' }, count: true },
      },
    },
  },
  { name: 'PostsList — hoisted $queries (bare model + subscribe)', query: { entity: 'SignalType', subscribe: true } },
  {
    name: 'FluxChannelsList — OR search, timestamp sort, plain include + two count projections',
    query: {
      entity: 'Channel',
      where: { OR: [{ name: { contains: 'x' } }, { description: { contains: 'x' } }] },
      order: { timestamp: 'desc' },
      limit: 20,
      include: {
        conversations: true,
        $messageCount: { from: 'messages', count: true, where: { type: 'flux://has_message' } },
        $conversationCount: { from: 'conversations', count: true, where: { type: 'flux://conversation' } },
      },
    },
  },
  {
    name: 'FluxConversationsNestedList — OR search, sort, single count projection',
    query: {
      entity: 'Conversation',
      where: { OR: [{ conversationName: { contains: 'x' } }, { summary: { contains: 'x' } }] },
      order: { timestamp: 'desc' },
      limit: 20,
      include: {
        $subgroupCount: { from: 'subgroupEntities', count: true, where: { type: 'flux://conversation_subgroup' } },
      },
    },
  },
  {
    name: 'ConversationList — simple model + order + limit',
    query: {
      entity: 'Conversation',
      order: { timestamp: 'desc' },
      limit: 10,
    },
  },
];

describe('real template $query corpus', () => {
  for (const { name, query } of SUPPORTED) {
    it(`maps + round-trips: ${name}`, () => {
      const { ir, unsupported } = compileQuery(query);
      expect(unsupported).toEqual([]);
      // flat → IR → flat → IR re-derives the identical IR (the losslessness guarantee)
      const ir2 = compileQuery(irToFlatQuery(ir)).ir;
      expect(ir2).toEqual(ir);
    });
  }
});
