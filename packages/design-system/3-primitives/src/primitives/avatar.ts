import type { DesignSystemProps } from '@we/design-types';
import { toSvg } from 'jdenticon';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';

import { LayoutElement } from '../shared/design-system-element';
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
    --we-avatar-size: var(--we-size-md);
    --we-avatar-box-shadow: none;
    --we-avatar-border: none;
    --we-avatar-color: var(--we-color-black);
    --we-avatar-bg: var(--we-color-neutral-100);
  }
  :host([src]) {
    --we-avatar-bg: transparent;
  }
  :host([selected]) {
    --we-avatar-box-shadow: 0px 0px 0px 2px var(--we-color-primary-500);
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
    background: var(--we-color-primary-500);
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
    cursor: inherit;
    box-shadow: var(--we-avatar-box-shadow);
    color: var(--we-avatar-color);
    background: var(--we-avatar-bg);
    border: var(--we-avatar-border);
    padding: 0;
    border-radius: 50%;
  }

  svg {
    width: calc(var(--we-avatar-size) - 30%);
    height: calc(var(--we-avatar-size) - 30%);
  }

  [part='icon'] {
    --we-icon-size: calc(var(--we-avatar-size) * 0.6);
  }

  [part='img'] {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  [part='initials'] {
    font-weight: 600;
    text-transform: uppercase;
  }
`;

@customElement('we-avatar')
export default class Avatar extends LayoutElement {
  static styles = [sharedStyles, styles];

  static getDefaultProps(): Partial<DesignSystemProps> {
    return DEFAULT_PROPS;
  }

  @property({ type: String, reflect: true }) image = '';
  @property({ type: String, reflect: true }) hash = '';
  @property({ type: Boolean, reflect: true }) selected = false;
  @property({ type: Boolean, reflect: true }) online = false;
  @property({ type: String, reflect: true }) initials = '';
  @property({ type: String }) icon = '';
  @property({ type: String, reflect: true }) size?: SizeValue;
  @property({ type: Boolean, reflect: true }) clickable = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

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
