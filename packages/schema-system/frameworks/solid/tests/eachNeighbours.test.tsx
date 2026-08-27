/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * `$each` exposes `$index` and `$prev`.
 *
 * `$prev` is the one that unlocked something. A template could previously only ask about the row it
 * was on, so any design where a row depends on its neighbour was unreachable — most importantly
 * *grouping*: a chat log that repeats the avatar and byline on every consecutive message from the
 * same person is a visibly different, and much less dense, design from one that collapses them. No
 * prop and no theme could recover it; it needed a view of the row before.
 */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';

const Stack = (p: any) => <div>{p.children}</div>;
const registry: ComponentRegistry = { Stack };

const MESSAGES = [
  { id: 'm1', author: 'ada', text: 'first' },
  { id: 'm2', author: 'ada', text: 'second' },
  { id: 'm3', author: 'bo', text: 'third' },
  { id: 'm4', author: 'ada', text: 'fourth' },
];

function renderSchema(node: SchemaNode) {
  return render(() => RenderSchema({ node, stores: {} as any, registry }) as any);
}

describe('$each neighbour context', () => {
  it('exposes the row position', () => {
    const { container } = renderSchema({
      type: 'Stack',
      children: [
        {
          type: '$each',
          props: { items: MESSAGES, as: 'message' },
          children: [{ type: 'Stack', children: [{ $: 'index' }, ':', { $: 'message.text' }, ' '] }],
        },
      ],
    });
    expect(container.textContent).toContain('0:first');
    expect(container.textContent).toContain('3:fourth');
  });

  it('exposes the previous row, and nothing on the first', () => {
    const { container } = renderSchema({
      type: 'Stack',
      children: [
        {
          type: '$each',
          props: { items: MESSAGES, as: 'message' },
          children: [{ type: 'Stack', children: ['[', { $: 'prev.text' }, ']'] }],
        },
      ],
    });
    // The first row has no predecessor, so `$prev.text` resolves to nothing rather than throwing or
    // wrapping round to the last item.
    expect(container.textContent).toBe('[][first][second][third]');
  });

  it('makes grouping expressible — the case it exists for', () => {
    const { container } = renderSchema({
      type: 'Stack',
      children: [
        {
          type: '$each',
          props: { items: MESSAGES, as: 'message' },
          children: [
            {
              type: '$if',
              props: {
                condition: { $: 'message.author == prev.author' },
                then: { type: 'Stack', children: ['· ', { $: 'message.text' }, ' '] },
                else: { type: 'Stack', children: [{ $: 'message.author' }, ': ', { $: 'message.text' }, ' '] },
              },
            },
          ],
        },
      ],
    });

    // m2 follows m1 by the same author and loses its byline; m4 follows bo, so keeps it. The first
    // row keeps its byline because `$prev` is absent, not because the authors differ — which is the
    // behaviour a feed needs and the reason absent must not equal the last item.
    expect(container.textContent).toBe('ada: first · second bo: third ada: fourth ');
  });

  it('shadows in a nested $each, like the item does', () => {
    const { container } = renderSchema({
      type: 'Stack',
      children: [
        {
          type: '$each',
          props: { items: [{ rows: ['a', 'b'] }, { rows: ['c'] }], as: 'group' },
          children: [
            {
              type: '$each',
              props: { items: { $: 'group.rows' }, as: 'row' },
              children: [{ type: 'Stack', children: [{ $: 'index' }, { $: 'row' }, ' '] }],
            },
          ],
        },
      ],
    });
    // The inner index restarts rather than continuing the outer one.
    expect(container.textContent).toBe('0a 1b 0c ');
  });
});
