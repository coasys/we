import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { BadgeVariant, ComponentSize } from '../types';

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
  Two styles of one family — see `BadgeVariant` for why both exist — and the family is the tone.

  `soft` is the tinted panel and the family used *as text*: right for an annotation on something
  else — "Retired", "Not a WE space", "Anna editing". `solid` is the fill and its label measured
  against it: right for a badge that is itself the news, "this call is live".

  A toned badge draws with the accent's roles, which its `tone` has re-pointed at the family, so one
  table serves every family, the palette included. The label is the family's own `on-<family>`,
  corrected at apply time against wherever the fill landed — a yellow fill gets a dark label and a
  red one a light one, in any theme. Pinning white here would fail on the light fills.

  Untoned (or `neutral`) is its own table, because a neutral badge is a quiet chip rather than an
  inverse-surface fill: `control-surface`, not `surface-sunken`, since a sunken row is painted
  `surface-sunken` and a badge in its own background colour disappears — the transcript's `typed`
  mark is where that surfaced. `control-surface` is a step from both.
*/
export const BADGE_VARIANT_DEFAULTS: Record<
  BadgeVariant,
  { neutral: Partial<DesignSystemProps>; toned: Partial<DesignSystemProps> }
> = {
  soft: {
    neutral: { bg: 'control-surface', color: 'text-muted' },
    toned: { bg: 'accent-soft', color: 'accent-text' },
  },
  solid: {
    neutral: { bg: 'control-surface', color: 'text' },
    toned: { bg: 'accent', color: 'on-accent' },
  },
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '100', height: 'calc(var(--we-component-height-xs) + var(--we-theme-control-height-offset, 0px))' },
  sm: { fontSize: '200', height: 'calc(var(--we-component-height-sm) + var(--we-theme-control-height-offset, 0px))' },
  md: { fontSize: '300', height: 'calc(var(--we-component-height-md) + var(--we-theme-control-height-offset, 0px))' },
  lg: { fontSize: '500', height: 'calc(var(--we-component-height-lg) + var(--we-theme-control-height-offset, 0px))' },
  xl: { fontSize: '500', height: 'calc(var(--we-component-height-xl) + var(--we-theme-control-height-offset, 0px))' },
};

/*
  A badge is one atomic word, so it never gives up room and never breaks.

  The same rule `we-timestamp` carries, for the same reason: a flex item's automatic minimum size is
  its content, so a short label is the thing a tight row squeezes — and a wrapped badge is simply
  broken. Consumers were patching this by hand a row at a time.
*/
const styles = css`
  :host {
    --we-badge-host-display: inline-flex;
    flex-shrink: 0;
    white-space: nowrap;
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

  @property({ type: String, reflect: true }) variant: BadgeVariant = 'soft';
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Badge & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const style = BADGE_VARIANT_DEFAULTS[this.variant] ?? BADGE_VARIANT_DEFAULTS.soft;
    const variantDefaults = this.tone && this.tone !== 'neutral' ? style.toned : style.neutral;
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
