import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  cursor: 'pointer',
  bg: 'primary-100',
  color: 'primary-800',
  r: 'md',
  px: '400',
  py: '200',
  // height: '36px',
  ax: 'center',
  ay: 'center',
  gap: '300',
  disabledProps: { cursor: 'default', opacity: 0.5 },
};

const CSS_STYLES = css`
  :host {
    white-space: nowrap;
  }

  [part='base'] {
    all: unset;
    box-sizing: border-box;
  }
`;

@customElement('we-button')
export default class Button extends DesignSystemElement {
  static styles = [sharedStyles, CSS_STYLES];

  @property({ type: String }) text?: string;
  @property({ type: String }) href?: string;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) loading = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;
  @property({ attribute: false }) onClick = () => {};

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  private _onClick = (e: MouseEvent) => {
    if (this.disabled || this.loading) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    this.dispatchEvent(new CustomEvent('button-click', { detail: e }));
  };

  private _content() {
    return html`
      ${this.loading ? html`<we-spinner size="sm" color="currentColor"></we-spinner>` : null}
      <slot name="start"></slot>
      ${this.text ?? html`<slot></slot>`}
      <slot name="end"></slot>
    `;
  }

  render() {
    const inline = this.styles || {};

    if (this.href) {
      return html`
        <a
          part="base"
          href=${this.href}
          aria-disabled=${this.disabled || this.loading ? 'true' : 'false'}
          @click=${this._onClick}
          style=${styleMap(inline)}
        >
          ${this._content()}
        </a>
      `;
    }

    return html`
      <button part="base" ?disabled=${this.disabled || this.loading} @click=${this._onClick} style=${styleMap(inline)}>
        ${this._content()}
      </button>
    `;
  }
}
