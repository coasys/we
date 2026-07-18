/**
 * Round-trip corpus: every distinct `$query` shape our real templates use, mapped to the QueryIR and
 * back. This is the load-bearing proof that the IR expresses what the app actually needs.
 *
 * The shapes are the **token-resolved** forms of the real queries (the IR sits below `$local`/`$store`/
 * `$if` resolution, so a `{ $local: 'searchText' }` becomes a concrete value, and an `order: { $if }`
 * becomes its resolved branch). Each is annotated with the source schema file it was lifted from.
 *
 * `SUPPORTED` must translate with an empty `unsupported` list AND round-trip losslessly
 * (`legacy → IR → legacy → IR` re-derives the identical IR). `FLAGGED` must be surfaced in
 * `unsupported` — today only the `parent` drill-down, which needs migrating to `scope: { anchor, via }`
 * (see the gap-handling note in the portability docs).
 */
import { irToLegacyQuery, type LegacyQuery, translateLegacyQuery } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

// Fully-neutral-expressible real query shapes (token values concretised).
const SUPPORTED: { name: string; query: LegacyQuery }[] = [
  {
    name: 'SpacesList — sibling scalar + OR search, relation-path sort, hydrate relation',
    query: {
      model: 'Space',
      where: { url: { not: 'cid://self' }, OR: [{ name: { contains: 'x' } }, { description: { contains: 'x' } }] },
      limit: 20,
      order: { 'location.country': 'asc' }, // resolved $if branch
      include: { location: true },
    },
  },
  {
    name: 'SpacesList — other sort branch (own scalar)',
    query: { model: 'Space', where: { OR: [{ name: { contains: 'x' } }] }, limit: 20, order: { createdAt: 'desc' } },
  },
  {
    name: 'PostsList — count projection + aggregate-alias sort + plain include',
    query: {
      model: 'CollectionBlock',
      where: { type: 'root', textContent: { contains: 'x' } },
      limit: 20,
      order: { $likeCount: 'desc' }, // resolved $if branch — sort by the count projection
      include: {
        signals: true,
        $likeCount: { from: 'signals', where: { signalTypeId: 'like-id' }, count: true },
      },
    },
  },
  { name: 'PostsList — hoisted $queries (bare model + subscribe)', query: { model: 'SignalType', subscribe: true } },
  {
    name: 'FluxChannelsList — OR search, timestamp sort, plain include + two count projections',
    query: {
      model: 'Channel',
      perspective: 'adamStore.currentPerspective',
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
      model: 'Conversation',
      perspective: 'adamStore.currentPerspective',
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
      model: 'Conversation',
      perspective: 'adamStore.currentPerspective',
      order: { timestamp: 'desc' },
      limit: 10,
    },
  },
];

// Shapes that legitimately can't become a neutral IR yet — surfaced, not silently mis-translated.
const FLAGGED: { name: string; query: LegacyQuery; expect: RegExp }[] = [
  {
    name: 'FluxConversationsNestedList — parent drill-down (raw-predicate escape hatch)',
    query: {
      model: 'ConversationSubgroup',
      perspective: 'adamStore.currentPerspective',
      parent: { id: 'c1', predicate: 'ad4m://has_child' },
    },
    expect: /parent \(drill-down\)/,
  },
];

describe('real template $query corpus', () => {
  for (const { name, query } of SUPPORTED) {
    it(`maps + round-trips: ${name}`, () => {
      const { ir, unsupported } = translateLegacyQuery(query);
      expect(unsupported).toEqual([]);
      // legacy → IR → legacy → IR re-derives the identical IR (the losslessness guarantee)
      const ir2 = translateLegacyQuery(irToLegacyQuery(ir)).ir;
      expect(ir2).toEqual(ir);
    });
  }

  for (const { name, query, expect: pattern } of FLAGGED) {
    it(`flags (not yet neutrally expressible): ${name}`, () => {
      const { unsupported } = translateLegacyQuery(query);
      expect(unsupported.some((u) => pattern.test(u))).toBe(true);
    });
  }
});
