/**
 * What an avatar draws, and what colours it.
 *
 * Both halves failed silently before, and in a way that looked deliberate rather than broken.
 *
 * `hash` used to outrank `initials`, which made `initials` **unreachable** on any element setting
 * both — so a space passing its name as both showed generated art in the sidebar while the same
 * space showed its letters in the spaces list, the header and the settings page, and nothing said
 * why. A dead prop is worse than a missing one: the call site reads as though it works.
 *
 * The seed was that name, too. A name-seeded avatar changes its picture when somebody renames the
 * thing — identity art contradicting the identity — where every other caller in the app seeds from
 * a DID and is stable for ever.
 */
import { describe, expect, it } from 'vitest';

import { avatarSeededFillForTest as seededFill, avatarSeededHueForTest as seededHue } from './avatar';

describe('what it draws', () => {
  /*
    Asserted through the same predicates `renderContent` branches on rather than by mounting the
    element: what is being protected is the *order*, and a render test would pass just as happily
    with the branches swapped as long as something appeared.
  */
  const draws = (a: { image?: string; initials?: string; hash?: string }) =>
    a.image ? 'image' : a.initials ? 'initials' : a.hash ? 'identicon' : 'icon';

  it('prefers letters to a generated pattern', () => {
    // The bug. A space sets all three; it must show its letters.
    expect(draws({ image: '', initials: 'Design', hash: 'uuid-1' })).toBe('initials');
  });

  it('still draws a pattern for somebody whose name has not arrived', () => {
    // The case the identicon exists for, and the reason `hash` is not simply deleted: two peers
    // with no profile yet must not be two identical blank discs.
    expect(draws({ initials: '', hash: 'did:key:z6Mk…' })).toBe('identicon');
  });

  it('lets a real picture win over everything', () => {
    expect(draws({ image: 'data:…', initials: 'Design', hash: 'uuid-1' })).toBe('image');
  });

  it('falls back to a glyph when it has nothing at all', () => {
    expect(draws({})).toBe('icon');
  });
});

describe('the generated colour', () => {
  it('is stable for a seed, and the same everywhere', () => {
    expect(seededHue('uuid-1')).toBe(seededHue('uuid-1'));
  });

  it('lands on a palette rather than anywhere on the wheel', () => {
    /*
      The reason this is quantised at all. Hashing straight to 0–359 put the closest of twelve real
      uuids three degrees apart — one colour, to a reader — and two spaces looking *almost* the same
      reads as a rendering fault. Every pair is now either clearly different or frankly identical.
    */
    const hues = new Set<number>();
    for (let i = 0; i < 500; i++) hues.add(seededHue(`seed-${i}`));

    for (const hue of hues) expect(hue % 30).toBe(0);
    expect(hues.size).toBeLessThanOrEqual(12);
    // And it uses the whole palette rather than collapsing onto a few buckets.
    expect(hues.size).toBe(12);
  });

  it('builds the fill from the theme rather than from a fixed colour', () => {
    const { bg, fg } = seededFill('uuid-1');

    // The `--we-color-*-100` / `-700` pair with the hue swapped: same lightness step, same
    // saturation, same taper. So it follows a theme's polarity and ramp instead of fighting them.
    for (const value of [bg, fg]) {
      expect(value).toContain('var(--we-color-saturation)');
      expect(value).toMatch(/var\(--we-color-lightness-(100|700)\)/);
    }
    expect(bg).toContain('--we-color-lightness-100');
    expect(fg).toContain('--we-color-lightness-700');
  });

  it('gives a different hue to seeds that would otherwise collide', () => {
    // Three spaces whose initials are all "D" — the case that made the palette necessary.
    const hues = ['design-uuid', 'dev-uuid', 'docs-uuid'].map(seededHue);
    expect(new Set(hues).size).toBe(3);
  });
});
