/**
 * The two halves of a yes/no pair, and what a theme can say about each.
 *
 * `success` arrived for the extraction review card — keep or discard a suggestion — and the case for
 * it is the one `danger`'s own note makes from the other side: a status fill deserves a role, so a
 * theme can say something about it beyond its hue. `primary` cannot do this job, because `accent` is
 * the *brand* colour and a theme may set it anywhere, including next to `danger`.
 */
import { role } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import { VARIANT_DEFAULTS } from './button';

describe('the confirming variant', () => {
  it('is built from the status role, not from a position on a scale', () => {
    // A scale position cannot follow a theme that pins the role, which is the whole reason `danger`
    // stopped being `danger-500`.
    expect(VARIANT_DEFAULTS.success.bg).toBe('success');
  });

  it('labels itself with the role measured against that fill', () => {
    // `on-success` is derived and contrast-corrected at apply time — see FILL_LABELS in @we/themes.
    // Using `text` or `success-text` here would measure the label against the *page* instead, which
    // is the mistake the `on<Fill>` naming exists to prevent.
    expect(VARIANT_DEFAULTS.success.color).toBe('on-success');
  });

  it('needed nothing new underneath, which is why it was cheap', () => {
    // The whole argument for adding the variant rather than reaching for `primary`: every role it
    // stands on already existed for the other status fills.
    expect(role.onSuccess).toBeTruthy();
    expect(role.successHover).toBeTruthy();
    expect(role.successActive).toBeTruthy();
  });

  it('moves its states from the fill, exactly as the destructive one does', () => {
    /*
      Steps from the fill rather than positions on the scale: the label is chosen against the worst
      of the three states, so they have to stay together. Asserted against `danger`'s shape rather
      than against literal strings, so the pair cannot drift apart silently.
    */
    expect(VARIANT_DEFAULTS.success.hoverProps).toEqual({ bg: 'var(--we-role-success-hover)', color: 'on-success' });
    expect(VARIANT_DEFAULTS.success.activeProps).toEqual({ bg: 'var(--we-role-success-active)', color: 'on-success' });
    expect(Object.keys(VARIANT_DEFAULTS.success)).toEqual(Object.keys(VARIANT_DEFAULTS.danger));
  });
});
