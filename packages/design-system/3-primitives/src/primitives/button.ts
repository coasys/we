import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import { safeHref } from '../shared/safe-href';
import sharedStyles from '../shared/styles';
import type { ButtonVariant, ComponentSize } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  cursor: 'pointer',
  r: '400',
  ax: 'center',
  ay: 'center',
  // Every variant gets the same keyboard focus ring, including 'bare' — which needs it most,
  // since it is the one variant with no resting appearance to mark it as interactive. It lives
  // in DEFAULT_PROPS rather than per-variant for exactly that reason: a focus indicator is not
  // an emphasis level, and a variant that could opt out of it would be a variant that fails
  // WCAG 2.4.7. Ring colour follows --we-ring-color (the themeable `ringColor` key) rather than
  // a fixed token, matching we-input, so a theme restyles both together and we-form-field's
  // danger-state override reaches buttons nested inside it.
  focusProps: { ring: '0 0 0 2px var(--we-ring-color)' },
  disabledProps: { cursor: 'default', opacity: 'var(--we-theme-disabled-opacity, 0.5)' },
};

const VARIANT_DEFAULTS: Record<ButtonVariant, Partial<DesignSystemProps>> = {
  primary: {
    bg: 'accent',
    color: 'on-accent',
    hoverProps: { bg: 'accent-hover', color: 'on-accent' },
    activeProps: { bg: 'accent-active', color: 'on-accent' },
  },
  /*
    The ladder by mixing, not by two more roles.

    A filled neutral control needs three steps and the vocabulary has a role for the first. Naming
    the other two would mean roles ("secondary button, pressed") nobody would ever pin, and leaving
    them on the scale meant the rest state followed a theme's pin while hover jumped somewhere else.
    Mixing toward `text` gives both, and because `text` inverts with the theme the same expression
    darkens in a light theme and lightens in a dark one. The percentages reproduce the neutral-300
    and neutral-400 that were here to within a point.
  */
  secondary: {
    bg: 'control-surface',
    color: 'text',
    hoverProps: { bg: 'color-mix(in srgb, var(--we-role-control-surface) 88%, var(--we-role-text))', color: 'text' },
    activeProps: { bg: 'color-mix(in srgb, var(--we-role-control-surface) 76%, var(--we-role-text))', color: 'text' },
  },
  ghost: {
    bg: 'transparent',
    color: 'text',
    hoverProps: { bg: 'surface-hover', color: 'text' },
    activeProps: { bg: 'control-surface', color: 'text' },
  },
  /*
    On the `danger` role, which exists now.

    It was on the scale for a long time, with a comment arguing that a status fill had no role and
    that `danger-500` stayed themeable through `dangerHue`. That was true and not enough: it meant a
    theme could restyle the primary button completely and could not say anything about the
    destructive one beyond its hue. Hover and pressed stay on the scale deliberately — they are
    steps *from* the fill, and giving each its own role would add two more things to keep in sync
    for a state nobody themes separately.
  */
  danger: {
    bg: 'danger',
    color: 'on-status',
    hoverProps: { bg: 'danger-700', color: 'on-status' },
    activeProps: { bg: 'danger-800', color: 'on-status' },
  },
  outline: {
    bg: 'transparent',
    color: 'text',
    border: '1px solid var(--we-role-border)',
    hoverProps: { bg: 'surface-hover', color: 'text', border: '1px solid var(--we-role-border-strong)' },
    activeProps: { bg: 'control-surface', color: 'text', border: '1px solid var(--we-role-border-strong)' },
  },
  // The appearance-free member of the scale: button semantics, no chrome. For wrapping arbitrary
  // content in a real <button> — the styling then lives on the wrapped Column/Card, which is
  // already DS-driven, instead of on a hand-rolled div with cursor + onClick.
  //
  // No hoverProps/activeProps is the point, not an omission: ghost's hover background is ghost's
  // whole job, and reusing it for a content wrapper paints a rectangle over content that supplies
  // its own affordance. `color` is deliberately absent too — an unset custom property resolves to
  // `inherit` for inherited properties (see the PropSpec contract in @we/design-utils), so leaving
  // it out inherits, whereas a literal 'inherit' would pointlessly enter the colour-token resolver.
  // `height` and `r` neutralize the size and component defaults; padding, white-space and overflow
  // are not DS props, so they are unset by the :host([variant='bare']) rules below.
  bare: { bg: 'transparent', height: 'auto', r: '0' },
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

  /*
    The gradient overlay, and *only* when there is a gradient.

    The content property is driven by a variable, so the pseudo-element is not generated at all on an
    ordinary button. It used to exist on every button in the app: invisible, since its background
    resolved to none, and still transitioning its opacity from 1 to 0 on every hover. An opacity
    transition is compositor-driven, so each hover promoted the element to its own layer and demoted
    it afterwards, repainting the button's whole area independently of the background change happening
    underneath — two paints of the same region, which reads as the background stepping in, out and in
    again.

    That is a per-hover cost and a per-hover artefact paid by every button for a feature almost none
    of them use.
  */
  [part='base']::before {
    content: var(--we-button-gradient-overlay, none);
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

  /* Square buttons are sized purely by component height — nothing from the padding cascade above
     applies. Still var()-first, for the same reason 'bare' is: see below. */
  :host([square]) [part='base'] {
    padding: var(--we-button-padding, 0);
  }

  /* Two of the things 'bare' has to unset are not DS props, so the variant map cannot carry them:
     white-space: nowrap inherits down into the wrapped content, which is wrong for a wrapper whose
     child does its own wrapping/truncation; and overflow: hidden exists to clip the gradient
     overlay, which 'bare' never has.

     Padding is a third case and not one of those. It is a DS prop — it just cannot ride in the
     variant map either, because button sets nativePadding and owns padding here in CSS. Declaring
     a flat 0 (which is what this was) outranks the cascade above at (0,3,0) vs (0,1,0) and does
     not read the var at all, so every p/px/py on a bare button computed correctly, landed on the
     host, and was then never consulted. Reading the var with 0 as the fallback keeps the default
     identical — the instance var is only set for an explicitly passed padding prop — while
     letting an explicit one through. */
  :host([variant='bare']) {
    white-space: normal;
  }
  :host([variant='bare']) [part='base'] {
    padding: var(--we-button-padding, 0);
    overflow: visible;
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
    // Gradients are a primary-variant affordance; anywhere else the flag is meaningless.
    const hasGradient = this.gradient && this.variant === 'primary';
    this.style.setProperty('--we-button-gradient', hasGradient ? 'var(--we-gradient-primary)' : 'none');
    // Generates the overlay pseudo-element only when it has something to draw — see the note beside
    // `[part='base']::before`. `none` suppresses the box entirely rather than drawing an invisible one.
    this.style.setProperty('--we-button-gradient-overlay', hasGradient ? "''" : 'none');
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

    const href = safeHref(this.href);
    if (href) {
      return html`
        <a
          part="base"
          role="button"
          href=${href}
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
