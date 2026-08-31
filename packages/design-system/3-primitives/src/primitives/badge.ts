import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { BadgeAppearance, ComponentSize, ComponentVariant } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  bg: 'surface-sunken',
  color: 'text-muted',
  fontSize: '300',
  fontWeight: '400',
  r: '400',
  cursor: 'default',
  ax: 'center',
  ay: 'center',
};

/*
  Two appearances of the same five meanings — see `BadgeAppearance` for why both exist.

  `soft` is what the badge has always painted: the tinted panel and the status colour used *as
  text*. It is right for an annotation on something else — "Retired", "Not a WE space", "Anna
  editing" — and wrong for a badge that is itself the news. In a dark theme the tint is a very dark
  green and the text a pale one, which reads as a label about a call rather than as "this call is
  live".

  `solid` is the fill and the label measured against it. The labels are the `on<Fill>` roles rather
  than white, and that is the whole reason this is safe to offer: `LABEL_FOR_FILL` corrects every
  one of them at apply time against wherever the fill actually landed, so a `warning` fill at
  lightness 76 gets a dark label and a `danger` fill at 62 keeps a light one, in any theme. Pinning
  white here — which is what the role file's default value looks like in isolation — would fail on
  the two light fills.

  `neutral` solid is `control-surface`, the filled neutral a count chip already uses, not
  `surface-sunken`: a well is a hole in a surface and a solid badge is a thing sitting on it.
*/
export const BADGE_APPEARANCE_DEFAULTS: Record<
  BadgeAppearance,
  Record<ComponentVariant, Partial<DesignSystemProps>>
> = {
  soft: {
    neutral: { bg: 'surface-sunken', color: 'text-muted' },
    primary: { bg: 'accent-muted', color: 'accent-text' },
    success: { bg: 'success-surface', color: 'success-text' },
    warning: { bg: 'warning-surface', color: 'warning-text' },
    danger: { bg: 'danger-surface', color: 'danger-text' },
  },
  solid: {
    neutral: { bg: 'control-surface', color: 'text' },
    primary: { bg: 'accent', color: 'on-accent' },
    success: { bg: 'success', color: 'on-success' },
    warning: { bg: 'warning', color: 'on-warning' },
    danger: { bg: 'danger', color: 'on-danger' },
  },
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '100', height: 'calc(var(--we-component-height-xs) + var(--we-theme-control-height-offset, 0px))' },
  sm: { fontSize: '200', height: 'calc(var(--we-component-height-sm) + var(--we-theme-control-height-offset, 0px))' },
  md: { fontSize: '300', height: 'calc(var(--we-component-height-md) + var(--we-theme-control-height-offset, 0px))' },
  lg: { fontSize: '500', height: 'calc(var(--we-component-height-lg) + var(--we-theme-control-height-offset, 0px))' },
  xl: { fontSize: '500', height: 'calc(var(--we-component-height-xl) + var(--we-theme-control-height-offset, 0px))' },
};

const styles = css`
  :host {
    --we-badge-host-display: inline-flex;
  }

  /* Provide icon sizing context and size-specific padding/gap for slotted we-icon children */
  :host([size='xs']) {
    --we-context-icon-size: var(--we-size-xxs);
    --we-badge-size-padding-x: var(--we-space-200);
    --we-badge-size-gap: var(--we-space-100);
  }
  :host([size='sm']) {
    --we-context-icon-size: var(--we-size-xs);
    --we-badge-size-padding-x: var(--we-space-300);
    --we-badge-size-gap: var(--we-space-200);
  }
  :host([size='md']) {
    --we-context-icon-size: var(--we-size-sm);
    --we-badge-size-padding-x: var(--we-space-400);
  }
  :host([size='lg']) {
    --we-context-icon-size: var(--we-size-md);
    --we-badge-size-padding-x: var(--we-space-500);
  }
  :host([size='xl']) {
    --we-context-icon-size: var(--we-size-lg);
    --we-badge-size-padding-x: var(--we-space-500);
  }

  [part='base'] {
    /* Padding cascade: explicit prop (full shorthand) → component theme → group density → size default (x-only) */
    padding: var(
      --we-badge-padding,
      0
        var(
          --we-theme-badge-padding-x,
          var(--we-theme-control-padding-x, var(--we-badge-size-padding-x, var(--we-space-400)))
        )
    );
  }
`;

@customElement('we-badge')
export default class Badge extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) variant: ComponentVariant = 'neutral';
  @property({ type: String, reflect: true }) appearance: BadgeAppearance = 'soft';
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Badge & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const appearance = BADGE_APPEARANCE_DEFAULTS[this.appearance] ?? BADGE_APPEARANCE_DEFAULTS.soft;
    const variantDefaults = appearance[this.variant] ?? {};
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(
      usedProps,
      mergeProps(variantDefaults, mergeProps(sizeDefaults, DEFAULT_PROPS)),
    ) as Partial<DesignSystemProps>;
  }

  render() {
    const inline = this.styles || {};
    return html`<span part="base" style=${styleMap(inline)}>
      <slot></slot>
    </span>`;
  }
}
