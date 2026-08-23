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
  :host([selected]) {
    --we-avatar-box-shadow: 0px 0px 0px 2px var(--we-role-accent);
  }
  :host([online]) [part='base']:before {
    position: absolute;
    right: 0;
    bottom: 0;
    content: '';
    display: block;
    width: 25%;
    height: 25%;
    border-radius: 50%;
    background: var(--we-role-accent);
  }
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
  @property({ type: Boolean, reflect: true }) selected = false;
  @property({ type: Boolean, reflect: true }) online = false;
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

  private renderContent() {
    return this.image
      ? html`<img part="img" .src=${this.image} />`
      : this.hash
        ? unsafeSVG(toSvg(this.hash || '', 100))
        : this.initials
          ? html`<span part="initials">${this.derivedInitials}</span>`
          : html`<we-icon part="icon" name=${this.icon || 'user'}></we-icon>`;
  }

  render() {
    const inline = this.styles || {};
    return this.clickable
      ? html` <button part="base" style=${styleMap(inline)}>${this.renderContent()}</button> `
      : html` <div part="base" style=${styleMap(inline)}>${this.renderContent()}</div> `;
  }
}
