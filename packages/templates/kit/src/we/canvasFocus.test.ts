/**
 * A focus on a canvas, as the rules it becomes. Evaluated by the expression engine the renderer uses,
 * against the values a template would bind.
 */
import { evaluateExpression, listFunctions, parseExpression } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { FOCUS_DIM, focusDim, focusLight } from './canvas.ts';

const run = (prop: unknown, roots: Record<string, unknown>) =>
  evaluateExpression(parseExpression((prop as { $: string }).$), {
    root: (name) => ({ bound: name in roots, value: roots[name] }),
    call: (name, args) =>
      listFunctions()
        .find((f) => f.name === name)
        ?.impl(args, { context: {}, stores: {} }),
  });

describe('a focus on a canvas', () => {
  it('dims every card whose field is not the focus, and nothing while there is no focus', () => {
    const rule = focusDim('on', 'data.origin', 'call');
    expect(run(rule, { on: true, call: 'call-1' })).toEqual([
      { when: { 'data.origin': { not: 'call-1' } }, style: { opacity: FOCUS_DIM } },
    ]);
    expect(run(rule, { on: false, call: 'call-1' })).toEqual([]);
  });

  it('takes a list of values, for the records in a workflow', () => {
    expect(run(focusDim('on', 'data.recordId', 'ids'), { on: true, ids: ['a', 'b'] })).toEqual([
      { when: { 'data.recordId': { not: ['a', 'b'] } }, style: { opacity: FOCUS_DIM } },
    ]);
  });

  it('lights several things at once: everything dimmed, then each clause drawn whole', () => {
    const keep = [{ 'data.bucket': 'signals' }, { 'data.recordId': 'like' }];
    expect(run(focusLight('on', 'keep'), { on: true, keep })).toEqual([
      { style: { opacity: FOCUS_DIM } },
      // One level of nesting, which a graph's rule list flattens.
      keep.map((when) => ({ when, style: { opacity: 1 } })),
    ]);
    expect(run(focusLight('on', 'keep'), { on: false, keep })).toEqual([]);
  });
});
