import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentVariant } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  ay: 'start',
  gap: '300',
  px: '400',
  py: '300',
  r: '400',
  fontSize: '300',
};

const VARIANT_DEFAULTS: Record<ComponentVariant, Partial<DesignSystemProps>> = {
  neutral: { bg: 'neutral-50', color: 'neutral-800' },
  primary: { bg: 'primary-50', color: 'primary-800' },
  success: { bg: 'success-50', color: 'success-800' },
  warning: { bg: 'warning-50', color: 'warning-800' },
  danger: { bg: 'danger-50', color: 'danger-800' },
};

const VARIANT_ICONS: Record<ComponentVariant, string> = {
  neutral: 'info',
  primary: 'info',
  success: 'check-circle',
  warning: 'warning',
  danger: 'x-circle',
};

const VARIANT_BORDER: Record<ComponentVariant, string> = {
  neutral: '1px solid var(--we-color-neutral-200)',
  primary: '1px solid var(--we-color-primary-200)',
  success: '1px solid var(--we-color-success-200)',
  warning: '1px solid var(--we-color-warning-200)',
  danger: '1px solid var(--we-color-danger-200)',
};

const styles = css`
  [part='dismiss'] {
    all: unset;
    cursor: pointer;
    margin-left: auto;
    opacity: 0.6;
    transition: opacity var(--we-transition-200, 150ms) ease;
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

  @property({ type: String, reflect: true }) variant: ComponentVariant = 'primary';
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
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  render() {
    const icon = VARIANT_ICONS[this.variant];
    const border = VARIANT_BORDER[this.variant];

    return html`
      <div part="base" role="alert" style=${styleMap({ border, ...this.styles })}>
        <we-icon name=${icon} size="20px"></we-icon>
        <div part="content"><slot></slot></div>
        ${
          this.dismissible
            ? html`<button part="dismiss" aria-label="Dismiss" @click=${this._dismiss}>
                <we-icon name="x" size="16px"></we-icon>
              </button>`
            : nothing
        }
      </div>
    `;
  }
}
