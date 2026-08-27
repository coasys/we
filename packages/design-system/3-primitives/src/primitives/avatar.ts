import type { DesignSystemProps } from '@we/design-types';
import { toSvg } from 'jdenticon';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';

import { LayoutVisualElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { SizeValue } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  flex: '0 0 auto',
};

/**
 * How many hues a generated avatar may take, evenly spaced around the wheel.
 *
 * A *palette* rather than the whole circle, and that is the load-bearing decision. Hashing straight
 * to 0–359 reads as more choice and gives less: twelve random uuids put their closest pair **three
 * degrees** apart — measured — which at avatar chroma is one colour, and two spaces looking almost
 * the same reads as a rendering fault rather than as a coincidence. Quantising trades uniqueness for
 * separation. Two spaces can now share a colour outright, which is honest and legible, and no two
 * can be nearly the same.
 *
 * Twelve because 30° is comfortably apart at the low chroma these fills carry, and because the
 * letters are the identifier anyway — the colour is a second cue, not the first.
 */
const HUE_STEPS = 12;

/**
 * A hue, from whatever identifies this thing.
 *
 * FNV-1a, because the requirements are "same input, same colour, everywhere, for ever" and "spread
 * evenly across the buckets" — not cryptographic strength. Eight lines, no dependency, and the same
 * answer in every browser and in a test.
 *
 * The point of a *hue* rather than a colour is that everything else stays the theme's. See
 * {@link seededFill}.
 */
function seededHue(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (Math.abs(h) % HUE_STEPS) * (360 / HUE_STEPS);
}

/**
 * The generated fill and its foreground, built the way the theme builds its own colours.
 *
 * This is the `--we-color-*-100` / `-700` pair with the hue swapped out, character for character —
 * same lightness step, same saturation, same chroma taper, same `chroma-max` ceiling. So a
 * generated avatar follows a theme's polarity, its saturation and its ramp exactly as `accent-muted`
 * and `accent-text` do, and the only thing that varies per space is the angle.
 *
 * Reusing that *pair* is what makes the contrast safe without measuring anything: 100 as a fill with
 * 700 as its text is the combination the roles already ship, and it stays legible when a dark theme
 * flips the ramp, because both steps flip together.
 */
function seededFill(seed: string): { bg: string; fg: string } {
  const hue = seededHue(seed);
  const step = (l: '100' | '700') =>
    `oklch(var(--we-color-lightness-${l}) calc(var(--we-color-saturation) / 100 * 0.18 * 2 * ` +
    `max(0, min(var(--we-color-lightness-${l}), 1 - var(--we-color-lightness-${l})))) ${hue})`;
  return { bg: step('100'), fg: step('700') };
}

/*
  Exported for the test, which pins the *order* of what gets drawn and the shape of the generated
  colour. Both failed silently before — a dead prop and a name-seeded hue — so the assertions are
  worth more than the two lines of surface they cost.
*/
export const avatarSeededHueForTest = seededHue;
export const avatarSeededFillForTest = seededFill;

const styles = css`
  :host {
    --we-avatar-host-display: inline-flex;
    --we-avatar-width: var(--we-avatar-size);
    --we-avatar-height: var(--we-avatar-size);
    --we-avatar-size: var(--we-avatar-size-md);
    --we-avatar-border: none;
    --we-avatar-color: var(--we-role-text);
    /* The disc behind an identicon or initials — a sunken surface, whose default is the
       neutral-100 that was here, so nothing moves. */
    --we-avatar-bg: var(--we-role-surface-sunken);
  }
  /* The disc exists for the identicon/initials/icon fallbacks; a picture covers it
     entirely, so it is dropped when there is one. Keyed off the marker attribute rather
     than the image property itself — see the note there for why it is not reflected. */
  :host([has-image]) {
    --we-avatar-bg: transparent;
  }
  /*
    There is no "selected" ring and no "online" dot here any more.

    Both were single-purpose decorations with a fixed colour and a fixed position, neither of them
    ever set by anything — and being unused was the smaller problem. "selected" wrote the same
    --we-avatar-box-shadow the ring prop writes inline, so any caller passing a ring silently
    overrode it; "online" claimed the bottom-right corner, which is where a status badge goes, so
    the rail's live-call mark had to be built as a wrapper around the avatar to avoid reading as
    "online". A baked-in decoration nobody used was shaping the design of the one people did.

    What replaces them is not on this element: a tone through the ring prop (see avatarToneRing),
    and badgedAvatar in the schema kit for a corner mark. Both are open vocabularies, so the next
    kind of badge needs no change here.
  */
  :host([size='xxs']) {
    --we-avatar-size: var(--we-avatar-size-xxs);
  }
  :host([size='xs']) {
    --we-avatar-size: var(--we-avatar-size-xs);
  }
  :host([size='sm']) {
    --we-avatar-size: var(--we-avatar-size-sm);
  }
  :host([size='md']) {
    --we-avatar-size: var(--we-avatar-size-md);
  }
  :host([size='lg']) {
    --we-avatar-size: var(--we-avatar-size-lg);
  }
  :host([size='xl']) {
    --we-avatar-size: var(--we-avatar-size-xl);
  }
  :host([size='xxl']) {
    --we-avatar-size: var(--we-avatar-size-xxl);
  }
  [part='base'] {
    position: relative;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  svg {
    width: calc(var(--we-avatar-size) - 30%);
    height: calc(var(--we-avatar-size) - 30%);
  }

  [part='icon'] {
    --we-icon-size: calc(var(--we-avatar-size) * 0.6);
  }

  /* inherit, not a second 50%: the host's radius is themeable (--we-theme-avatar-radius) and a
     hardcoded circle here would win for exactly the avatars that have a picture — so a theme asking
     for rounded-square avatars got squares everywhere except where it mattered most. */
  [part='img'] {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    object-fit: cover;
  }

  [part='initials'] {
    font-weight: 600;
    text-transform: uppercase;
  }
`;

