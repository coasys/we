import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { OverlayElement } from '../shared/overlay-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  bg: 'ui-0',
  r: 'xl',
  p: '900',
  ax: 'center',
  ay: 'center',
  gap: '300',
  direction: 'column',
};

const CSS_STYLES = css`
  :host {
    align-items: center;
    justify-content: center;
  }

  [part='backdrop'] {
    position: absolute;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
  }

  [part='base'] {
    position: relative;
  }

  [part='close-button-wrapper'] {
    position: absolute;
    top: 10px;
    right: 10px;
  }
`;

@customElement('we-modal')
export default class Modal extends OverlayElement {
  static styles = [sharedStyles, CSS_STYLES];

  @property({ type: Boolean }) hideclosebutton = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;
  @property({ attribute: false }) close: () => void = () => {};

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onKeyDown = this._onKeyDown.bind(this);
    document.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._onKeyDown);
  }

  private _onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.close();
    }
  }

  render() {
    return html`
      <div part="backdrop" @click=${this.close}></div>
      <div part="base" role="dialog" aria-modal="true">
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
    `;
  }
}
