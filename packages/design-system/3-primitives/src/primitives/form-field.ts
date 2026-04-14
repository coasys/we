import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { FormFieldSize } from '../types';

let formFieldIdCounter = 0;

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  direction: 'column',
  gap: '100',
};

const SIZE_DEFAULTS: Record<FormFieldSize, Partial<DesignSystemProps>> = {
  sm: { fontSize: '300' },
  md: { fontSize: '400' },
  lg: { fontSize: '500' },
};

const styles = css`
  [part='label'] {
    font-size: var(--we-font-size-300);
    font-weight: 500;
    color: var(--we-color-neutral-700);
    cursor: default;
  }

  [part='label'][data-required]::after {
    content: ' *';
    color: var(--we-color-danger-500);
  }

  [part='description'] {
    font-size: var(--we-font-size-300);
    color: var(--we-color-neutral-500);
  }

  [part='error'] {
    font-size: var(--we-font-size-300);
    color: var(--we-color-danger-500);
  }

  [part='control'] {
    display: flex;
    flex-direction: column;
  }

  :host([error]:not([error=''])) {
    --we-ring-color: var(--we-color-danger-500);
  }
`;

@customElement('we-form-field')
export default class FormField extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  private _fieldId = `we-form-field-${++formFieldIdCounter}`;

  @property({ type: String }) label = '';
  @property({ type: String }) description = '';
  @property({ type: String, reflect: true }) error = '';
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: String, reflect: true }) size: FormFieldSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof FormField & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  render() {
    const inline = this.styles || {};
    const descId = this.description ? `${this._fieldId}-desc` : undefined;
    const errorId = this.error ? `${this._fieldId}-error` : undefined;
    const describedBy = [errorId, descId].filter(Boolean).join(' ') || undefined;

    return html`
      <div part="base" style=${styleMap(inline)}>
        ${this.label
          ? html`<label part="label" id="${this._fieldId}-label" ?data-required=${this.required}>${this.label}</label>`
          : nothing}
        <div
          part="control"
          role="group"
          aria-labelledby=${this.label ? `${this._fieldId}-label` : ''}
          aria-describedby=${describedBy || ''}
          aria-invalid=${this.error ? 'true' : 'false'}
        >
          <slot></slot>
        </div>
        ${this.error
          ? html`<div part="error" id=${errorId!} role="alert">${this.error}</div>`
          : this.description
            ? html`<div part="description" id=${descId!}>${this.description}</div>`
            : nothing}
      </div>
    `;
  }
}
