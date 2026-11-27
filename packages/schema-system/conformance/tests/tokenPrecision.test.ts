import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { normaliseTokenNumbers, roundTokenNumber } from '../src/tokenPrecision';

const TOKENS = join(__dirname, '..', 'vectors', 'tokens');

describe('token precision', () => {
  it('reads two Chromes serialising one colour as the same value', () => {
    // Both pairs are from CI: the runner's Chrome against the one that recorded the tables.
    expect(normaliseTokenNumbers('oklab(0.97725 0.0000485216 -0.00277974)')).toBe(
      normaliseTokenNumbers('oklab(0.97725 0.0000485202 -0.00277974)'),
    );
    expect(normaliseTokenNumbers('color(srgb 0.270313 0.5 0.1 / 0.4)')).toBe(
      normaliseTokenNumbers('color(srgb 0.270312 0.5 0.1 / 0.4)'),
    );
    expect(normaliseTokenNumbers('oklab(0.97725 0.0000485216 -0.00277974)')).toBe('oklab(0.9773 0 -0.0028)');
  });

  it('rounds to four places, trims trailing zeros and never writes -0', () => {
    expect(roundTokenNumber(0.270313)).toBe('0.2703');
    expect(roundTokenNumber(0.5)).toBe('0.5');
    expect(roundTokenNumber(288)).toBe('288');
    expect(roundTokenNumber(-0.00001)).toBe('0');
    expect(roundTokenNumber(4.85216e-5)).toBe('0');
    expect(roundTokenNumber(-0.4)).toBe('-0.4');
    expect(roundTokenNumber('0.97725')).toBe('0.9773');
    expect(roundTokenNumber('-0.00025')).toBe('-0.0003');
    expect(roundTokenNumber('0.99995')).toBe('1');
    expect(roundTokenNumber('.5')).toBe('0.5');
    expect(roundTokenNumber('12.')).toBe('12');
  });

  it('rounds the numbers and leaves the words', () => {
    expect(normaliseTokenNumbers('color(display-p3 0.123456 1 0)')).toBe('color(display-p3 0.1235 1 0)');
    expect(normaliseTokenNumbers('oklch(0.5 0.1 288 / 50%)')).toBe('oklch(0.5 0.1 288 / 50%)');
    expect(normaliseTokenNumbers('rgba(12, 34, 56, 0.123456)')).toBe('rgba(12, 34, 56, 0.1235)');
    expect(normaliseTokenNumbers('13.333333px')).toBe('13.3333px');
    expect(normaliseTokenNumbers('-0.00004px')).toBe('0px');
    expect(normaliseTokenNumbers('1.5e-7')).toBe('0');
    expect(normaliseTokenNumbers('none')).toBe('none');
  });

  it('every committed colour, length and number is recorded at that precision', () => {
    // Values kept as computed text (shadows, gradients) are the theme's own spelling and are
    // exempt; a probed value is a single colour function, a px length or a bare number.
    const PROBED = /^(?:-?[\d.]+(?:px)?|(?:rgba?|oklch|oklab|lab|lch|hsl|hwb|color)\([^()]*\))$/;
    const bad: string[] = [];
    for (const file of readdirSync(TOKENS)) {
      const { vars } = JSON.parse(readFileSync(join(TOKENS, file), 'utf8')) as { vars: Record<string, string> };
      for (const [name, value] of Object.entries(vars)) {
        if (PROBED.test(value) && normaliseTokenNumbers(value) !== value) bad.push(`${file} ${name}: ${value}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
