/**
 * The two decisions in the roles editor that are not obvious from reading it.
 *
 * The panel itself is a Solid component behind an editor-host context and a dock, so it is not
 * worth mounting for this. These are the parts where being wrong is silent: a scrim that stops
 * being a scrim, and a theme that claims to pin roles forever after one was unpinned.
 */
import { describe, expect, it } from 'vitest';

import { nextRoles, roleColorToStore } from './ThemePanel';

describe('the colour a role stores', () => {
  it("keeps the picker's value when the role is opaque", () => {
    expect(roleColorToStore('#3366ff', 1)).toBe('#3366ff');
  });

  /*
    The case that matters. `overlay` defaults to 60% alpha and <input type="color"> cannot express
    alpha, so picking a colour for it returns an opaque one — which is not a slightly-wrong scrim
    but a solid sheet over the application.
  */
  it('carries the alpha the role already had, so a scrim stays a scrim', () => {
    expect(roleColorToStore('#000000', 0.6)).toBe('rgb(0 0 0 / 0.6)');
    expect(roleColorToStore('#ff8000', 0.25)).toBe('rgb(255 128 0 / 0.25)');
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
