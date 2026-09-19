/**
 * The thread's row-selection expressions, evaluated rather than matched.
 *
 * A flat read plus a filter per level means the *expression* is the tree: get it wrong and every
 * reply draws at the top with no error anywhere, which is exactly what happened. Asserting on the
 * emitted string would have caught that only by accident, so these evaluate it against rows.
 */
import { evaluateExpression, listFunctions, parseExpression } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { commentThread, resetTopLimit } from './commentThread.ts';

type Node = {
  type?: string;
  props?: Record<string, unknown>;
  children?: Node[];
  $queries?: Record<string, { scope: { levels: unknown[] } }>;
  $localState?: Record<string, { initial?: unknown }>;
};

/** The `items` expression of each reply level, outermost first. */
function levelExpressions(node: Node): string[] {
  const out: string[] = [];
  const walk = (n: Node | undefined): void => {
    if (!n || typeof n !== 'object') return;
    if (n.type === '$each' && String((n.props as { as?: string })?.as ?? '').startsWith('reply')) {
      const items = (n.props as { items?: { $?: string } })?.items;
      if (items?.$) out.push(items.$);
    }
    for (const child of n.children ?? []) walk(child);
    const props = n.props as { then?: Node; else?: Node } | undefined;
    walk(props?.then);
    walk(props?.else);
  };
  walk(node);
  return out;
}

const rows = [
  { id: 'c1', inReplyTo: { id: 'card-1' } },
  { id: 'c2', inReplyTo: { id: 'card-1' } },
  { id: 'r1', inReplyTo: { id: 'c1' } },
  { id: 'rr1', inReplyTo: { id: 'r1' } },
];

const evaluate = (source: string, roots: Record<string, unknown>) =>
  evaluateExpression(parseExpression(source), {
    root: (name: string) => ({ bound: name in roots, value: roots[name] }),
    call: (name: string, args: unknown[]) => {
      const fn = listFunctions().find((f) => f.name === name);
      return fn ? fn.impl(args, { context: {}, stores: {} }) : undefined;
    },
  }) as { id: string }[];

describe('commentThread row selection', () => {
  const thread = commentThread({
    anchorId: { $: 'local.root ? local.root : row.id' },
    reply: () => [{ type: 'we-text' }],
  }) as Node;
  const [top, second, third] = levelExpressions(thread);

  /**
   * The bug this exists for. The anchor is an arbitrary caller expression — here a ternary, because
   * a thread can be re-rooted on a reply — and `==` binds tighter than `?:`. Spliced in bare, the
   * predicate became `(r.inReplyTo.id == local.root) ? local.root : row.id`, whose value is a
   * non-empty id: truthy for every row. The whole subtree drew as top-level replies.
   */
  it('takes only the anchor’s own replies at the top level', () => {
    const got = evaluate(top, { local: { threadRows: rows, root: '' }, row: { id: 'card-1' } });
    expect(got.map((r) => r.id)).toEqual(['c1', 'c2']);
  });

  it('follows the re-rooted anchor when the thread is opened on a reply', () => {
    const got = evaluate(top, { local: { threadRows: rows, root: 'c1' }, row: { id: 'card-1' } });
    expect(got.map((r) => r.id)).toEqual(['r1']);
  });

  it('takes each deeper level from the reply above it', () => {
    expect(evaluate(second, { local: { threadRows: rows }, reply: { id: 'c1' } }).map((r) => r.id)).toEqual(['r1']);
    expect(evaluate(third, { local: { threadRows: rows }, reply2: { id: 'r1' } }).map((r) => r.id)).toEqual(['rr1']);
  });

  it('draws nothing under a reply nobody answered', () => {
    expect(evaluate(second, { local: { threadRows: rows }, reply: { id: 'c2' } })).toEqual([]);
  });
});

/**
 * Silent truncation was the gap: a thread capped at ten top-level replies looked exactly like a
 * thread with ten in it.
 */
