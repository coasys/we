/**
 * `applyThemeVars` tests.
 *
 * The interesting behaviour is what it *removes*. Switching themes has to clear the previous theme's
 * variables and nothing else — the root is shared, and a host publishes layout variables there too.
 * The shortcut (`style.cssText = ''`) passes any test that only checks the new theme applied, and
 * silently deletes the host's own state, which is how a docked panel's chrome ends up snapped to the
 * window edge until something forces a recompute.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_PRESETS } from './presets';
import { applyThemeVars, themeToStyle } from './themeStyles';

/** A minimal stand-in for an element's inline style, so this needs no DOM. */
function fakeRoot() {
  const props = new Map<string, string>();
  return {
    props,
    el: {
      style: {
        setProperty: (name: string, value: string) => props.set(name, value),
        removeProperty: (name: string) => props.delete(name),
      },
    } as unknown as HTMLElement,
  };
}

describe('applyThemeVars', () => {
  it('writes a theme as custom properties', () => {
    const { el, props } = fakeRoot();
    applyThemeVars(el, { multiplier: -1, subtractor: '108%' });

    expect(props.get('--we-color-multiplier')).toBe('-1');
    expect(props.get('--we-color-subtractor')).toBe('108%');
  });

  it('clears variables the previous theme set and this one does not', () => {
    const { el, props } = fakeRoot();
    applyThemeVars(el, { primaryHue: 230, multiplier: -1 });
    expect(props.has('--we-color-primary-hue')).toBe(true);

    applyThemeVars(el, { multiplier: 1 });

    expect(props.has('--we-color-primary-hue')).toBe(false);
    expect(props.get('--we-color-multiplier')).toBe('1');
  });

  it('leaves variables it never set alone', () => {
    // The bug this exists to prevent: a host publishes layout state on the same root, and clearing
    // wholesale takes it with the old theme.
    const { el, props } = fakeRoot();
    props.set('--we-dock-right', '320px');

    applyThemeVars(el, { multiplier: -1 });
    applyThemeVars(el, { multiplier: 1 });

    expect(props.get('--we-dock-right')).toBe('320px');
  });

  it('tracks each root separately', () => {
    // A page and a space-scoped subtree are both themed; neither may clear the other's variables.
    const a = fakeRoot();
    const b = fakeRoot();
    applyThemeVars(a.el, { primaryHue: 230 });
    applyThemeVars(b.el, { multiplier: -1 });
    applyThemeVars(b.el, { multiplier: 1 });

    expect(a.props.has('--we-color-primary-hue')).toBe(true);
  });
});

/**
 * The cross-fade window.
 *
 * `--we-theme-switch-duration` is the one seam that lets a theme change animate the same properties a
 * hover exit uses, without a hover exit ever inheriting a duration from it. Both halves matter and
 * both are easy to break silently: leave it set and every button trails on the way out again; never
 * set it and a light/dark switch becomes a repaint.
 *
 * The first-application case is the one that already went wrong once. Opening the window on initial
 * paint is not a switch — there is nothing to fade *from* — and it left every component running a
 * 250ms departure transition for the first fraction of a second of the page's life, which was long
 * enough to be sampled and reported as the exact fault the variable exists to avoid.
 */
describe('applyThemeVars cross-fade window', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const DURATION = '--we-theme-switch-duration';

  it('does not open a window on the first application, which is the initial paint', () => {
    const { el, props } = fakeRoot();
    applyThemeVars(el, { multiplier: -1 });

    expect(props.has(DURATION)).toBe(false);
  });

  it('opens one on a later application, when there is something to fade from', () => {
    const { el, props } = fakeRoot();
    applyThemeVars(el, { multiplier: -1 });
    applyThemeVars(el, { multiplier: 1 });

    expect(props.get(DURATION)).toBe('250ms');
  });

  it('closes the window afterwards, so a hover exit never inherits a duration', () => {
    const { el, props } = fakeRoot();
    applyThemeVars(el, { multiplier: -1 });
    applyThemeVars(el, { multiplier: 1 });

    vi.advanceTimersByTime(400);
    expect(props.has(DURATION)).toBe(false);
  });

  it('restarts the window when a second switch lands mid-fade, rather than closing early', () => {
    const { el, props } = fakeRoot();
    applyThemeVars(el, { multiplier: -1 });
    applyThemeVars(el, { multiplier: 1 });

    vi.advanceTimersByTime(300);
    applyThemeVars(el, { multiplier: -1 });

    // The first switch's timer would have fired by now had it not been cleared.
    vi.advanceTimersByTime(200);
    expect(props.get(DURATION)).toBe('250ms');

    vi.advanceTimersByTime(200);
    expect(props.has(DURATION)).toBe(false);
  });

  it('tracks the window per root, so two subtrees do not close each other', () => {
    const a = fakeRoot();
    const b = fakeRoot();
    applyThemeVars(a.el, { multiplier: -1 });
    applyThemeVars(a.el, { multiplier: 1 });
    applyThemeVars(b.el, { multiplier: -1 });

    expect(a.props.get(DURATION)).toBe('250ms');
    expect(b.props.has(DURATION)).toBe(false);
  });
});

describe('a named theme brings its own parameters', () => {
  /*
    The second half of the scoped-named-theme gap. `{ themeName: 'cyberpunk' }` re-declared the
    colour *formulas* but left their *inputs* — multiplier, subtractor, saturation — inherited from
    whatever theme was ambient. A cyberpunk section inside a light app therefore got cyberpunk's
    shapes over light's lightness curve, and only looked right when the app already happened to be
    on that theme.
  */
  it('resolves a known name to its preset parameters', () => {
    const style = themeToStyle({ themeName: 'cyberpunk' });
    const preset = THEME_PRESETS.cyberpunk.parameters;

    expect(style['--we-color-multiplier']).toBe(String(preset.multiplier));
    expect(style['--we-color-subtractor']).toBe(String(preset.subtractor));
    expect(style['--we-color-saturation']).toBe(String(preset.saturation));
  });

  it('lets an explicit override win over the preset', () => {
    // `{ themeName: 'cyberpunk', primaryHue: 320 }` should read as "cyberpunk, different accent".
    const style = themeToStyle({ themeName: 'cyberpunk', primaryHue: 320 });

    expect(style['--we-color-primary-hue']).toBe('320');
    expect(style['--we-color-multiplier']).toBe(String(THEME_PRESETS.cyberpunk.parameters.multiplier));
  });

  it('leaves an unknown name alone rather than inventing parameters', () => {
    // A marketplace theme's id is not a preset key; its inputs come from its own CSS.
    const style = themeToStyle({ themeName: 'some-installed-theme' });
    expect(style['--we-color-multiplier']).toBeUndefined();
  });

  it('still re-declares the formulas, which is what it always did', () => {
    const style = themeToStyle({ themeName: 'cyberpunk' });
    expect(style['--we-color-lightness-500']).toContain('var(--we-color-subtractor)');
  });
});
