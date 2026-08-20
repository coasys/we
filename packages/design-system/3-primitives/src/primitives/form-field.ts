import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

let formFieldIdCounter = 0;

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  direction: 'column',
  gap: '100',
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '100' },
  sm: { fontSize: '200' },
  md: { fontSize: '300' },
  lg: { fontSize: '400' },
  xl: { fontSize: '400' },
};

/*
  The type ramp, taken from `we-text`'s own variants rather than invented here: a label is
  `label` (200 + medium), and both messages are `footnote` (100).

  All three parts were 300 — `body` — so a field's label rendered at the same size as its help text
  and only colour separated them, and a form-field label rendered a step larger than the
  `we-text variant="label"` sitting beside it in the same view (both spellings are used ~45 times
  each across the templates, frequently in one screen). Matching the semantics settles both.

  Weights are literal numbers here, as everywhere else in these shadow styles; 500 is `medium`.
*/
const styles = css`
  [part='label'] {
    font-size: var(--we-font-size-200);
    font-weight: 500;
    color: var(--we-color-neutral-700);
    cursor: default;
  }

  [part='label'][data-required]::after {
    content: ' *';
    color: var(--we-color-danger-500);
  }

  [part='description'] {
    font-size: var(--we-font-size-100);
    color: var(--we-color-neutral-500);
  }

  /* Footnote-sized like the description, but weighted: it has to carry at the smaller size. */
  [part='error'] {
    font-size: var(--we-font-size-100);
    font-weight: 500;
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
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
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

    /*
      Description above the control, error below it.

      The two are different kinds of message and belong on opposite sides: a description tells you
      how to fill the field in, so it has to be read *before* you do, while an error is a reaction
      to what you already did. They shared one slot once — `error ? error : description` — which
      meant a field carrying both lost its instructions at exactly the moment the reader had got it
      wrong. `aria-describedby` already named both ids, so the markup was the only thing insisting
      they were alternatives.
    */
    return html`
      <div part="base" style=${styleMap(inline)}>
        ${
          this.label
            ? html`<label part="label" id="${this._fieldId}-label" ?data-required=${this.required}
                >${this.label}</label
              >`
            : nothing
        }
        ${this.description ? html`<div part="description" id=${descId!}>${this.description}</div>` : nothing}
        <div
          part="control"
          role="group"
          aria-labelledby=${this.label ? `${this._fieldId}-label` : ''}
          aria-describedby=${describedBy || ''}
          aria-invalid=${this.error ? 'true' : 'false'}
        >
          <slot></slot>
        </div>
        ${this.error ? html`<div part="error" id=${errorId!} role="alert">${this.error}</div>` : nothing}
      </div>
    `;
  }
}
