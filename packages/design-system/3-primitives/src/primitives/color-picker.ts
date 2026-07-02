import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'inline-flex',
  direction: 'column',
  gap: '200',
};

const styles = css`
  [part='preview'] {
    width: 48px;
    height: 48px;
    border-radius: var(--we-radius-400);
    border: 2px solid var(--we-color-neutral-200);
    cursor: pointer;
    transition: border-color 0.15s ease;
  }

  [part='preview']:hover {
    border-color: var(--we-color-primary-500);
  }

  [part='popover'] {
    position: absolute;
    z-index: var(--we-z-dropdown);
    background: var(--we-color-neutral-0);
    border: 1px solid var(--we-color-neutral-200);
    border-radius: var(--we-radius-500);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    padding: var(--we-space-400);
    display: flex;
    flex-direction: column;
    gap: var(--we-space-300);
  }

  [part='palette'] {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
  }

  [part='swatch'] {
    all: unset;
    width: 24px;
    height: 24px;
    border-radius: var(--we-radius-300);
    cursor: pointer;
    border: 2px solid transparent;
    transition: border-color 0.15s ease;
  }

  [part='swatch']:hover {
    border-color: var(--we-color-neutral-400);
  }

  [part='swatch'][aria-selected='true'] {
    border-color: var(--we-color-primary-500);
  }

  [part='hex-input'] {
    display: flex;
    align-items: center;
    gap: var(--we-space-200);
  }

  [part='hex-input'] input {
    all: unset;
    border: 1px solid var(--we-color-neutral-300);
    border-radius: var(--we-radius-400);
    padding: var(--we-space-100) var(--we-space-200);
    font-family: monospace;
    font-size: 0.875em;
    width: 7em;
  }

  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
`;

const PALETTE = [
  '#000000',
  '#434343',
  '#666666',
  '#999999',
  '#b7b7b7',
  '#cccccc',
  '#d9d9d9',
  '#ffffff',
  '#980000',
  '#ff0000',
  '#ff9900',
  '#ffff00',
  '#00ff00',
  '#00ffff',
  '#4a86e8',
  '#0000ff',
  '#9900ff',
  '#ff00ff',
  '#e6b8af',
  '#f4cccc',
  '#fce5cd',
  '#fff2cc',
  '#d9ead3',
  '#d0e0e3',
  '#c9daf8',
  '#cfe2f3',
  '#d9d2e9',
  '#ead1dc',
];

@customElement('we-color-picker')
export default class ColorPicker extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) value = '#000000';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: String }) name = '';
  @property({ type: Array }) palette = PALETTE;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  @state() private _open = false;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onDocClick = this._onDocClick.bind(this);
    document.addEventListener('click', this._onDocClick);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._onDocClick);
  }

  private _onDocClick(e: Event) {
    if (!this.contains(e.target as Node)) this._open = false;
  }

  private _selectColor(color: string) {
    this.value = color;
    this.dispatchEvent(new CustomEvent('change', { detail: color, bubbles: true, composed: true }));
  }

  private _onHexInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      this._selectColor(val);
    }
  }

  render() {
    return html`
      <div part="base" style=${styleMap({ position: 'relative', ...this.styles })}>
        <button
          part="preview"
          style=${styleMap({ background: this.value })}
          @click=${() => (this._open = !this._open)}
          aria-label="Pick color"
        ></button>

        ${
          this._open
            ? html`
                <div part="popover">
                  <div part="palette">
                    ${this.palette.map(
                      (color) => html`
                        <button
                          part="swatch"
                          style=${styleMap({ background: color })}
                          aria-selected=${color === this.value ? 'true' : 'false'}
                          aria-label=${color}
                          @click=${() => this._selectColor(color)}
                        ></button>
                      `,
                    )}
                  </div>
                  <div part="hex-input">
                    <span>#</span>
                    <input
                      type="text"
                      .value=${this.value.replace('#', '')}
                      maxlength="6"
                      @input=${(e: Event) => {
                        const val = '#' + (e.target as HTMLInputElement).value;
                        this._onHexInput({ target: { value: val } } as unknown as Event);
                      }}
                    />
                  </div>
                </div>
              `
            : null
        }
      </div>
    `;
  }
}
