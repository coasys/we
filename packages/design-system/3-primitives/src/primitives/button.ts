import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ButtonVariant, ComponentSize } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  cursor: 'pointer',
  r: '400',
  px: '400',
  ax: 'center',
  ay: 'center',
  gap: '300',
  disabledProps: { cursor: 'default', opacity: 0.5 },
};

const VARIANT_DEFAULTS: Record<ButtonVariant, Partial<DesignSystemProps>> = {
  primary: {
    bg: 'primary-500',
    color: 'neutral-0',
    hoverProps: { bg: 'primary-600', color: 'neutral-0' },
  },
  secondary: {
    bg: 'neutral-200',
    color: 'neutral-800',
    hoverProps: { bg: 'neutral-300', color: 'neutral-900' },
  },
  ghost: {
    bg: 'transparent',
    color: 'neutral-700',
    hoverProps: { bg: 'neutral-100', color: 'neutral-900' },
  },
  danger: {
    bg: 'danger-500',
    color: 'neutral-0',
    hoverProps: { bg: 'danger-600', color: 'neutral-0' },
  },
  outline: {
    bg: 'transparent',
    color: 'neutral-700',
    border: '1px solid var(--we-color-neutral-300)',
    hoverProps: { bg: 'neutral-50', color: 'neutral-900' },
  },
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { px: '200', fontSize: '200', height: 'var(--we-component-height-xs)' },
  sm: { px: '300', fontSize: '300', height: 'var(--we-component-height-sm)' },
  md: { px: '400', fontSize: '400', height: 'var(--we-component-height-md)' },
  lg: { px: '500', fontSize: '500', height: 'var(--we-component-height-lg)' },
  xl: { px: '600', fontSize: '500', height: 'var(--we-component-height-xl)' },
};

const CSS_STYLES = css`
  :host {
    --we-button-host-display: inline-flex;
    white-space: nowrap;
  }

  /* Provide icon sizing context for nested we-icon children */
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

  /* Icons inside buttons are decorative — pass pointer events through to the button */
  ::slotted(we-icon) {
    pointer-events: none;
  }
`;

@customElement('we-button')
export default class Button extends DesignSystemElement {
  static styles = [sharedStyles, CSS_STYLES];

  @property({ type: String, reflect: true }) variant: ButtonVariant = 'primary';
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: String }) text?: string;
  @property({ type: String }) href?: string;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) loading = false;
  @property({ type: Boolean, reflect: true }) gradient = false;
  @property({ type: Boolean, reflect: true }) square = false;
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
    const props = mergeProps(
      usedProps,
      mergeProps(variantDefaults, mergeProps(sizeDefaults, DEFAULT_PROPS)),
    ) as Partial<DesignSystemProps>;

    if (this.square) {
      const h = `var(--we-component-height-${this.size})`;
      props.width = h;
      props.height = h;
      delete props.px;
      delete props.py;
    }

    return props;
  }

  private _onClick = (e: MouseEvent) => {
    if (this.disabled || this.loading) {
      e.preventDefault();
      e.stopPropagation();
    }
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
