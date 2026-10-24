/**
 * A person's display needs over any theme, applied where every theme passes.
 *
 * Resolution order is the contract: the person's mode over the theme, whichever theme it is. The
 * chokepoint test is the one that matters most — a space's or a node's theme reaching the page
 * without the person's needs is exactly the failure a per-caller rule invites.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  currentDisplay,
  getDisplayPreferences,
  previewDisplay,
  resolveDisplay,
  setDisplayPreferences,
  withDisplay,
} from './display';
import type { ThemeOverrides } from './overrides';
import { applyThemeVars } from './themeStyles';

const NO_SIGNALS = { dark: false, moreContrast: false, reducedMotion: false };
const plain = resolveDisplay({}, NO_SIGNALS);

afterEach(() => setDisplayPreferences({}));

describe('resolving preferences', () => {
  it('follows the system on the axes it has a signal for, by default', () => {
    expect(resolveDisplay({}, { dark: true, moreContrast: true, reducedMotion: true })).toMatchObject({
      side: 'dark',
      contrast: 'more',
      motion: 'reduced',
    });
  });

  it('lets a stated preference win over the system', () => {
    expect(
      resolveDisplay({ colorScheme: 'light', contrast: 'standard' }, { ...NO_SIGNALS, dark: true, moreContrast: true }),
    ).toMatchObject({ side: 'light', contrast: 'standard' });
  });
});

describe('a theme as a person sees it', () => {
  const theme: ThemeOverrides = {
    fontScale: 1.1,
    spacingScale: 1,
    animationSpeed: 'slow',
    light: { polarity: 'light' },
    dark: { polarity: 'dark' },
    contrast: { more: { roles: { accent: 'rgb(1, 2, 3)' } } },
  };

  it('wears the side the person asked for', () => {
    expect(withDisplay(theme, { ...plain, side: 'dark' }).polarity).toBe('dark');
  });

  it('multiplies the theme’s own text size and spacing rather than replacing them', () => {
    const seen = withDisplay(theme, { ...plain, textSize: 1.5, density: 'roomy' });
    expect(seen.fontScale).toBeCloseTo(1.65);
    expect(seen.spacingScale).toBeCloseTo(1.15);
  });

  it('stops motion whatever speed the theme chose', () => {
    expect(withDisplay(theme, { ...plain, motion: 'reduced' }).animationSpeed).toBe('none');
  });

  it('lays the theme’s own more-contrast block over the general rule', () => {
    const seen = withDisplay(theme, { ...plain, contrast: 'more' });
    expect(seen.roles?.accent).toBe('rgb(1, 2, 3)');
    expect(seen.roles?.border).toBeDefined();
    expect(seen.focusRingWidth).toBe('3px');
  });

  it('changes nothing for a person who asks for nothing', () => {
    const { light: _l, dark: _d, contrast: _c, ...base } = theme;
    void _l;
    void _d;
    void _c;
    expect(withDisplay(theme, { ...plain, side: 'light' })).toEqual({ ...base, polarity: 'light' });
  });
});

describe('the chokepoint', () => {
  it('applies the person’s needs to a theme applied anywhere, and redoes it when they change', () => {
    const wrapper = document.createElement('div');
    document.body.append(wrapper);
    applyThemeVars(wrapper, { surfaceRadius: '4px' });
    expect(wrapper.style.getPropertyValue('--we-theme-scoped-font-scale')).toBe('');

    setDisplayPreferences({ textSize: 1.25 });
    expect(wrapper.style.getPropertyValue('--we-theme-scoped-font-scale')).toBe('1.25');
    expect(wrapper.style.getPropertyValue('--we-theme-surface-radius')).toBe('4px');
    wrapper.remove();
  });

  it('reaches the document the same way, as a root font size there', () => {
    const root = document.documentElement;
    applyThemeVars(root, {});
    setDisplayPreferences({ textSize: 1.25, motion: 'reduced' });
    expect(root.style.getPropertyValue('font-size')).toBe('20px');
    expect(root.style.getPropertyValue('--we-transition-300')).toBe('0ms');
  });
});

describe('a preview over the preferences', () => {
  afterEach(() => {
    previewDisplay(null);
    setDisplayPreferences({});
  });

  it('is what themes are applied with while it lasts, and leaves the preferences as they were', () => {
    setDisplayPreferences({ colorScheme: 'dark', textSize: 1.25 });
    previewDisplay({ colorScheme: 'light', contrast: 'more' });
    expect(currentDisplay()).toMatchObject({ side: 'light', contrast: 'more', textSize: 1.25 });
    expect(getDisplayPreferences()).toEqual({ colorScheme: 'dark', textSize: 1.25 });

    previewDisplay(null);
    expect(currentDisplay()).toMatchObject({ side: 'dark', textSize: 1.25 });
  });
});
