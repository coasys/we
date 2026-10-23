/**
 * Every theme setting works wherever a theme is applied — the document, a space's wrapper, a node.
 *
 * A custom property is worked out where it is declared and inherited as a finished value, so a
 * variable the token CSS derives on `:root` from a setting is fixed there unless every theme restates
 * it. Four settings were lost that way in any theme below the document (border width, ring width,
 * spacing, font scale), and nothing noticed, because the document — the only place anyone looked —
 * worked. These tests ask the question from the other side.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCOPED_FONT_SCALE_VAR, THEME_DERIVED_VARIABLES } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import type { ThemeOverrides } from './overrides';
import { SPECIAL_SETTINGS, THEME_SETTINGS } from './themeSettings';
import { applyThemeVars, themeParametersToStyle } from './themeStyles';

/** A value for every setting that differs from its default. */
const SAMPLE: Required<Omit<ThemeOverrides, 'schemaVersion' | 'light' | 'dark'>> = {
  themeName: 'cyberpunk',
  accentHue: 300,
  successHue: 150,
  warningHue: 80,
  dangerHue: 20,
  neutralHue: 200,
  saturation: 40,
  neutralSaturation: 10,
  accentSaturation: 45,
  successSaturation: 45,
  warningSaturation: 45,
  dangerSaturation: 45,
  palette: { saturation: 30, lightness: 10, hues: { purple: { hue: 305 } } },
  accentLightness: 60,
  dangerLightness: 60,
  successLightness: 60,
  warningLightness: 60,
  polarity: 'dark',
  lightnessFloor: '10%',
  lightnessCeiling: '90%',
  roles: { page: '#123456' },
  fontFamily: 'serif',
  headingFontFamily: 'serif',
  monoFontFamily: 'monospace',
  letterSpacing: '0.05em',
  lineHeight: '1.7',
  fontScale: 1.2,
  controlRadius: '2px',
  surfaceRadius: '3px',
  inputRadius: '4px',
  avatarRadius: '5px',
  borderWidth: '2px',
  stateDuration: '50ms',
  focusRingWidth: '3px',
  controlPaddingX: '9px',
  controlGap: '7px',
  controlHeightOffset: '2px',
  surfacePadding: '11px',
  surfaceGap: '13px',
  inputPadding: '6px',
  spacingScale: 1.3,
  disabledOpacity: 0.3,
  iconWeight: 'bold',
  shadowIntensity: 'dramatic',
  glowIntensity: 'strong',
  surfaceImages: { page: 'radial-gradient(circle, red, transparent)' },
  surfaceOpacity: 0.8,
  surfaceBlur: 6,
  animationSpeed: 'slow',
  typeStyles: { heading: { weight: 300 } },
  components: { button: { radius: 'pill' } },
};

describe('every setting changes something', () => {
  const baseline = themeParametersToStyle({});
  const settings = [...Object.keys(THEME_SETTINGS), ...SPECIAL_SETTINGS].filter(
    (key) => !['schemaVersion', 'light', 'dark'].includes(key),
  ) as (keyof typeof SAMPLE)[];

  it.each(settings)('%s', (key) => {
    const style = themeParametersToStyle({ [key]: SAMPLE[key] } as ThemeOverrides);
    const changed = Object.keys(style).filter((prop) => style[prop] !== baseline[prop]);
    expect(changed, `${key} wrote nothing`).not.toEqual([]);
  });
});

describe('what the document works out from a setting is restated wherever a theme applies', () => {
  const style = themeParametersToStyle({});

  it('restates every variable in the shared list', () => {
    for (const [variable, value] of Object.entries(THEME_DERIVED_VARIABLES)) {
      expect(style[variable], variable).toBe(value);
    }
  });

  /*
    The list only helps if it is complete. So read what the token CSS actually declares on `:root`,
    and find every variable whose value reads a theme setting's input. Each must be restated by a
    theme — in the shared list, as a role default or alias, or by the theme's own derivations.
  */
  it('misses nothing the token CSS derives from a setting', () => {
    const cssDir = join(dirname(fileURLToPath(import.meta.url)), '../../1-tokens/dist/css');
    const css = readdirSync(cssDir)
      .filter((file) => file.endsWith('.css'))
      .map((file) => readFileSync(join(cssDir, file), 'utf8'))
      .join('\n');
    const inputs = new Set(Object.values(THEME_SETTINGS).map((setting) => setting.variable));
    inputs.add('--we-theme-spacing-scale');
    inputs.add(SCOPED_FONT_SCALE_VAR);
    const dependent = [...css.matchAll(/^\s*(--we-[\w-]+):\s*([^;]+);/gm)]
      .filter(([, , value]) => [...inputs].some((input) => value.includes(`var(${input}`)))
      .map(([, name]) => name)
      // The inputs themselves, declared with a default, are not dependents.
      .filter((name) => !inputs.has(name));
    const restated = new Set(Object.keys(themeParametersToStyle({ polarity: 'dark', accentHue: 300 })));
    const missing = [...new Set(dependent)].filter((name) => !restated.has(name));
    expect(missing).toEqual([]);
  });
});

describe('the font scale', () => {
  function element(isDocument: boolean) {
    const props = new Map<string, string>();
    const el = {
      style: { setProperty: (name: string, value: string) => props.set(name, value), removeProperty: () => {} },
    } as unknown as HTMLElement & { ownerDocument: { documentElement: unknown } };
    (el as { ownerDocument: unknown }).ownerDocument = { documentElement: isDocument ? el : {} };
    return { el, props };
  }

  it('moves the root font size at the document, and nothing that would compound with it', () => {
    const { el, props } = element(true);
    applyThemeVars(el, { fontScale: 1.25 });
    expect(props.get('font-size')).toBe('20px');
    expect(props.has(SCOPED_FONT_SCALE_VAR)).toBe(false);
  });

  it('scales the font-size and spacing steps below the document, where rem cannot move', () => {
    const { el, props } = element(false);
    applyThemeVars(el, { fontScale: 1.25 });
    expect(props.get(SCOPED_FONT_SCALE_VAR)).toBe('1.25');
    expect(props.get('--we-font-size-300')).toContain(`var(${SCOPED_FONT_SCALE_VAR}`);
    expect(props.get('--we-space-400')).toContain(`var(${SCOPED_FONT_SCALE_VAR}`);
  });
});
