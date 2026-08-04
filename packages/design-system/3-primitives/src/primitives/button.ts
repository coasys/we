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
  ax: 'center',
  ay: 'center',
  disabledProps: { cursor: 'default', opacity: 0.5 },
};

const VARIANT_DEFAULTS: Record<ButtonVariant, Partial<DesignSystemProps>> = {
  primary: {
    bg: 'primary-500',
    color: 'neutral-0',
    hoverProps: { bg: 'primary-600', color: 'neutral-0' },
    activeProps: { bg: 'primary-700', color: 'neutral-0' },
  },
  secondary: {
    bg: 'neutral-200',
    color: 'neutral-800',
    hoverProps: { bg: 'neutral-300', color: 'neutral-900' },
    activeProps: { bg: 'neutral-400', color: 'neutral-900' },
  },
  ghost: {
    bg: 'transparent',
    color: 'neutral-700',
    hoverProps: { bg: 'neutral-100', color: 'neutral-900' },
    activeProps: { bg: 'neutral-200', color: 'neutral-900' },
  },
  danger: {
    bg: 'danger-500',
    color: 'neutral-0',
    hoverProps: { bg: 'danger-600', color: 'neutral-0' },
    activeProps: { bg: 'danger-700', color: 'neutral-0' },
  },
  outline: {
    bg: 'transparent',
    color: 'neutral-700',
    border: '1px solid var(--we-color-neutral-300)',
    hoverProps: { bg: 'neutral-100', color: 'neutral-900', border: '1px solid var(--we-color-neutral-500)' },
    activeProps: { bg: 'neutral-200', color: 'neutral-900', border: '1px solid var(--we-color-neutral-500)' },
  },
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '100', height: 'calc(var(--we-component-height-xs) + var(--we-theme-control-height-offset, 0px))' },
  sm: { fontSize: '200', height: 'calc(var(--we-component-height-sm) + var(--we-theme-control-height-offset, 0px))' },
  md: { fontSize: '300', height: 'calc(var(--we-component-height-md) + var(--we-theme-control-height-offset, 0px))' },
  lg: { fontSize: '500', height: 'calc(var(--we-component-height-lg) + var(--we-theme-control-height-offset, 0px))' },
  xl: { fontSize: '500', height: 'calc(var(--we-component-height-xl) + var(--we-theme-control-height-offset, 0px))' },
};

const CSS_STYLES = css`
  :host {
    --we-button-host-display: inline-flex;
    white-space: nowrap;
  }

  /* Provide icon sizing context and size-specific padding/gap/radius for nested we-icon children */
  :host([size='xs']) {
    --we-context-icon-size: var(--we-size-xxs);
    --we-button-size-radius: var(--we-radius-200);
    --we-button-size-padding-x: var(--we-space-200);
    --we-button-size-gap: var(--we-space-100);
  }
  :host([size='sm']) {
    --we-context-icon-size: var(--we-size-xs);
    --we-button-size-radius: var(--we-radius-300);
    --we-button-size-padding-x: var(--we-space-300);
    --we-button-size-gap: var(--we-space-200);
  }
  :host([size='md']) {
    --we-context-icon-size: var(--we-size-sm);
    --we-button-size-radius: var(--we-radius-400);
    --we-button-size-padding-x: var(--we-space-400);
    --we-button-size-gap: var(--we-space-300);
  }
  :host([size='lg']) {
    --we-context-icon-size: var(--we-size-md);
    --we-button-size-radius: var(--we-radius-400);
    --we-button-size-padding-x: var(--we-space-500);
    --we-button-size-gap: var(--we-space-300);
  }
  :host([size='xl']) {
    --we-context-icon-size: var(--we-size-lg);
    --we-button-size-radius: var(--we-radius-400);
    --we-button-size-padding-x: var(--we-space-500);
    --we-button-size-gap: var(--we-space-300);
  }

  [part='base'] {
    all: unset;
    box-sizing: border-box;
    position: relative;
    overflow: hidden;
    /* Padding cascade: explicit prop (full shorthand) → component theme → group density → size default (x-only) */
    padding: var(
      --we-button-padding,
      0
        var(
          --we-theme-button-padding-x,
          var(--we-theme-control-padding-x, var(--we-button-size-padding-x, var(--we-space-400)))
        )
    );
  }

  [part='base']::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--we-button-gradient, none);
    opacity: 1;
    /* No component-scoped override var here. --we-button-transition was consumed at this one
       site and set nowhere, and it sat in the --we-<component>-<prop> namespace, which the cascade
       reserves for an explicit DS prop on the instance — there is no transition prop for it to
       carry. Its only effect was a hardcoded fallback that opted every button out of the theme's
       animationSpeed setting. Per-component motion overrides are not something the theme layer
       has: animationSpeed is global, and every other theme key is global or group-level. */
    transition: opacity var(--we-transition-200, 150ms);
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

  /* Square buttons are sized purely by component height — suppress all cascade padding */
  :host([square]) [part='base'] {
    padding: 0;
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
      const h = `calc(var(--we-component-height-${this.size}) + var(--we-theme-control-height-offset, 0px))`;
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