describe('commentThread truncation', () => {
  const thread = commentThread({
    anchorId: { $: 'row.id' },
    anchorTotal: 'count(row.comments)',
    perLevel: [2, 1],
    depth: 2,
    more: (as) => ({ type: 'we-button', children: [{ $: `${as}.id` }] }),
    reply: () => [{ type: 'we-text' }],
  }) as Node;

  /** Every `$if` condition in the tree, so the "level came back full" tests can be found. */
  function conditions(node: Node): string[] {
    const out: string[] = [];
    const walk = (n: Node | undefined): void => {
      if (!n || typeof n !== 'object') return;
      const props = n.props as { condition?: { $?: string }; then?: Node; else?: Node } | undefined;
      if (n.type === '$if' && props?.condition?.$) out.push(props.condition.$);
      for (const child of n.children ?? []) walk(child);
      walk(props?.then);
      walk(props?.else);
    };
    walk(node);
    return out;
  }

  it('asks the backend for the top level’s breadth as a local, so it can grow', () => {
    const scope = thread.$queries!.threadRows.scope;
    expect(scope.levels[0]).toEqual({ $: 'local.topReplies' });
    // The levels below are fixed: a deeper one is widened by opening the branch, not in place.
    expect(scope.levels[1]).toBe(1);
  });

  /**
   * Counted, not guessed: the offer appears when replies exist that are not drawn, which is exactly
   * what a reader means by "show more". Testing whether a level came back FULL cannot tell ten of
   * ten from ten of eleven, so it offered more that sometimes revealed nothing.
   */
  it('offers more only when replies exist that are not drawn', () => {
    const offers = conditions(thread).filter((c) => c.includes('> 0') && c.includes('count('));
    expect(offers.length).toBeGreaterThan(0);
    // A deeper level counts its own parent's replies against the rows it drew.
    expect(offers.some((c) => c.includes('reply.comments'))).toBe(true);
  });

  it('says nothing at the top level when the caller cannot say how many there are', () => {
    const withoutTotal = commentThread({
      anchorId: { $: 'row.id' },
      perLevel: [1],
      depth: 1,
      reply: () => [{ type: 'we-text' }],
    }) as Node;
    expect(conditions(withoutTotal).some((c) => c.includes('local.topReplies +'))).toBe(false);
  });

  it('starts the local at the caller’s own top-level breadth', () => {
    expect(thread.$localState!.topReplies.initial).toBe(2);
  });
});

/**
 * "Show me more of this" is about the list in front of you, not a preference to carry into every
 * branch opened afterwards — which is how Reddit and every threaded reader behave, and the
 * alternative compounds: expand once, open three branches, and each fetches the expanded number.
 */
describe('resetTopLimit', () => {
  it('returns to the caller’s own starting breadth, not the fragment’s default', () => {
    expect(resetTopLimit([4, 2])).toEqual({ $setLocal: 'topReplies', value: 4 });
  });

  it('falls back to the default breadth when the caller named none', () => {
    expect(resetTopLimit()).toEqual({ $setLocal: 'topReplies', value: 10 });
  });

  it('writes the same local the thread declares and grows', () => {
    const thread = commentThread({
      anchorId: { $: 'row.id' },
      perLevel: [4, 2],
      reply: () => [{ type: 'we-text' }],
    }) as Node;
    const reset = resetTopLimit([4, 2]) as { $setLocal: string };
    expect(thread.$localState![reset.$setLocal].initial).toBe(4);
  });
});

/**
 * `anchorTotal` is the caller's expression and may be any shape — `discussionSection` passes a
 * ternary, because the thread can be re-rooted onto a reply. Interpolating one without brackets has
 * been wrong three times now, so this evaluates the emitted arithmetic rather than reading it.
 */
describe('commentThread truncation arithmetic', () => {
  /** The `hidden` expression the top-level offer is built from. */
  function topOfferCondition(node: Node): string {
    const found: string[] = [];
    const walk = (n: Node | undefined): void => {
      if (!n || typeof n !== 'object') return;
      const props = n.props as { condition?: { $?: string }; then?: Node; else?: Node } | undefined;
      if (n.type === '$if' && props?.condition?.$?.includes('> 0')) found.push(props.condition.$);
      for (const child of n.children ?? []) walk(child);
      walk(props?.then);
      walk(props?.else);
    };
    walk(node);
    return found[0];
  }

  const thread = commentThread({
    anchorId: { $: 'root ? root : card.id' },
    anchorTotal: 'root ? count(first(focus).comments) : count(card.comments)',
    perLevel: [1],
    depth: 1,
    reply: () => [{ type: 'we-text' }],
  }) as Node;

  const rows = [
    { id: 'x', inReplyTo: { id: 'focused' } },
    { id: 'y', inReplyTo: { id: 'card-1' } },
    { id: 'z', inReplyTo: { id: 'card-1' } },
  ];

  const offers = (roots: Record<string, unknown>) =>
    evaluateExpression(parseExpression(topOfferCondition(thread)), {
      root: (name: string) => ({ bound: name in roots, value: roots[name] }),
      call: (name: string, args: unknown[]) => {
        const fn = listFunctions().find((f) => f.name === name);
        return fn ? fn.impl(args, { context: {}, stores: {} }) : undefined;
      },
    });

  it('offers nothing when a re-rooted thread is showing everything it has', () => {
    // One reply under the focused row, and it is drawn: nothing is hidden.
    const local = { threadRows: rows, topReplies: 1 };
    expect(offers({ local, root: 'focused', focus: [{ comments: ['x'] }], card: { id: 'card-1' } })).toBe(false);
  });

  it('offers what is left when a re-rooted thread is showing some of them', () => {
    const local = { threadRows: rows, topReplies: 1 };
    expect(offers({ local, root: 'focused', focus: [{ comments: ['x', 'x2'] }], card: { id: 'card-1' } })).toBe(true);
  });

  it('counts against the record when the thread is not re-rooted', () => {
    const local = { threadRows: rows, topReplies: 2 };
    // Two drawn under the card, two it has: nothing hidden.
    expect(offers({ local, root: '', focus: [], card: { id: 'card-1', comments: ['y', 'z'] } })).toBe(false);
  });
});
