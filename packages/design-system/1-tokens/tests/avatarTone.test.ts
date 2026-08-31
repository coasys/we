import { describe, expect, it } from 'vitest';

import { AVATAR_TONE_ROLES, AVATAR_TONES, avatarToneColor, avatarToneLabel, avatarToneRing } from '../src/color';
import { role } from '../src/role';

/**
 * A tone is a fill and the label that sits on it — and the two must not drift apart.
 *
 * That is not hypothetical: `badgedAvatar` painted its disc from the tone and coloured the glyph on
 * it `on-accent`, the corrected label for a *different* fill. It read correctly in `dark` only
 * because that theme pins `onAccent` to a near-black lavender that happens to work on light green.
 * Nothing failed, because nothing was comparing the two.
 *
 * So the pairing is asserted structurally rather than as a snapshot of today's five rows: a label
 * must be the `on-` form of its own fill, and both must be real roles. A tone added later cannot
 * satisfy that by accident.
 */

/** The kebab spelling a schema writes, for every role that exists. */
const ROLE_NAMES = new Set(Object.keys(role).map((k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)));

describe('avatar tones', () => {
  it('cover every tone exactly once', () => {
    expect(Object.keys(AVATAR_TONE_ROLES).sort()).toEqual([...AVATAR_TONES].sort());
  });

  it('name real roles on both halves', () => {
    // A misspelt role resolves to a variable that does not exist, so the element paints nothing at
    // all — the silent failure the kebab-vs-camel rule exists to prevent.
    for (const [tone, { fill, label }] of Object.entries(AVATAR_TONE_ROLES)) {
      expect(ROLE_NAMES, `${tone} fill`).toContain(fill);
      expect(ROLE_NAMES, `${tone} label`).toContain(label);
    }
  });

  it('pair each fill with its own corrected label', () => {
    for (const [tone, { fill, label }] of Object.entries(AVATAR_TONE_ROLES)) {
      // `surface-inverse` is the exception and the only one: its label is `on-inverse`, because the
      // role is named for what it is opposite to rather than for the fill. Every other pair is the
      // plain `on-` form, which is what makes a wrong one visible here.
      const expected = fill === 'surface-inverse' ? 'on-inverse' : `on-${fill}`;
      expect(label, `${tone} label`).toBe(expected);
    }
  });

  it('paint a fill, never a scale position or a text role', () => {
    // The whole point of the move off `-500`: a step is capped by CHROMA_CEILING and pulled toward
    // grey by chromaTaper, which is why the ring read duller than the badge beside it. A `*-text`
    // role would be the other failure — a foreground measured for reading, pale in a dark theme.
    for (const tone of AVATAR_TONES) {
      const value = avatarToneColor(tone);
      expect(value, tone).toMatch(/^var\(--we-role-[a-z-]+\)$/);
      expect(value, tone).not.toMatch(/-text\)|-surface\)|-muted\)|--we-color-/);
    }
  });

  it('build a ring that takes no part in layout', () => {
    // A box-shadow rather than a border, so ringing a face never changes the height of its row —
    // the rail's live ring was a border and grew the row every time a call started.
    expect(avatarToneRing('success')).toBe('0 0 0 2px var(--we-role-success)');
    expect(avatarToneRing('danger', '3px')).toBe('0 0 0 3px var(--we-role-danger)');
  });

  it('return the label as a role name, not a var()', () => {
    // Its one caller is a schema prop, which resolves role names itself and would paint nothing
    // given a `var()` string wrapped in another.
    expect(avatarToneLabel('success')).toBe('on-success');
    expect(avatarToneLabel('neutral')).toBe('on-inverse');
  });
});
