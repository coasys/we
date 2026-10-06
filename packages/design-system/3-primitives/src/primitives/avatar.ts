import type { DesignSystemProps } from '@we/design-types';
import { AVATAR_TONES, type AvatarTone, avatarToneColor } from '@we/tokens';
import { toSvg } from 'jdenticon';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';

import { LayoutVisualElement } from '../shared/design-system-element';
import { seededFill } from '../shared/seededColor';
import sharedStyles from '../shared/styles';
import type { SizeValue } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  flex: '0 0 auto',
};

/** A tone name reads as that tone's colour; anything else is taken as a CSS colour. */
const ringColorOf = (value: string): string =>
  (AVATAR_TONES as readonly string[]).includes(value) ? avatarToneColor(value as AvatarTone) : value;

/**
 * The rings an avatar paints inside its own edge, as one `box-shadow` list — or nothing.
 *
 * The edge is outermost and listed first, since the first shadow in a list paints on top: it is a
 * thin band in the colour behind the avatar, which is how overlapping faces in a stack stay apart.
 * The ring sits inside it. Both are inset, and both are drawn on a layer *above* the picture — see
 * the `::after` rule — because an inset shadow on the box itself paints beneath its content, and
 * the `<img>` would cover it.
 */
export function avatarInnerRings(opts: { ringColor?: string; ringWidth?: string; edgeColor?: string }): string {
  const edge = opts.edgeColor ? `inset 0 0 0 var(--we-avatar-edge-width) ${ringColorOf(opts.edgeColor)}` : '';
  const width = opts.ringWidth || 'var(--we-avatar-ring-width)';
  const ring = opts.ringColor
    ? `inset 0 0 0 ${opts.edgeColor ? `calc(var(--we-avatar-edge-width) + ${width})` : width} ${ringColorOf(opts.ringColor)}`
    : '';
  return [edge, ring].filter(Boolean).join(', ');
}

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
    /* How thick a ring and an edge are, by size — see ringColor. Thinner small, since 2px is a fifth
       of the radius of a 20px face. Overridable per avatar with ringWidth, or by a theme. */
    --we-avatar-ring-width: 2px;
    --we-avatar-edge-width: 2px;
  }
  :host([size='xxs']),
  :host([size='xs']) {
    --we-avatar-ring-width: 1.5px;
    --we-avatar-edge-width: 1.5px;
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

    What replaces them: a tone through ringColor, drawn inside the face (see the ::after rule),
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

  /*
    The ring, inside the avatar's own box and above its picture.

    Inside, so an avatar is the size it says whether or not it is ringed: a ring drawn outside made a
    24px face look 28px beside a 24px button, made ringed and unringed faces in one row look like two
    sizes, and reached into whatever sat next to it. Above the picture, because an inset shadow on
    [part=base] itself paints beneath its content and the image would cover it. radius: inherit, so
    it follows the theme's avatar shape — a circle, a rounded square, a square.
  */
  [part='base']::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    box-shadow: var(--we-avatar-inner-rings, none);
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

  /*
    Sized from the avatar, not from whatever it is sitting in.

    This set no font-size at all, so the letters inherited one — and in the sidebar the avatar sits
    inside a we-button at size lg, whose font-size is 20px, in a 32px disc. Measured at that size: a
    single letter takes 46% of the disc and reads fine, a pair takes 81% and looks squashed, and the
    widest pair takes 119% — wider than the circle containing it. Which is why only the two-letter
    spaces showed it, and why nobody had noticed the one-letter ones were oversized too.

    0.4 is chosen against the worst case rather than the common one: the widest pair lands at 76% of
    the disc. The icon branch above already scales this way at 0.6 — a glyph is one mark and can
    afford to fill more than two letters can.

    A lone letter takes the larger size, and that is an *optical* correction rather than a geometric
    one. One ratio gives "D" and "DT" the same cap height, so the single letter has half the mass in
    the same circle and reads as undersized — which is exactly how it looked. Sizing it up to 0.5
    lifts its cap height to 36% of the disc against the pair's 29%, so the two weigh the same
    without the single one starting to dominate, which is where 0.55 lands.

    line-height so the box is the letters and nothing more; the disc centres it.
  */
  [part='initials'] {
    font-size: calc(var(--we-avatar-size) * 0.4);
    line-height: 1;
    font-weight: 600;
    text-transform: uppercase;
  }

  [part='initials'][data-single] {
    font-size: calc(var(--we-avatar-size) * 0.5);
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
  /**
   * A ring inside the avatar's edge — a tone (`primary`, `success`, `warning`, `danger`, `neutral`)
   * or any CSS colour. Empty for none.
   *
   * Not the generic `ring` design-system prop, which buttons and fields use for focus and which
   * paints *outside* the box. An avatar's ring is a mark on the face, so it is drawn inside it, and
   * the face stays the size it says.
   */
  @property({ type: String }) ringColor = '';
  /** How thick that ring is — any CSS length. Empty for the size's own default. */
  @property({ type: String }) ringWidth = '';
  /**
   * A thin band just inside the edge, in the colour behind the avatar — how faces that overlap stay
   * apart. `AvatarStack` sets it; a face on its own has no use for one.
   */
  @property({ type: String }) edgeColor = '';
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
    if (this.derivedInitials)
      return html`<span part="initials" ?data-single=${this.derivedInitials.length === 1}
        >${this.derivedInitials}</span
      >`;
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
    const rings = avatarInnerRings({ ringColor: this.ringColor, ringWidth: this.ringWidth, edgeColor: this.edgeColor });
    const inline = {
      ...this.initialsFill(),
      ...(rings ? { '--we-avatar-inner-rings': rings } : {}),
      ...(this.styles || {}),
    };
    return this.clickable
      ? html` <button part="base" style=${styleMap(inline)}>${this.renderContent()}</button> `
      : html` <div part="base" style=${styleMap(inline)}>${this.renderContent()}</div> `;
  }
}
