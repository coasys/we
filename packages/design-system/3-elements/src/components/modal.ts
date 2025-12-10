import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import sharedStyles from '../shared/styles';

import { DesignSystemElement } from '../shared/design-system-element';
import type { DesignSystemProps } from '@we/design-system-types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  // Backdrop styles
  width: '100vw',
  height: '100vh',
  position: 'fixed',

  // Modal styles
  bg: 'ui-0',
  r: 'xl',
  p: '800',
  ax: 'center',
  ay: 'center',
  gap: '300',
};

const CSS_STYLES = css`
  :host {
    background: rgba(0, 0, 0, 0.6);
    align-items: center;
    justify-content: center;
  }

  [part='base'] {
    position: relative;
  }

  [part='close-button-wrapper'] {
    position: absolute;
    top: 8px;
    right: 8px;
  }
`;

@customElement('we-modal')
export default class Modal extends DesignSystemElement {
  static styles = [sharedStyles, CSS_STYLES];

  @property({ type: Boolean }) hideclosebutton = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;
  @property({ attribute: false }) close: () => void = () => {};

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener('click', this._onBackdropClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this._onBackdropClick);
  }

  private _onBackdropClick = (e: MouseEvent) => {
    // Only close if clicking directly on the host (backdrop), not on children
    if (e.target === this) {
      this.close();
    }
  };

  render() {
    return html`
      <div @click=${(e: Event) => e.stopPropagation()}>
        <div part="base">
          ${!this.hideclosebutton
            ? html`
                <div part="close-button-wrapper">
                  <slot name="close-button">
                    <we-button part="close-button" p="0" bg="none" @click=${this.close}>
                      <we-icon name="x" size="sm"></we-icon>
                    </we-button>
                  </slot>
                </div>
              `
            : null}
          <slot></slot>
        </div>
      </div>
    `;
  }
}
