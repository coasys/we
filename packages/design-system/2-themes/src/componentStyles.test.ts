/**
 * What a theme's type roles and component overrides become.
 *
 * Each is a variable a component's chain reads; the chains themselves are pinned in the primitives'
 * tests. These pin the spellings: a token name becomes its variable, a role its role, a raw value
 * passes through, and a variant gets the double dash that keeps it apart from a component's name.
 */
import { describe, expect, it } from 'vitest';

import { themeParametersToStyle } from './themeStyles';

describe('typeStyles', () => {
  it('writes each key a role sets, resolving token names', () => {
    const style = themeParametersToStyle({
      typeStyles: {
        heading: { weight: 300, letterSpacing: 'tight', family: "'Bricolage', serif", color: 'accent-text' },
        overline: { textTransform: 'uppercase', lineHeight: 'snug' },
      },
    });
    expect(style['--we-type-heading-weight']).toBe('var(--we-font-weight-300)');
    expect(style['--we-type-heading-letter-spacing']).toBe('var(--we-letter-spacing-tight)');
    expect(style['--we-type-heading-family']).toBe("'Bricolage', serif");
    expect(style['--we-type-heading-color']).toBe('var(--we-role-accent-text)');
    expect(style['--we-type-overline-text-transform']).toBe('uppercase');
    expect(style['--we-type-overline-line-height']).toBe('var(--we-line-height-snug)');
  });

  it('writes nothing for a role it does not set', () => {
    const style = themeParametersToStyle({ typeStyles: { heading: { weight: 'semibold' } } });
    expect(style['--we-type-heading-weight']).toBe('var(--we-font-weight-semibold)');
    expect(Object.keys(style).filter((k) => k.startsWith('--we-type-body'))).toEqual([]);
  });
});

describe('components', () => {
  it('writes the family keys under the component’s name', () => {
    const style = themeParametersToStyle({
      components: { button: { radius: 'pill', padding: '200 400', fill: 'surfaceRaised', borderWidth: '1.5px' } },
    });
    expect(style['--we-theme-button-radius']).toBe('var(--we-radius-pill)');
    expect(style['--we-theme-button-padding']).toBe('var(--we-space-200) var(--we-space-400)');
    expect(style['--we-theme-button-fill']).toBe('var(--we-role-surface-raised)');
    expect(style['--we-theme-button-border-width']).toBe('1.5px');
  });

  it('keeps a variant apart with a double dash', () => {
    const style = themeParametersToStyle({ components: { button: { variants: { soft: { borderWidth: '1.5px' } } } } });
    expect(style['--we-theme-button--soft-border-width']).toBe('1.5px');
    expect(style['--we-theme-button-border-width']).toBeUndefined();
  });

  it('points a component’s type keys at another role, colour included', () => {
    const style = themeParametersToStyle({ components: { tooltip: { type: 'overline' } } });
    expect(style['--we-theme-tooltip-font-weight']).toBe('var(--we-type-overline-weight)');
    expect(style['--we-theme-tooltip-text-transform']).toBe('var(--we-type-overline-text-transform)');
    expect(style['--we-theme-tooltip-text']).toBe('var(--we-type-overline-color)');
  });

  it('lets an explicit text colour win over the one a type role brings', () => {
    const style = themeParametersToStyle({ components: { tooltip: { type: 'overline', text: 'text-muted' } } });
    expect(style['--we-theme-tooltip-text']).toBe('var(--we-role-text-muted)');
  });

  it('refuses a name that could not be a variable', () => {
    const style = themeParametersToStyle({ components: { 'a;b': { radius: '0' } } });
    expect(Object.keys(style).some((k) => k.includes('a;b'))).toBe(false);
  });

  it('drops a value that would fetch', () => {
    const style = themeParametersToStyle({ components: { card: { fill: 'x)url(https://e.example/x' } } });
    expect(Object.values(style).some((v) => v.includes('url('))).toBe(false);
  });
});
