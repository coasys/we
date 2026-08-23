/**
 * The two decisions in the roles editor that are not obvious from reading it.
 *
 * The panel itself is a Solid component behind an editor-host context and a dock, so it is not
 * worth mounting for this. These are the parts where being wrong is silent: a scrim that stops
 * being a scrim, and a theme that claims to pin roles forever after one was unpinned.
 */
import { describe, expect, it } from 'vitest';

import { nextRoles, roleTier, roleTierLabel } from './themeRoles';

describe('the rung a stored role value sits on', () => {
  /*
    The tiers are not cosmetic: only `custom` really leaves the parametric system. A token still
    follows the hue sliders and the light/dark polarity, and a lightness pin — the form the built-in
    presets use — follows hue and saturation while holding its lightness against a polarity flip.
    The editor labels the rung so that opting out is a thing somebody chose rather than the silent
    consequence of using a colour picker.
  */
  it('reads a token pin as a token, and names it', () => {
    expect(roleTier('var(--we-color-neutral-200)')).toBe('token');
    expect(roleTierLabel('var(--we-color-neutral-200)')).toBe('neutral-200');
  });

  it('reads the presets’ own form as a lightness pin', () => {
    const preset = 'hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) 11%)';
    expect(roleTier(preset)).toBe('lightness');
    expect(roleTierLabel(preset)).toBe('theme tint');
  });

  it('reads a literal as custom, whatever notation it is in', () => {
    for (const v of ['#3366ff', 'rgb(1 2 3)', 'rgb(0 0 0 / 0.6)', 'hsl(210 100% 50%)']) {
      expect(roleTier(v)).toBe('custom');
    }
  });

  it('reads nothing as auto', () => {
    expect(roleTier(undefined)).toBe('auto');
    expect(roleTierLabel(undefined)).toBe('auto');
  });
});

describe('the roles object a theme stores', () => {
  it('adds a pin to what is already there', () => {
    expect(nextRoles({ page: '#fff' }, 'text', '#000')).toEqual({ page: '#fff', text: '#000' });
  });

  it('replaces a pin rather than accumulating', () => {
    expect(nextRoles({ page: '#fff' }, 'page', '#eee')).toEqual({ page: '#eee' });
  });

  it('removes a pin when it is reset', () => {
    expect(nextRoles({ page: '#fff', text: '#000' }, 'page', undefined)).toEqual({ text: '#000' });
  });

  /*
    `{}` would persist as `"roles":{}` — indistinguishable, to anything inspecting the theme, from a
    theme that pins roles, and never false again once true.
  */
  it('becomes undefined once the last pin is reset, rather than an empty object', () => {
    expect(nextRoles({ page: '#fff' }, 'page', undefined)).toBeUndefined();
    expect(nextRoles(undefined, 'page', undefined)).toBeUndefined();
  });

  it('does not mutate the object it was given', () => {
    const before = { page: '#fff' };
    nextRoles(before, 'text', '#000');
    expect(before).toEqual({ page: '#fff' });
  });
});

describe('the relative rung covers both forms of "a step from another role"', () => {
  it('recognises the elevation stack, not only color-mix', () => {
    expect(roleTier('oklch(from var(--we-role-page) calc(l + 0.045) c h)')).toBe('relative');
    expect(roleTierLabel('oklch(from var(--we-role-page) calc(l + 0.045) c h)')).toBe('relative to another role');
  });

  // An ordinary oklch() colour is a literal — it follows nothing, and saying otherwise would tell
  // an author their pinned brand colour still tracks the theme.
  it('does not mistake a plain oklch() literal for a relationship', () => {
    expect(roleTier('oklch(0.7 0.15 250)')).toBe('custom');
  });
});
