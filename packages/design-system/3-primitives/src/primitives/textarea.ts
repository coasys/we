import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { TextareaSize } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  px: '300',
  py: '200',
  fontSize: '400',
  bg: 'neutral-75',
  r: '300',
  color: 'neutral-1000',
  hoverProps: { bg: 'neutral-100' },
  focusProps: { bg: 'neutral-100', shadow: '0 0 0 2px var(--we-color-primary-500)' },
};

const SIZE_DEFAULTS: Record<TextareaSize, Partial<DesignSystemProps>> = {
  sm: { px: '200', py: '100', fontSize: '300' },
  md: { px: '300', py: '200', fontSize: '400' },
  lg: { px: '400', py: '300', fontSize: '500' },
};

const styles = css`
  [part='textarea'] {
    width: 100%;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    outline: none;
    padding: 0;
    min-width: 0;
    resize: vertical;
    min-height: 80px;
  }

  [part='textarea']::placeholder {
    color: var(--we-color-neutral-400);
  }
`;

@customElement('we-textarea')
export default class Textarea extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) value = '';
  @property({ type: String, reflect: true }) name = '';
  @property({ type: String, reflect: true }) placeholder = '';
  @property({ type: Number }) rows = 3;
  @property({ type: Number, reflect: true }) maxlength = Infinity;
  @property({ type: Number, reflect: true }) minlength = 0;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) readonly = false;
  @property({ type: String, reflect: true }) resize: 'none' | 'vertical' | 'horizontal' | 'both' = 'vertical';
  @property({ type: String, reflect: true }) size: TextareaSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Textarea & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  focus() {
    this.renderRoot.querySelector('textarea')?.focus();
  }

  handleInput(e: InputEvent) {
    e.stopPropagation();
    this.value = (e.target as HTMLTextAreaElement)?.value;
    this.dispatchEvent(new CustomEvent('input', { detail: this.value, bubbles: true, composed: true }));
  }

  handleChange(e: Event) {
    e.stopPropagation();
    this.value = (e.target as HTMLTextAreaElement)?.value;
    this.dispatchEvent(new CustomEvent('change', { detail: this.value, bubbles: true, composed: true }));
  }

  handleFocus() {
    this.dispatchEvent(new CustomEvent('focus', { bubbles: true, composed: true }));
  }

  handleBlur() {
    this.dispatchEvent(new CustomEvent('blur', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <div part="base" style=${styleMap(this.styles || {})}>
        <slot name="start"></slot>
        <textarea
          part="textarea"
          .value=${this.value}
          rows=${this.rows}
          maxlength=${this.maxlength}
          minlength=${this.minlength}
          placeholder=${this.placeholder}
          style=${styleMap({ resize: this.resize })}
          ?disabled=${this.disabled}
          ?readonly=${this.readonly}
          ?required=${this.required}
          @input=${this.handleInput}
          @change=${this.handleChange}
          @focus=${this.handleFocus}
          @blur=${this.handleBlur}
        ></textarea>
        <slot name="end"></slot>
      </div>
    `;
  }
}
