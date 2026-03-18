import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  direction: 'column',
  px: '300',
  bg: 'ui-75',
  r: 'sm',
  color: 'ui-1000',
  hoverProps: { bg: 'ui-100' },
  focusProps: { bg: 'ui-100', shadow: '0 0 0 2px var(--we-color-primary-500)' },
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
  @property({ attribute: false }) onInput: (event: InputEvent) => void = () => {};
  @property({ attribute: false }) onChange: (event: Event) => void = () => {};
  @property({ attribute: false }) onFocus: (event: FocusEvent) => void = () => {};
  @property({ attribute: false }) onBlur: (event: FocusEvent) => void = () => {};
  @property({ attribute: false }) onKeyDown: (event: KeyboardEvent) => void = () => {};

  static getDefaultProps() {
    return DEFAULT_PROPS;
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
    e.stopPropagation();
    this.value = (e.target as HTMLInputElement)?.value;
    this.dispatchEvent(new CustomEvent('input', { detail: this.value, bubbles: true, composed: true }));
  }

  handleChange(e: Event) {
    e.stopPropagation();
    this.value = (e.target as HTMLInputElement)?.value;
    this.dispatchEvent(new CustomEvent('change', e));
  }

  handleFocus(e: FocusEvent) {
    e.stopPropagation();
    this.value = (e.target as HTMLInputElement)?.value;
    this.dispatchEvent(new CustomEvent('focus', e));
  }

  handleBlur(e: FocusEvent) {
    e.stopPropagation();
    if (this.autovalidate) this.validate();
    this.dispatchEvent(new CustomEvent('blur', e));
  }

  handleKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    const event = new KeyboardEvent(e.type, e);
    this.dispatchEvent(event);
  }

  render() {
    return html`
      <div part="base">
        ${this.label ? html`<we-text tag="label" part="label">${this.label}</we-text>` : null}
        <div part="input-wrapper">
          <slot name="start"></slot>
          <input
            part="input"
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
            ? html`<div part="error-text">${this.errortext}</div>`
            : null
          : this.helptext
            ? html`<div part="help-text">${this.helptext}</div>`
            : null}
      </div>
    `;
  }
}
