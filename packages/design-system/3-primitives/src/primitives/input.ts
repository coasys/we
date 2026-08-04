import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  ay: 'center',
  px: '300',
  fontSize: '300',
  bg: 'neutral-50',
  r: '300',
  color: 'neutral-1000',
  hoverProps: { bg: 'neutral-75', ring: '0 0 0 2px var(--we-ring-color, var(--we-color-primary-500))' },
  activeProps: { bg: 'neutral-75', ring: '0 0 0 2px var(--we-ring-color, var(--we-color-primary-500))' },
  focusProps: { bg: 'neutral-75', ring: '0 0 0 2px var(--we-ring-color, var(--we-color-primary-500))' },
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: {
    px: '100',
    fontSize: '100',
    height: 'calc(var(--we-component-height-xs) + var(--we-theme-control-height-offset, 0px))',
  },
  sm: {
    px: '200',
    fontSize: '200',
    height: 'calc(var(--we-component-height-sm) + var(--we-theme-control-height-offset, 0px))',
  },
  md: {
    px: '300',
    fontSize: '300',
    height: 'calc(var(--we-component-height-md) + var(--we-theme-control-height-offset, 0px))',
  },
  lg: {
    px: '400',
    fontSize: '400',
    height: 'calc(var(--we-component-height-lg) + var(--we-theme-control-height-offset, 0px))',
  },
  xl: {
    px: '500',
    fontSize: '400',
    height: 'calc(var(--we-component-height-xl) + var(--we-theme-control-height-offset, 0px))',
  },
};

const styles = css`
  /* Provide icon sizing context for slotted we-icon children */
  :host([size='xs']) {
    --we-context-icon-size: var(--we-size-xxs);
  }
  :host([size='sm']) {
    --we-context-icon-size: var(--we-size-xs);
  }
  :host([size='md']) {
    --we-context-icon-size: var(--we-size-sm);
  }
  :host([size='lg']) {
    --we-context-icon-size: var(--we-size-md);
  }
  :host([size='xl']) {
    --we-context-icon-size: var(--we-size-lg);
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
    color: var(--we-color-neutral-400);
  }

  /* The reveal toggle sits in the field's own flex row, so it needs no absolute positioning and
     the input's padding does not have to be adjusted to keep text clear of it. */
  [part='reveal'] {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    color: var(--we-color-neutral-500);
    cursor: pointer;
  }

  [part='reveal']:hover {
    color: var(--we-color-neutral-700);
  }

  [part='reveal']:disabled {
    cursor: not-allowed;
    opacity: 0.5;
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
  @property({ type: String, reflect: true }) name = '';
  @property({ type: String, reflect: true }) step = '';
  @property({ type: String, reflect: true }) placeholder = '';
  @property({ type: String, reflect: true }) autocomplete = '';
  @property({ type: Boolean, reflect: true }) autofocus = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) readonly = false;
  @property({ type: String, reflect: true }) type = 'text';
  /**
   * Show a reveal toggle inside the field, for password inputs.
   *
   * The component owns the whole pattern — the icon, the pressed state, the rendered type, and the
   * accessible labelling — because assembling it per form is four chances to get it slightly
   * different, and the one thing every caller wants is the same thing.
   *
   * `type` stays whatever the caller declared: revealing swaps only what is *rendered*, so the
   * declared intent and the DOM never disagree about what this field is.
   */
  @property({ type: Boolean, reflect: true }) revealable = false;
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  /** Reveal is transient UI state, never reflected — a revealed field must not persist as one. */
  @state() private _revealed = false;

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

  handleInput(e: InputEvent) {
    e.stopPropagation();
    this.value = (e.target as HTMLInputElement)?.value;
    this.dispatchEvent(new CustomEvent('input', { detail: this.value, bubbles: true, composed: true }));
  }

  handleChange(e: Event) {
    e.stopPropagation();
    this.value = (e.target as HTMLInputElement)?.value;
    this.dispatchEvent(new CustomEvent('change', { detail: this.value, bubbles: true, composed: true }));
  }

  handleFocus() {
    this.dispatchEvent(new CustomEvent('focus', { bubbles: true, composed: true }));
  }

  handleBlur() {
    this.dispatchEvent(new CustomEvent('blur', { bubbles: true, composed: true }));
  }

  handleKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('keydown', { detail: { key: e.key, code: e.code }, bubbles: true, composed: true }),
    );
  }

  handleBeforeInput(e: InputEvent) {
    e.stopPropagation();
  }

  handlePaste(e: ClipboardEvent) {
    e.stopPropagation();
  }

  private _toggleReveal() {
    this._revealed = !this._revealed;
  }

  /**
   * Keep focus in the field when the toggle is clicked.
   *
   * Without this the button takes focus on mousedown, so revealing mid-typing moves the caret out
   * of the input and the next keystroke goes nowhere.
   */
  private _keepFocus(e: MouseEvent) {
    e.preventDefault();
  }

  render() {
    const inline = this.styles || {};
    return html`
      <div part="base" style=${styleMap(inline)}>
        <slot name="start"></slot>
        <input
          part="input"
          .value=${this.value}
          .type=${this.revealable && this._revealed ? 'text' : this.type}
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
          @beforeinput=${this.handleBeforeInput}
          @paste=${this.handlePaste}
        />
        ${
          this.revealable
            ? html`
                <button
                  part="reveal"
                  type="button"
                  tabindex="-1"
                  ?disabled=${this.disabled}
                  aria-pressed=${this._revealed ? 'true' : 'false'}
                  aria-label=${this._revealed ? 'Hide password' : 'Show password'}
                  @mousedown=${this._keepFocus}
                  @click=${this._toggleReveal}
                >
                  <we-icon name=${this._revealed ? 'eye' : 'eye-slash'}></we-icon>
                </button>
              `
            : nothing
        }
        <slot name="end"></slot>
      </div>
    `;
  }
}
