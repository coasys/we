/**
 * `applyThemeVars` tests.
 *
 * The interesting behaviour is what it *removes*. Switching themes has to clear the previous theme's
 * variables and nothing else — the root is shared, and a host publishes layout variables there too.
 * The shortcut (`style.cssText = ''`) passes any test that only checks the new theme applied, and
 * silently deletes the host's own state, which is how a docked panel's chrome ends up snapped to the
 * window edge until something forces a recompute.
 */
import { describe, expect, it } from 'vitest';

import { applyThemeVars } from './themeStyles';

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
