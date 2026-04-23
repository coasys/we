import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

/** @deprecated Use SelectOption instead */
export type ComboboxOption = SelectOption;

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'inline-flex',
  direction: 'column',
  width: '100%',
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  sm: { fontSize: '300' },
  md: { fontSize: '400' },
  lg: { fontSize: '500' },
};

const INPUT_HEIGHT: Record<ComponentSize, string> = {
  sm: '32px',
  md: '40px',
  lg: '48px',
};

const styles = css`
  [part='input-wrapper'] {
    position: relative;
    display: flex;
    align-items: center;
    border: 1px solid var(--we-color-neutral-300);
    border-radius: var(--we-radius-400);
    background: var(--we-color-neutral-0);
    transition: border-color 0.15s ease;
  }

  [part='input-wrapper']:focus-within {
    border-color: var(--we-color-primary-500);
    outline: 2px solid var(--we-color-primary-100);
    outline-offset: -1px;
  }

  input[part='native'] {
    all: unset;
    flex: 1;
    padding: 0 var(--we-space-300);
    font: inherit;
    color: inherit;
  }

  [part='toggle'] {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0 var(--we-space-200);
    opacity: 0.5;
  }

  [part='native-button'] {
    all: unset;
    flex: 1;
    padding: 0 var(--we-space-300);
    font: inherit;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  [part='native-button']:empty::before {
    content: attr(placeholder);
    color: var(--we-color-neutral-400);
  }

  [part='listbox'] {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: var(--we-z-dropdown);
    max-height: 200px;
    overflow-y: auto;
    background: var(--we-color-neutral-0);
    border: 1px solid var(--we-color-neutral-200);
    border-radius: var(--we-radius-400);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    margin-top: var(--we-space-100);
    padding: var(--we-space-100) 0;
  }

  [part='option'] {
    padding: var(--we-space-200) var(--we-space-300);
    cursor: pointer;
    transition: background 0.1s ease;
  }

  [part='option']:hover,
  [part='option'][aria-selected='true'] {
    background: var(--we-color-primary-50);
  }

  [part='option'][aria-disabled='true'] {
    opacity: 0.5;
    cursor: default;
  }

  [part='empty'] {
    padding: var(--we-space-300);
    color: var(--we-color-neutral-500);
    text-align: center;
  }

  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
`;

@customElement('we-select')
export default class Select extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Array }) options: SelectOption[] = [];
  @property({ type: String }) value = '';
  @property({ type: String }) placeholder = '';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) searchable = false;
  @property({ type: String }) name = '';
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  @state() private _open = false;
  @state() private _filter = '';

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Select & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
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

  private get _filtered() {
    if (!this._filter) return this.options;
    const q = this._filter.toLowerCase();
    return this.options.filter((o) => o.label.toLowerCase().includes(q));
  }

  private get _displayValue() {
    return this.options.find((o) => o.value === this.value)?.label ?? '';
  }

  private _onInput(e: Event) {
    e.stopPropagation();
    this._filter = (e.target as HTMLInputElement).value;
    this._open = true;
  }

  private _select(opt: SelectOption) {
    if (opt.disabled) return;
    this.value = opt.value;
    this._filter = '';
    this._open = false;
    this.dispatchEvent(new CustomEvent('change', { detail: opt.value, bubbles: true, composed: true }));
  }

  private _toggle() {
    this._open = !this._open;
  }

  render() {
    const h = INPUT_HEIGHT[this.size];
    const filtered = this._filtered;
    const displayVal = this._open ? this._filter : this._displayValue;

    return html`
      <div part="base" style=${styleMap({ position: 'relative', ...this.styles })}>
        <div part="input-wrapper" style=${styleMap({ height: h })}>
          ${this.searchable
            ? html`
                <input
                  part="native"
                  type="text"
                  .value=${displayVal}
                  placeholder=${this.placeholder || nothing}
                  ?disabled=${this.disabled}
                  role="combobox"
                  aria-expanded=${this._open ? 'true' : 'false'}
                  aria-autocomplete="list"
                  @input=${this._onInput}
                  @focus=${() => (this._open = true)}
                />
              `
            : html`
                <button
                  part="native-button"
                  ?disabled=${this.disabled}
                  role="combobox"
                  aria-expanded=${this._open ? 'true' : 'false'}
                  @click=${this._toggle}
                >
                  ${this._displayValue || this.placeholder || nothing}
                </button>
              `}
          <button part="toggle" tabindex="-1" @click=${this._toggle} aria-label="Toggle options">
            <we-icon name=${this._open ? 'caret-up' : 'caret-down'} size="16px"></we-icon>
          </button>
        </div>
        ${this._open
          ? html`
              <div part="listbox" role="listbox">
                ${filtered.length > 0
                  ? filtered.map(
                      (opt) => html`
                        <div
                          part="option"
                          role="option"
                          aria-selected=${opt.value === this.value ? 'true' : 'false'}
                          aria-disabled=${opt.disabled ? 'true' : nothing}
                          @click=${() => this._select(opt)}
                        >
                          ${opt.label}
                        </div>
                      `,
                    )
                  : html`<div part="empty">No results</div>`}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}
