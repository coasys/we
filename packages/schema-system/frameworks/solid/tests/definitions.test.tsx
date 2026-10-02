/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A compacted template renders exactly what it rendered before it was compacted.
 *
 * `compactDefinitions` lifts a repeated shape into `$defs` and leaves a `$ref` behind; the point
 * of the exercise is that nothing downstream can tell. The unit tests next to the pass assert the
 * tree round-trips, which is necessary and not sufficient — it says the data is recoverable, not
 * that the renderer recovers it. This renders both forms and compares the DOM.
 *
 * It matters that the comparison is against the SAME tree rather than against expected markup: a
 * test written as "the compacted one produces this HTML" would pass just as happily if compaction
 * and the renderer were wrong in the same direction.
 */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import { compactDefinitions } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';

const Stack = (p: any) => <div class="stack">{p.children}</div>;
const registry: ComponentRegistry = { Stack };

const draw = (node: SchemaNode) => render(() => RenderSchema({ node, stores: {} as any, registry }) as any);

/** Big enough to clear the hoisting threshold, so the fixtures exercise the real default. */
const panel = (title: string): SchemaNode => ({
  type: 'Stack',
  props: { gap: '300', p: '400', bg: 'surface', r: 'surface', width: '100%', minHeight: '40px' },
  children: [
    { type: 'Stack', props: { ay: 'center', gap: '200' }, children: [title] },
    { type: 'Stack', props: { color: 'text-muted', variant: 'footnote' }, children: ['A line of supporting text.'] },
  ],
});

describe('rendering a template that carries definitions', () => {
  it('draws what the uncompacted tree draws', () => {
    const plain: SchemaNode = { type: 'Stack', children: [panel('Same'), panel('Same'), panel('Same')] };
    const { schema, hoisted } = compactDefinitions(plain);
    expect(hoisted).toBe(1); // Otherwise the comparison below proves nothing.

    expect(draw(schema).container.innerHTML).toBe(draw(plain).container.innerHTML);
  });

  it('draws definitions that reference other definitions', () => {
    const inner = panel('Shared');
    const group = (): SchemaNode => ({ type: 'Stack', props: { gap: '400' }, children: [inner, inner] });
    const plain: SchemaNode = { type: 'Stack', children: [group(), group()] };
    const { schema, hoisted } = compactDefinitions(plain);
    expect(hoisted).toBeGreaterThan(1);

    expect(draw(schema).container.innerHTML).toBe(draw(plain).container.innerHTML);
  });

  it('draws a shape referenced from inside a control-flow branch', () => {
    // `$if` holds its branches in props rather than children, which is a different edge of the
    // walk — and the one a shell's bulk actually hangs off.
    const plain: SchemaNode = {
      type: 'Stack',
      children: [
        { type: '$if', props: { condition: { $: 'true' }, then: panel('Branch'), else: panel('Branch') } },
        panel('Branch'),
      ],
    };
    const { schema, hoisted } = compactDefinitions(plain);
    expect(hoisted).toBe(1);

    expect(draw(schema).container.innerHTML).toBe(draw(plain).container.innerHTML);
  });
});
