import { evaluateExpression, listFunctions, parseExpression } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { KIND_CARD_RULES, kindCardFill, kindDisc, kindGlyph } from './kindColour.ts';

/**
 * What a kind is drawn in, checked by running the expressions — strings assembled from parts, which
 * nothing typechecks: a misplaced bracket draws every card plain, which is also what an uncoloured
 * kind looks like.
 */
const run = (source: string, roots: Record<string, unknown>) =>
  evaluateExpression(parseExpression(source), {
    root: (name: string) => ({ bound: name in roots, value: roots[name] }),
    call: (name: string, args: unknown[]) =>
      listFunctions()
        .find((f) => f.name === name)
        ?.impl(args, {} as never),
  } as never);

const recordStore = {
  kinds: [
    { value: 'TaskBlock', hue: 'blue' },
    { value: 'Proposal', hue: 'cyan' },
  ],
};
const roots = (typeStyles: { nodeType: string; color: string }[] = []) => ({
  recordStore,
  local: { typeStyles },
  kind: 'TaskBlock',
});

describe('a kind’s colour', () => {
  it('is its own hue, through the theme’s roles for it', () => {
    expect(run(kindCardFill('kind'), roots())).toBe('blue-soft');
    expect(run(kindGlyph('kind'), roots())).toBe('blue-text');
    expect(run(kindDisc('kind'), roots())).toBe('blue-soft');
  });

  it('is the community’s where it chose one: a palette name through its roles, anything else as chosen', () => {
    expect(run(kindCardFill('kind'), roots([{ nodeType: 'TaskBlock', color: 'teal' }]))).toBe('teal-soft');
    const hex = roots([{ nodeType: 'TaskBlock', color: '#123456' }]);
    expect(run(kindCardFill('kind'), hex)).toBe('#123456');
    expect(run(kindGlyph('kind'), hex)).toBe('#123456');
    // A chosen colour is not a tint, so its glyph sits on the raised surface rather than on itself.
    expect(run(kindDisc('kind'), hex)).toBe('surface-raised');
  });

  it('leaves a kind it knows nothing about to the ordinary text colour', () => {
    expect(run(kindGlyph('kind'), { ...roots(), kind: 'Unknown' })).toBe('text');
  });

  it('gives the canvas a rule per kind', () => {
    const rules = run((KIND_CARD_RULES as { $: string }).$, roots([{ nodeType: 'Proposal', color: 'red' }]));
    expect(rules).toEqual([
      { when: { type: 'TaskBlock' }, style: { color: 'blue-soft' } },
      { when: { type: 'Proposal' }, style: { color: 'red-soft' } },
    ]);
  });
});
