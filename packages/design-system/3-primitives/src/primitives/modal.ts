import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { OverlayElement } from '../shared/overlay-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  bg: 'var(--we-role-surface-raised)',
  r: '600',
  p: '900',
  ax: 'stretch',
  /*
    Start, not centre. The base grows with its content, so centring on the main axis does nothing
    until maxHeight clamps it — and at that point it centres the *overflow* too, pushing the first
    field up past the top edge where no amount of scrolling reaches it. The host still centres the
    modal itself in the viewport, which is the centring anybody actually sees.
  */
  ay: 'start',
  gap: '500',
  direction: 'column',
  maxHeight: 'calc(100vh - 64px)',
  /*
    Scroll rather than spill.

    maxHeight lands on [part='base'] (see OverlayElement), but nothing bounded what happened when
    the content exceeded it: a modal that grew — a form gaining rows — pushed its content out past
    its own edge and off the screen, with no way to reach the buttons at the bottom.

    This has to be a default prop rather than a rule in the stylesheet below. The generated sheet
    declares overflow on [part='base'] itself, and wins there whatever a component writes.
  */
  overflow: 'auto',
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
    background: var(--we-role-overlay);
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
    } else if (e.key === 'Tab') {
      this._trapFocus(e);
    }
  }

  private _trapFocus(e: KeyboardEvent) {
    const base = this.renderRoot.querySelector('[part="base"]');
    if (!base) return;
    const focusable = base.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  render() {
    return html`
      <div part="backdrop" @click=${this.close}></div>
      <div part="base" role="dialog" aria-modal="true">
        ${
          !this.hideclosebutton
            ? html`
                <div part="close-button-wrapper">
                  <slot name="close-button">
                    <we-button part="close-button" variant="ghost" size="sm" square @click=${this.close}>
                      <we-icon name="x"></we-icon>
                    </we-button>
                  </slot>
                </div>
              `
            : null
        }
        <slot></slot>
      </div>
    `;
  }
}
