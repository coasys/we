import type { DesignSystemProps } from '@we/design-types';
import type { Accessor } from 'solid-js';
import { JSX } from 'solid-js';

import {
  buildLayoutStyles as buildLayoutStylesNeutral,
  buildStateFragmentStyles,
  CSS_PROP_TO_VAR_SUFFIX,
  type CSSStyleObject,
  getBgImageAttrs as getBgImageAttrsNeutral,
  type LayoutStyleProps,
  TIER_PROP_KEYS,
  tierKeys,
  toInteractiveVars,
  warnIfUnsurfaced,
} from '../index';

// Re-export neutral pieces consumed unchanged elsewhere (e.g. app-framework's dsInterop
// stylesheet reads INTERACTIVE_SPECS). Keeps `@we/design-utils/solid` a stable surface even
// though the definitions now live in the framework-neutral core.
export { INTERACTIVE_SPECS, TIER_PROP_KEYS, tierKeys, tierRulesCSS } from '../index';
export type { CSSStyleObject } from '../index';

export type MaybeAccessor<T> = T | Accessor<T>;

export function toValue<T>(v: MaybeAccessor<T>): T {
  return typeof v === 'function' ? (v as Accessor<T>)() : v;
}

export type LayoutProps = Omit<DesignSystemProps, 'direction'> & {
  reverse?: boolean;
  styles?: JSX.CSSProperties;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'>;

// Solid binding over the neutral style builder. The computation lives in @we/design-utils's
// core (framework-agnostic, kebab-case output); this wrapper only re-types the result as
// Solid's JSX.CSSProperties so consuming .solid.tsx components keep their exact prior types.
// A React/Vue binding is the same one-liner over the same core function.
export function buildLayoutStyles(props: LayoutProps, direction: 'row' | 'column'): JSX.CSSProperties {
  return buildLayoutStylesNeutral(props as unknown as LayoutStyleProps, direction) as JSX.CSSProperties;
}

export function getBgImageAttrs(
  props: Pick<LayoutProps, 'bgImage' | 'bgImageOpacity'>,
): Record<string, string | undefined> {
  return getBgImageAttrsNeutral(props);
}

// ────────────────────────────────────────────
// State props (hover, active, focus) — Solid accessor binding
//
// The pure fragment/var computation lives in the neutral core (buildStateFragmentStyles,
// toInteractiveVars); this hook is the genuinely Solid-shaped part — it takes a reactive
// baseStyle accessor and returns a reactive `style` thunk plus the gating attribute.
// ────────────────────────────────────────────

export interface StatePropsResult {
  style: () => JSX.CSSProperties;
  attrs: JSX.HTMLAttributes<HTMLDivElement>;
  /** Attach to the element, so an unsurfaced responsive prop can say so in development. */
  checkSurface: (el: Element) => void;
}

/**
 * Variant props — the states, and now the breakpoint tiers.
 *
 * Both are the same mechanism: a partial prop bag that applies under a condition the *stylesheet*
 * can test, so the values move out of the inline style into `--we-ds-*` custom properties and a
 * rule picks the winner. That is why tiers cost almost nothing to add here — `@container` is
 * another condition alongside `:hover`, and the plumbing was already built.
 *
 * The two axes stay independent: a tier sets base values at that width, a state applies at every
 * width. See `DesignSystemProps.mdUpProps` for why they do not cross.
 */
export function useStateProps(
  baseStyle: Accessor<JSX.CSSProperties>,
  props: LayoutProps,
  direction: 'row' | 'column',
): StatePropsResult {
  const bagOf = (key: string) => {
    const bag = (props as Record<string, unknown>)[key] as Partial<DesignSystemProps> | undefined;
    return bag && Object.keys(bag).length > 0 ? bag : undefined;
  };

  const hasHover = () => props.hoverProps && Object.keys(props.hoverProps).length > 0;
  const hasActive = () => props.activeProps && Object.keys(props.activeProps).length > 0;
  const hasFocus = () => props.focusProps && Object.keys(props.focusProps).length > 0;
  const hasDisabled = () => props.disabledProps && Object.keys(props.disabledProps).length > 0;
  const hasState = () => hasHover() || hasActive() || hasFocus() || hasDisabled();
  const hasTier = () => tierKeys.some((key) => bagOf(key) !== undefined);
  const hasAny = () => hasState() || hasTier();

  const attrs: JSX.HTMLAttributes<HTMLDivElement> = {};
  // Two gates, because the stylesheet has two sets of rules and an element with only one kind of
  // variant should not pay for the other. Both share the base declarations — see dsInterop.
  Object.defineProperty(attrs, 'data-we-interactive', {
    get: () => (hasState() ? '' : undefined),
    enumerable: true,
  });
  Object.defineProperty(attrs, 'data-we-responsive', {
    get: () => (hasTier() ? '' : undefined),
    enumerable: true,
  });

  const style = () => {
    const base = baseStyle() as unknown as CSSStyleObject;
    if (!hasAny()) return base as unknown as JSX.CSSProperties;

    // Move every interactive-surface property from a direct inline declaration to a
    // --we-ds-* custom property, so the stylesheet's :hover/:active/:focus-within rules
    // (which fall back through --we-ds-{state}-x -> --we-ds-x -> a safe CSS default) can
    // apply them without JS re-deriving the merged style on every pointer/focus event.
    const withoutInteractiveProps: CSSStyleObject = { ...base };
    for (const cssProp of CSS_PROP_TO_VAR_SUFFIX.keys())
      delete (withoutInteractiveProps as Record<string, unknown>)[cssProp];

    const baseVars = toInteractiveVars('', base);
    // Declaration order below is the precedence order: rules declared later in the
    // stylesheet win for equal-specificity selectors, so :focus-within < :hover < :active
    // here reproduces the same active-over-hover-over-focus precedence the old
    // JS-merge order (focus, then hover, then active) produced.
    const focusVars = hasFocus()
      ? toInteractiveVars('focus-', buildStateFragmentStyles(props.focusProps!, direction))
      : {};
    const hoverVars = hasHover()
      ? toInteractiveVars('hover-', buildStateFragmentStyles(props.hoverProps!, direction))
      : {};
    const activeVars = hasActive()
      ? toInteractiveVars('active-', buildStateFragmentStyles(props.activeProps!, direction))
      : {};
    // Layout elements have no native :disabled — the stylesheet keys the disabled
    // state off aria-disabled="true", which the consumer sets alongside disabledProps.
    const disabledVars = hasDisabled()
      ? toInteractiveVars('disabled-', buildStateFragmentStyles(props.disabledProps!, direction))
      : {};

    /*
      Tier values, as `--we-ds-{tier}-*`.

      Order does not matter here the way it does for the states: these are values, not competing
      declarations, and which one *wins* is decided by the stylesheet's own ascending rules and the
      fallback chain each of them carries. Written unconditionally per tier that has a bag, so an
      element declaring only `lgUpProps` emits only that.
    */
    const tierVars: CSSStyleObject = {};
    for (const [tier, key] of Object.entries(TIER_PROP_KEYS)) {
      const bag = bagOf(key);
      if (bag) Object.assign(tierVars, toInteractiveVars(`${tier}-`, buildStateFragmentStyles(bag, direction)));
    }

    return {
      ...withoutInteractiveProps,
      ...baseVars,
      ...focusVars,
      ...hoverVars,
      ...activeVars,
      ...disabledVars,
      ...tierVars,
    } as unknown as JSX.CSSProperties;
  };

  return { style, attrs, checkSurface: (el: Element) => hasTier() && warnIfUnsurfaced(el, 'This element') };
}
