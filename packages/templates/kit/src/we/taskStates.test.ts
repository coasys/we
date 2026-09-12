import { evaluateExpression, listFunctions, parseExpression } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { STATE_FILLS, STATE_ICONS, stateFill, stateFillFor, stateIcon } from './taskStates.ts';

/**
 * What a state is drawn with, checked by running the expressions rather than by reading them.
 *
 * These are strings assembled from a table, so nothing typechecks them: a missing bracket, a branch
 * that never matches, or a chain that answers the wrong arm all look identical to TypeScript and to
 * the schema validator, which only asks whether the expression *parses*. Both surfaces that read
 * these — the workshop's key and Settings → Vocabulary — would show a plain card and no glyph, which
 * is also what an unset colour looks like.
 */
const run = (source: string, roots: Record<string, unknown>) =>
  evaluateExpression(parseExpression(source), {
    root: (name: string) => ({ bound: name in roots, value: roots[name] }),
    call: (name: string, args: unknown[]) =>
      listFunctions()
        .find((f) => f.name === name)
        ?.impl(args, {} as never),
  } as never);

const state = (fields: Record<string, unknown>) => ({ state: { name: 'x', slug: 'x', ...fields } });

describe('a state’s fill', () => {
  it('answers the community’s colour where there is one', () => {
    expect(run(stateFill('state'), state({ color: '#abcdef', semantic: 'done' }))).toBe('#abcdef');
  });

  it('answers the table for the semantic where there is not', () => {
    for (const [semantic, fill] of Object.entries(STATE_FILLS)) {
      expect(run(stateFill('state'), state({ color: '', semantic })), semantic).toBe(fill);
    }
  });

  /*
    The rule every chain over `semantic` in the app follows: a value a peer's older code does not
    recognise reads as outstanding rather than as an error — see `SEMANTIC_LABEL` in the vocabulary
    section for the same rule stated about words.
  */
  it('reads a semantic it does not know as still-to-do', () => {
    expect(run(stateFill('state'), state({ color: '', semantic: 'parked' }))).toBe(STATE_FILLS.open);
  });

  it('answers from a bare semantic too, for a form that has no record yet', () => {
    expect(run(stateFillFor('local.semantic'), { local: { semantic: 'active' } })).toBe(STATE_FILLS.active);
  });

  /*
    A card is an object on a canvas, not a tinted panel on a page. The roles these replaced are ramp
    steps that invert with the theme, which put "done" four points off the canvas's own ground in a
    dark theme and darker than an uncoloured card. An absolute colour is the same colour in both.
  */
  it('is an absolute colour, so a finished card is green in either polarity', () => {
    for (const [semantic, fill] of Object.entries(STATE_FILLS)) {
      expect(fill, semantic).toMatch(/^(#|rgb|hsl|oklch|oklab|lab|lch|hwb|color)/i);
      expect(fill, semantic).not.toMatch(/var\(--we-/);
    }
  });
});

describe('a state’s glyph', () => {
  it('answers the community’s icon where there is one', () => {
    expect(run(stateIcon('state'), state({ icon: 'rocket', semantic: 'open' }))).toBe('rocket');
  });

  it('answers the shape for what it counts as where there is not', () => {
    for (const [semantic, icon] of Object.entries(STATE_ICONS)) {
      expect(run(stateIcon('state'), state({ icon: '', semantic })), semantic).toBe(icon);
    }
  });
});
