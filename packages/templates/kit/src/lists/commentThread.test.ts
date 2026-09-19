/**
 * The thread's row-selection expressions, evaluated rather than matched.
 *
 * A flat read plus a filter per level means the *expression* is the tree: get it wrong and every
 * reply draws at the top with no error anywhere, which is exactly what happened. Asserting on the
 * emitted string would have caught that only by accident, so these evaluate it against rows.
 */
import { evaluateExpression, listFunctions, parseExpression } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { commentThread } from './commentThread.ts';

type Node = { type?: string; props?: Record<string, unknown>; children?: Node[] };

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
