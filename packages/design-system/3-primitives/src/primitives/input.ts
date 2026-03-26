import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { InputSize } from '../types';

let inputIdCounter = 0;

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  direction: 'column',
  ay: 'center',
  px: '300',
  py: '200',
  fontSize: '400',
  bg: 'ui-75',
  r: 'sm',
  color: 'ui-1000',
  hoverProps: { bg: 'ui-100' },
  focusProps: { bg: 'ui-100', shadow: '0 0 0 2px var(--we-color-primary-500)' },
};

const SIZE_DEFAULTS: Record<InputSize, Partial<DesignSystemProps>> = {
  sm: { px: '200', py: '100', fontSize: '300' },
  md: { px: '300', py: '200', fontSize: '400' },
  lg: { px: '400', py: '300', fontSize: '500' },
};

const styles = css`
  [part='input-wrapper'] {
    display: flex;
    align-items: center;
    width: 100%;
  }

  [part='input'] {
    flex: 1;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    outline: none;
    padding: 0;
    min-width: 0;
  }

  [part='input']::placeholder {
    color: var(--we-color-ui-400);
  }

  [part='help-text'] {
    font-size: var(--we-font-size-300);
    margin-top: var(--we-space-100);
  }

  [part='error-text'] {
    font-size: var(--we-font-size-300);
    margin-top: var(--we-space-100);
    color: var(--we-color-danger-500);
  }
`;

@customElement('we-input')
export default class Input extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  private _inputId = `we-input-${++inputIdCounter}`;

  @property({ type: String, reflect: true }) value = '';
  @property({ type: String, reflect: true }) max = '';
  @property({ type: String, reflect: true }) min = '';
  @property({ type: Number, reflect: true }) maxlength = Infinity;
  @property({ type: Number, reflect: true }) minlength = 0;
  @property({ type: String, reflect: true }) pattern = '';
  @property({ type: String, reflect: true }) label = '';
  @property({ type: String, reflect: true }) name = '';
  @property({ type: String, reflect: true }) step = '';
  @property({ type: String, reflect: true }) placeholder = '';
  @property({ type: String, reflect: true }) errortext = '';
  @property({ type: String, reflect: true }) helptext = '';
  @property({ type: String, reflect: true }) autocomplete = '';
  @property({ type: Boolean, reflect: true }) autovalidate = false;
  @property({ type: Boolean, reflect: true }) autofocus = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) error = false;
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) readonly = false;
  @property({ type: String, reflect: true }) type = 'text';
  @property({ type: String, reflect: true }) size: InputSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Input & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  select() {
    this.renderRoot.querySelector('input')?.select();
  }

  focus() {
    this.renderRoot.querySelector('input')?.focus();
  }

  validate() {
    this.error = !this.renderRoot.querySelector('input')?.checkValidity();
    if (this.error) this.errortext = this.errortext || this.renderRoot.querySelector('input')?.validationMessage || '';
    this.dispatchEvent(new CustomEvent('validate'));
    return this.error;
  }

  handleInput(e: InputEvent) {
    this.value = (e.target as HTMLInputElement)?.value;
    this.dispatchEvent(new CustomEvent('we-input', { detail: this.value, bubbles: true, composed: true }));
  }

  handleChange(e: Event) {
    this.value = (e.target as HTMLInputElement)?.value;
    this.dispatchEvent(new CustomEvent('we-change', { detail: this.value, bubbles: true, composed: true }));
  }

  handleFocus() {
    this.dispatchEvent(new CustomEvent('we-focus', { bubbles: true, composed: true }));
  }

  handleBlur() {
    if (this.autovalidate) this.validate();
    this.dispatchEvent(new CustomEvent('we-blur', { bubbles: true, composed: true }));
  }

  handleKeyDown(e: KeyboardEvent) {
    this.dispatchEvent(
      new CustomEvent('we-keydown', { detail: { key: e.key, code: e.code }, bubbles: true, composed: true }),
    );
  }

  render() {
    const descId =
      this.error && this.errortext ? `${this._inputId}-error` : this.helptext ? `${this._inputId}-help` : undefined;

    const inline = this.styles || {};
    return html`
      <div part="base" style=${styleMap(inline)}>
        ${this.label ? html`<label part="label" for=${this._inputId}>${this.label}</label>` : null}
        <div part="input-wrapper">
          <slot name="start"></slot>
          <input
            part="input"
            id=${this._inputId}
            aria-describedby=${descId || ''}
            .value=${this.value}
            .type=${this.type}
            .max=${this.max}
            .min=${this.min}
            .step=${this.step}
            .autocomplete=${this.autocomplete}
            maxlength=${this.maxlength}
            minlength=${this.minlength}
            pattern=${this.pattern}
            placeholder=${this.placeholder}
            ?autofocus=${this.autofocus}
            ?readonly=${this.readonly}
            ?required=${this.required}
            ?disabled=${this.disabled}
            @input=${this.handleInput}
            @change=${this.handleChange}
            @blur=${this.handleBlur}
            @focus=${this.handleFocus}
            @keydown=${this.handleKeyDown}
          />
          <slot name="end"></slot>
        </div>
        ${this.error
          ? this.errortext
            ? html`<div part="error-text" id=${`${this._inputId}-error`}>${this.errortext}</div>`
            : null
          : this.helptext
            ? html`<div part="help-text" id=${`${this._inputId}-help`}>${this.helptext}</div>`
            : null}
      </div>
    `;
  }
}