@customElement('we-avatar')
export default class Avatar extends LayoutVisualElement {
  static styles = [sharedStyles, styles];

  static getDefaultProps(): Partial<DesignSystemProps> {
    return DEFAULT_PROPS;
  }

  /**
   * Deliberately not reflected, unlike every other string property here.
   *
   * A WE profile picture is a base64 data URI rather than a URL, and an uncapped one runs to
   * hundreds of kilobytes. Reflecting it writes that whole string into the DOM as an attribute:
   * held twice per avatar, re-written on every update, and serialized into anything that reads
   * `outerHTML`. It also stalls the element inspector for seconds on a single avatar, which is how
   * it was found. `we-image` leaves `src` unreflected for the same reason.
   *
   * CSS still needs to know whether there is a picture, so `willUpdate` maintains a `has-image`
   * marker attribute — one bit instead of the payload.
   */
  @property({ type: String }) image = '';
  @property({ type: String, reflect: true }) hash = '';
  @property({ type: String, reflect: true }) initials = '';
  @property({ type: String }) icon = '';
  @property({ type: String, reflect: true }) size?: SizeValue;
  @property({ type: Boolean, reflect: true }) clickable = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  // Before render rather than after, so the disc is already gone on the frame the picture first
  // paints — set in `updated` it would flash behind a transparent-edged image on mount.
  willUpdate(props: Map<string, unknown>) {
    super.willUpdate(props);
    this.toggleAttribute('has-image', !!this.image);
  }

  updated(props: Map<string, unknown>) {
    super.updated(props);

    // Handle custom size values (e.g., "20px", "2rem")
    if (props.has('size') && this.size && !['xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'].includes(this.size)) {
      this.style.setProperty('--we-avatar-size', this.size);
    }
  }

  private get derivedInitials(): string {
    if (!this.initials) return '';
    const words = this.initials.trim().split(/\s+/);
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
  }

  /*
    A picture, else letters, else a generated pattern, else a glyph.

    Initials outrank `hash`, and the order is the whole design rather than a preference. `hash` used
    to win, which made `initials` unreachable on any element that set both — so a space passing its
    name as both showed generated art while the *same space* showed its letters everywhere else in
    the app, and nothing said why.

    What `hash` means here is "the stable thing this is", not "draw a pattern". It is the seed for
    the generated colour under the letters, and it draws the pattern only when there are no letters
    to draw — which is exactly the case the identicon exists for: an agent whose profile has not
    arrived has an empty `initials` and falls through, so two unresolved peers stay distinguishable
    instead of being two identical blank discs. Name arrives, letters take over.
  */
  private renderContent() {
    if (this.image) return html`<img part="img" .src=${this.image} />`;
    if (this.derivedInitials) return html`<span part="initials">${this.derivedInitials}</span>`;
    if (this.hash) return unsafeSVG(toSvg(this.hash, 100));
    return html`<we-icon part="icon" name=${this.icon || 'user'}></we-icon>`;
  }

  /**
   * The generated fill, when there are letters to sit on it.
   *
   * Seeded from `hash` where there is one and from the initials otherwise, so a caller that can
   * offer a stable id gets a colour that survives a rename, and one that cannot still gets a
   * colour rather than the flat grey every avatar shared before.
   *
   * Nothing when a picture is showing: an image covers the disc, and tinting behind it would only
   * show through a transparent PNG as a colour nobody chose.
   */
  private initialsFill(): Record<string, string> {
    if (this.image || !this.derivedInitials) return {};
    const { bg, fg } = seededFill(this.hash || this.initials);
    return { '--we-avatar-bg': bg, color: fg };
  }

  render() {
    // The caller's own `styles` last, so a call site that names a background still wins over the
    // generated one.
    const inline = { ...this.initialsFill(), ...(this.styles || {}) };
    return this.clickable
      ? html` <button part="base" style=${styleMap(inline)}>${this.renderContent()}</button> `
      : html` <div part="base" style=${styleMap(inline)}>${this.renderContent()}</div> `;
  }
}
