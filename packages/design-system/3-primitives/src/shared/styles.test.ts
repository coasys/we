/**
 * The shared reset must not remove a keyboard focus indicator.
 *
 * `:host *:focus { outline: 0 }` is imported by 44 of the 50 primitives. It removed the ring the
 * user agent draws and put nothing in its place, so checkbox, radio, switch, link, tab, select,
 * slider, pagination, file-upload and the pickers had no focus indicator at all — a keyboard user
 * could tab through a settings page with nothing on screen saying where they were.
 *
 * Asserted against the stylesheet text rather than a rendered element on purpose: the failure was
 * one selector, it applies to every primitive that imports this, and a DOM test would have to pick
 * one of them and prove nothing about the other 43.
 */
import { describe, expect, it } from 'vitest';

import sharedStyles from './styles';

const css = sharedStyles.toString();

describe('shared reset', () => {
  it('suppresses the outline only when focus is not keyboard focus', () => {
    expect(css).toContain(':host *:focus:not(:focus-visible)');
  });

  it('never suppresses it unconditionally', () => {
    // The exact rule that shipped. Matching on the whole declaration rather than the selector alone,
    // so a legitimate `:focus` selector elsewhere in the sheet does not fail this.
    const unconditional = /:host\s+\*:focus\s*\{\s*outline:\s*0/;
    expect(unconditional.test(css)).toBe(false);
  });
});
