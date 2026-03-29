import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { TagVariant } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'inline-flex',
  ay: 'center',
  gap: '100',
  px: '200',
  py: '50',
  r: 'pill',
  fontSize: '300',
};

const VARIANT_DEFAULTS: Record<TagVariant, Partial<DesignSystemProps>> = {
  default: { bg: 'neutral-100', color: 'neutral-700' },
  primary: { bg: 'primary-100', color: 'primary-700' },
  success: { bg: 'green-100', color: 'green-700' },
  warning: { bg: 'yellow-100', color: 'yellow-700' },
  danger: { bg: 'red-100', color: 'red-700' },
};

const styles = css`
  [part='dismiss'] {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: var(--we-radius-full);
    width: 16px;
    height: 16px;
    opacity: 0.6;
    transition: opacity 0.15s ease;
  }

  [part='dismiss']:hover {
    opacity: 1;
  }
`;

@customElement('we-tag')
export default class Tag extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) variant: TagVariant = 'default';
  @property({ type: Boolean }) dismissible = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Tag & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const variantDefaults = VARIANT_DEFAULTS[this.variant] ?? {};
    return mergeProps(usedProps, mergeProps(variantDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  private _dismiss() {
    this.dispatchEvent(new CustomEvent('we-dismiss', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <span part="base" style=${styleMap(this.styles || {})}>
        <slot></slot>
        ${this.dismissible
          ? html`<button part="dismiss" aria-label="Dismiss" @click=${this._dismiss}>
              <we-icon name="x" size="12px"></we-icon>
            </button>`
          : nothing}
      </span>
    `;
  }
}
