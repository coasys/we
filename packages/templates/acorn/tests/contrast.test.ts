import type { ThemeOverrides } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { acornTheme } from '../src/themes';

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (color: number[]) =>
  color
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: number[], b: number[]) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
const composite = (color: number[], background: number[], opacity: number) =>
  color.map((c, i) => c * opacity + background[i] * (1 - opacity));

describe('Acorn action contrast', () => {
  const { roles, disabledOpacity } = acornTheme.overrides as ThemeOverrides;
  // Opacity affects BOTH the words and their fill. Checking the raw palette alone missed
  // round one's empty create control: its 50% host opacity turned blue into pale lavender.
  for (const state of ['accent', 'accentHover', 'accentActive'] as const) {
    for (const background of ['page', 'surface'] as const) {
      it(`${state} meets AA on ${background}, enabled and disabled`, () => {
        const ground = rgb(roles![background]!);
        for (const opacity of [1, disabledOpacity!]) {
          expect(
            contrast(
              composite(rgb(roles!.onAccent!), ground, opacity),
              composite(rgb(roles![state]!), ground, opacity),
            ),
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});
