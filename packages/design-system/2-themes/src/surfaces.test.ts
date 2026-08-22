/**
 * The surface stack, and the two ways a theme's polarity can change.
 *
 * Both have to reconcile it, which is why the rule lives beside the presets rather than in the
 * editor panel it started in — only one of the two paths went through that panel.
 */
import { describe, expect, it } from 'vitest';

import { reconcileSurfaces, surfacesForPolarity } from './themeStyles';

describe('the surface stack a polarity needs', () => {
  /*
    The bug this exists to prevent: flipping to dark inverts the scale, so `page` (neutral-50) ends
    up lighter than `surface` (neutral-0) and a card sinks below the page it is on. Nothing about
    the flip tells you that — the theme still looks like a theme, just subtly upside down.
  */
  it('pins the four surfaces when going dark', () => {
    const out = surfacesForPolarity('dark', undefined)!;
    expect(Object.keys(out).sort()).toEqual(['page', 'surface', 'surfaceRaised', 'surfaceSunken']);
  });

  it('puts the stack in the right order', () => {
    const out = surfacesForPolarity('dark', undefined)!;
    const at = (v: string) => parseFloat(/^oklch\(([\d.]+)%/.exec(v)![1]);
    expect(at(out.surfaceSunken!)).toBeLessThan(at(out.page!));
    expect(at(out.page!)).toBeLessThan(at(out.surface!));
    expect(at(out.surface!)).toBeLessThan(at(out.surfaceRaised!));
  });

  it('clears them going light, rather than writing a second stack', () => {
    // The parametric defaults are already right in that direction, and no pin means the hue and
    // lightness sliders still reach everything.
    expect(surfacesForPolarity('light', surfacesForPolarity('dark', undefined))).toBeUndefined();
  });

  it('leaves roles that are not surfaces alone in both directions', () => {
    expect(surfacesForPolarity('light', { accent: '#f0f' })).toEqual({ accent: '#f0f' });
    expect(surfacesForPolarity('dark', { accent: '#f0f' })!.accent).toBe('#f0f');
  });

  it('replaces a stack tuned for the other polarity rather than keeping it', () => {
    const stale = { page: 'hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) 95%)' };
    expect(surfacesForPolarity('dark', stale)!.page).not.toBe(stale.page);
  });
});

describe('changing base preset', () => {
  const DARK = { multiplier: -1 };
  const LIGHT = { multiplier: 1 };
  const darkStack = surfacesForPolarity('dark', undefined)!;

  /*
    The three-click bug: click Dark, which pins the stack, then pick a light base preset. The pins
    survive `...existing`, so the theme ends up light-polarity — near-black text — over near-black
    cards. 1.12:1, which is not a subtle regression, it is an invisible interface.
  */
  it('drops a dark stack when the new preset is light', () => {
    const out = reconcileSurfaces({ multiplier: -1, roles: darkStack }, LIGHT);
    expect(out).toBeUndefined();
  });

  it('pins a dark stack when the new preset is dark', () => {
    const out = reconcileSurfaces({ multiplier: 1 }, DARK)!;
    expect(out.surface).toBe(darkStack.surface);
  });

  /*
    Re-picking within one polarity must not touch the stack, or choosing between two dark presets
    would silently discard whatever the author had tuned.
  */
  it('leaves a tuned stack alone when the polarity does not change', () => {
    const tuned = { ...darkStack, surface: 'hsl(220 20% 22%)' };
    expect(reconcileSurfaces({ multiplier: -1, roles: tuned }, DARK)).toBe(tuned);
  });

  it('keeps role pins that are not surfaces, in both directions', () => {
    expect(reconcileSurfaces({ multiplier: -1, roles: { ...darkStack, accent: '#f0f' } }, LIGHT)).toEqual({
      accent: '#f0f',
    });
    expect(reconcileSurfaces({ multiplier: 1, roles: { accent: '#f0f' } }, DARK)!.accent).toBe('#f0f');
  });

  it('treats a theme with no multiplier as light, which is the default', () => {
    expect(reconcileSurfaces({ roles: { accent: '#f0f' } }, LIGHT)).toEqual({ accent: '#f0f' });
    expect(reconcileSurfaces({ roles: {} }, DARK)!.page).toBe(darkStack.page);
  });
});
