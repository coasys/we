/**
 * The surface stack, and the two ways a theme's polarity can change.
 *
 * Both have to reconcile it, which is why the rule lives beside the presets rather than in the
 * editor panel it started in — only one of the two paths went through that panel.
 */
import { role } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import { THEME_PRESETS } from './presets';
import { reconcileSurfaces, surfacesForPolarity } from './themeStyles';

const STACK = ['chrome', 'page', 'surface', 'surfaceRaised', 'surfaceSunken'];

describe('the surface stack across a change of polarity', () => {
  /*
    The bug this pins: a fork of `dark`, switched light and back to dark, was given a stack of dark
    pins at fixed lightnesses of 7–14% — which the dark preset itself never had, since it is drawn
    from the parametric stack — and looked black beside the theme it was forked from.
  */
  it('lands where the presets are drawn from: no surface pinned in either direction', () => {
    for (const polarity of ['light', 'dark'] as const) {
      const preset = THEME_PRESETS[polarity].parameters as { roles?: Record<string, string> };
      for (const name of STACK) expect(preset.roles?.[name], `${polarity} pins ${name}`).toBeUndefined();
      expect(surfacesForPolarity(polarity, undefined)).toBeUndefined();
    }
  });

  it('drops a stack tuned for the other polarity, in both directions', () => {
    const tuned = { page: 'oklch(95% 0.01 264)', surface: 'oklch(98% 0.01 264)', chrome: 'oklch(92% 0 0)' };
    expect(surfacesForPolarity('dark', tuned)).toBeUndefined();
    expect(surfacesForPolarity('light', tuned)).toBeUndefined();
  });

  it('leaves roles that are not surfaces alone in both directions', () => {
    expect(surfacesForPolarity('light', { accent: '#f0f' })).toEqual({ accent: '#f0f' });
    expect(surfacesForPolarity('dark', { accent: '#f0f', page: '#000' })).toEqual({ accent: '#f0f' });
  });

  /*
    The chrome is the app's ground and the page stands off it, as one offset in both polarities —
    which is what lets the stack be left to the formula on any flip.
  */
  it('states the page as a step off the chrome, never the reverse', () => {
    expect(role.page).toMatch(/^oklch\(from var\(--we-role-chrome\) calc\(l \+ /);
    expect(role.chrome).not.toContain('--we-role-page');
  });
});

describe('changing base preset', () => {
  const DARK = { polarity: 'dark' as const };
  const LIGHT = { polarity: 'light' as const };
  const pinned = { page: 'oklch(10% 0.01 264)', surface: 'oklch(12% 0.01 264)' };

  /*
    The three-click bug: a stack pinned for one polarity surviving a change to the other — a light
    theme's near-black text over near-black cards, 1.12:1.
  */
  it('drops a pinned stack when the polarity changes', () => {
    expect(reconcileSurfaces({ polarity: 'dark' as const, roles: pinned }, LIGHT)).toBeUndefined();
    expect(reconcileSurfaces({ polarity: 'light' as const, roles: pinned }, DARK)).toBeUndefined();
  });

  /*
    Re-picking within one polarity must not touch the stack, or choosing between two dark presets
    would silently discard whatever the author had tuned.
  */
  it('leaves a tuned stack alone when the polarity does not change', () => {
    expect(reconcileSurfaces({ polarity: 'dark' as const, roles: pinned }, DARK)).toBe(pinned);
  });

  it('keeps role pins that are not surfaces', () => {
    expect(reconcileSurfaces({ polarity: 'dark' as const, roles: { ...pinned, accent: '#f0f' } }, LIGHT)).toEqual({
      accent: '#f0f',
    });
  });
});
