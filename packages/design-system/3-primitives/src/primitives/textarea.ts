import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  px: '300',
  py: '200',
  fontSize: '300',
  bg: 'page',
  r: '300',
  color: 'text',
  hoverProps: { bg: 'surface-hover', ring: '0 0 0 2px var(--we-ring-color, var(--we-role-focus))' },
  activeProps: { bg: 'surface-hover', ring: '0 0 0 2px var(--we-ring-color, var(--we-role-focus))' },
  focusProps: { bg: 'surface-hover', ring: '0 0 0 2px var(--we-ring-color, var(--we-role-focus))' },
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { px: '100', py: '100', fontSize: '100' },
  sm: { px: '200', py: '100', fontSize: '200' },
  md: { px: '300', py: '200', fontSize: '300' },
  lg: { px: '400', py: '300', fontSize: '400' },
  xl: { px: '500', py: '400', fontSize: '400' },
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

  [part='textarea'] {
    width: 100%;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    outline: none;
    padding: var(
      --we-textarea-padding,
      var(--we-theme-textarea-padding, var(--we-theme-input-spacing, var(--we-space-200) var(--we-space-300)))
    );
    min-width: 0;
    resize: vertical;
    /*
      A floor of one control's height, not a fixed 80px.

      80px is about three lines, so it silently overrode the rows attribute for any value below the
      default: rows="1" rendered at three rows and looked like the prop was being ignored. The floor
      is still worth having — a zero-row textarea is a hairline — but it belongs at one row, which
      is the smallest thing anybody asks for.
    */
    min-height: var(--we-component-height-md);
  }

  [part='textarea']::placeholder {
    color: var(--we-role-text-faint);
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
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
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
