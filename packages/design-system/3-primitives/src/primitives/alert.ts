import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { AlertVariant } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  ay: 'start',
  gap: '300',
  px: '400',
  py: '300',
  r: 'md',
  fontSize: '400',
};

const VARIANT_DEFAULTS: Record<AlertVariant, Partial<DesignSystemProps>> = {
  info: { bg: 'blue-50', color: 'blue-800' },
  success: { bg: 'green-50', color: 'green-800' },
  warning: { bg: 'yellow-50', color: 'yellow-800' },
  error: { bg: 'red-50', color: 'red-800' },
};

const VARIANT_ICONS: Record<AlertVariant, string> = {
  info: 'info',
  success: 'check-circle',
  warning: 'warning',
  error: 'x-circle',
};

const VARIANT_BORDER: Record<AlertVariant, string> = {
  info: '1px solid var(--we-color-blue-200)',
  success: '1px solid var(--we-color-green-200)',
  warning: '1px solid var(--we-color-yellow-200)',
  error: '1px solid var(--we-color-red-200)',
};

const styles = css`
  [part='dismiss'] {
    all: unset;
    cursor: pointer;
    margin-left: auto;
    opacity: 0.6;
    transition: opacity 0.15s ease;
    flex-shrink: 0;
  }

  [part='dismiss']:hover {
    opacity: 1;
  }

  [part='content'] {
    flex: 1;
  }
`;

@customElement('we-alert')
export default class Alert extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) variant: AlertVariant = 'info';
  @property({ type: Boolean }) dismissible = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Alert & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const variantDefaults = VARIANT_DEFAULTS[this.variant] ?? {};
    return mergeProps(usedProps, mergeProps(variantDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  private _dismiss() {
    this.dispatchEvent(new CustomEvent('we-dismiss', { bubbles: true, composed: true }));
  }

  render() {
    const icon = VARIANT_ICONS[this.variant];
    const border = VARIANT_BORDER[this.variant];

    return html`
      <div part="base" role="alert" style=${styleMap({ border, ...this.styles })}>
        <we-icon name=${icon} size="20px"></we-icon>
        <div part="content"><slot></slot></div>
        ${this.dismissible
          ? html`<button part="dismiss" aria-label="Dismiss" @click=${this._dismiss}>
              <we-icon name="x" size="16px"></we-icon>
            </button>`
          : nothing}
      </div>
    `;
  }
}
