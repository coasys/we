import type { DesignSystemProps } from '@we/design-types';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { OverlayElement } from '../shared/overlay-element';
import sharedStyles from '../shared/styles';
import type { DrawerPosition } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  bg: 'neutral-0',
  p: '600',
  direction: 'column',
  gap: '300',
};

const POSITION_CSS: Record<DrawerPosition, Record<string, string>> = {
  left: { top: '0', left: '0', height: '100%' },
  right: { top: '0', right: '0', height: '100%' },
  top: { top: '0', left: '0', width: '100%' },
  bottom: { bottom: '0', left: '0', width: '100%' },
};

const styles = css`
  :host {
    z-index: var(--we-z-modal);
  }

  [part='backdrop'] {
    position: absolute;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.4);
  }

  [part='base'] {
    position: absolute;
    overflow-y: auto;
    box-shadow: var(--we-shadow-lg, 0 10px 40px rgba(0, 0, 0, 0.15));
    transition: transform 0.25s ease;
  }

  [part='close-button-wrapper'] {
    position: absolute;
    top: 10px;
    right: 10px;
  }
`;

@customElement('we-drawer')
export default class Drawer extends OverlayElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) position: DrawerPosition = 'right';
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
    const posStyles = POSITION_CSS[this.position] ?? POSITION_CSS.right;

    return html`
      <div part="backdrop" @click=${this.close}></div>
      <div part="base" role="dialog" aria-modal="true" style=${styleMap({ ...posStyles, ...this.styles })}>
        ${!this.hideclosebutton
          ? html`
              <div part="close-button-wrapper">
                <slot name="close-button">
                  <we-button part="close-button" variant="ghost" p="0" @click=${this.close}>
                    <we-icon name="x" size="sm"></we-icon>
                  </we-button>
                </slot>
              </div>
            `
          : nothing}
        <slot></slot>
      </div>
    `;
  }
}
