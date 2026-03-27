import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ButtonSize, ButtonVariant } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  cursor: 'pointer',
  r: 'md',
  px: '400',
  py: '200',
  ax: 'center',
  ay: 'center',
  gap: '300',
  disabledProps: { cursor: 'default', opacity: 0.5 },
};

const VARIANT_DEFAULTS: Record<ButtonVariant, Partial<DesignSystemProps>> = {
  primary: {
    bg: 'primary-500',
    color: 'ui-0',
    hoverProps: { bg: 'primary-600', color: 'ui-0' },
  },
  secondary: {
    bg: 'ui-200',
    color: 'ui-800',
    hoverProps: { bg: 'ui-300', color: 'ui-900' },
  },
  ghost: {
    bg: 'transparent',
    color: 'ui-700',
    hoverProps: { bg: 'ui-100', color: 'ui-900' },
  },
  danger: {
    bg: 'red-500',
    color: 'ui-0',
    hoverProps: { bg: 'red-600', color: 'ui-0' },
  },
  outline: {
    bg: 'transparent',
    color: 'ui-700',
    border: '1px solid var(--we-color-ui-300)',
    hoverProps: { bg: 'ui-50', color: 'ui-900' },
  },
};

const SIZE_DEFAULTS: Record<ButtonSize, Partial<DesignSystemProps>> = {
  xs: { px: '200', py: '100', fontSize: '200' },
  sm: { px: '300', py: '100', fontSize: '300' },
  md: { px: '400', py: '200', fontSize: '400' },
  lg: { px: '500', py: '300', fontSize: '500' },
};

const CSS_STYLES = css`
  :host {
    white-space: nowrap;
  }

  [part='base'] {
    all: unset;
    box-sizing: border-box;
    position: relative;
    overflow: hidden;
  }

  [part='base']::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--we-button-gradient, none);
    opacity: 1;
    transition: opacity var(--we-button-transition, 0.2s);
    pointer-events: none;
  }

  [part='base']:hover:not(:disabled):not([aria-disabled='true'])::before {
    opacity: 0;
  }

  /* Ensure text content sits above the gradient overlay */
  [part='base'] > * {
    position: relative;
    z-index: 1;
  }
`;

@customElement('we-button')
export default class Button extends DesignSystemElement {
  static styles = [sharedStyles, CSS_STYLES];

  @property({ type: String, reflect: true }) variant: ButtonVariant = 'primary';
  @property({ type: String, reflect: true }) size: ButtonSize = 'md';
  @property({ type: String }) text?: string;
  @property({ type: String }) href?: string;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) loading = false;
  @property({ type: Boolean, reflect: true }) gradient = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);
    // Apply gradient CSS variable on the host — only works with primary variant
    this.style.setProperty(
      '--we-button-gradient',
      this.gradient && this.variant === 'primary' ? 'var(--we-gradient-primary)' : 'none',
    );
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Button & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const variantDefaults = VARIANT_DEFAULTS[this.variant] ?? {};
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    // Merge chain: explicit user props > variant > size > component defaults
    return mergeProps(
      usedProps,
      mergeProps(variantDefaults, mergeProps(sizeDefaults, DEFAULT_PROPS)),
    ) as Partial<DesignSystemProps>;
  }

  private _onClick = (e: MouseEvent) => {
    if (this.disabled || this.loading) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    this.dispatchEvent(new CustomEvent('button-click', { detail: e }));
  };

  private _content() {
    return html`
      ${this.loading ? html`<we-spinner size="sm" color="currentColor"></we-spinner>` : null}
      <slot name="start"></slot>
      ${this.text ? html`<span>${this.text}</span>` : html`<slot></slot>`}
      <slot name="end"></slot>
    `;
  }

  render() {
    const inline = this.styles || {};

    if (this.href) {
      return html`
        <a
          part="base"
          role="button"
          href=${this.href}
          aria-disabled=${this.disabled || this.loading ? 'true' : 'false'}
          @click=${this._onClick}
          style=${styleMap(inline)}
        >
          ${this._content()}
        </a>
      `;
    }

    return html`
      <button part="base" ?disabled=${this.disabled || this.loading} @click=${this._onClick} style=${styleMap(inline)}>
        ${this._content()}
      </button>
    `;
  }
}
