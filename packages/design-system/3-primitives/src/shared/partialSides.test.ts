import { getPaddingValues, getRadiusValues } from '@we/design-utils';
import { describe, expect, it } from 'vitest';

import { cascadeRestFor } from './helpers';

/**
 * Naming one corner leaves the others to the theme.
 *
 * Both builders assemble ONE declaration out of four values, so a single named corner decides all
 * four. Unnamed ones used to take the `'0'` fallback, which is right when there is nothing behind
 * the props and wrong for every registered primitive: `rl: '0'` on a `we-button` squared the left
 * side as asked and silently squared the right side too, discarding the cascade it was reading.
 *
 * It read as a `we-select` quirk — that is where it was noticed and worked around, by hand-copying
 * `we-button`'s four-deep radius chain into `rr` — and it was general.
 */

/** The four values of a shorthand, splitting only at depth 0 — every value here holds `var(a, b)`. */
function sides(shorthand: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of shorthand) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ' ' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

describe('a named corner does not silence the others', () => {
  const buttonRest = cascadeRestFor('button', 'radius')!;

  it('button has a cascade to fall back to', () => {
    expect(buttonRest).toContain('--we-theme-control-radius');
  });

  it('the unnamed corners keep reading it', () => {
    const [tl, tr, br, bl] = sides(getRadiusValues({ rl: '0' }, buttonRest));
    // Left corners squared as asked; right corners still on the chain.
    expect(tl).toBe('0');
    expect(bl).toBe('0');
    expect(tr).toContain('--we-theme-control-radius');
    expect(br).toContain('--we-theme-control-radius');
  });

  it('and did not, before the fix', () => {
    // The old behaviour, reproduced by omitting the fallback — kept so the regression is legible.
    expect(getRadiusValues({ rl: '0' })).toBe('0 0 0 0');
  });
});

describe('the same applies to padding', () => {
  it('an x-only padding leaves the vertical to the cascade', () => {
    const rest = 'var(--we-theme-input-padding, var(--we-space-300))';
    const [top, right] = sides(getPaddingValues({ px: '400' }, rest));
    expect(right).toBe('var(--we-space-400)');
    expect(top).toBe(rest);
  });
});

describe('an unregistered component still gets zero', () => {
  it('because there is genuinely nothing behind the props', () => {
    // Not every component has a family. Where there is no chain, `0` is the honest answer and the
    // behaviour is unchanged.
    expect(cascadeRestFor('we-nonexistent', 'radius')).toBeUndefined();
  });
});
