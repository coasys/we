import { focusSelector, joinDeclsCSS, joinStateDeclsCSS } from '@we/design-utils';
import { INTERACTIVE_SPECS } from '@we/design-utils/solid';

const STYLE_EL_ID = 'we-ds-interop';

// A small keyframes library for `$animate` effect types that can't be expressed as a
// two-state CSS transition (opacity/transform interpolation) — e.g. a looping pulse.
// fade/slide/scale don't need this: they're plain from-state -> to-state animations,
// which transitions already handle natively (see AnimateRenderer/transitionUtils).
const KEYFRAMES_CSS = `
@keyframes we-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.05); }
}
`;

// bg-image translucency overlay for Solid layout primitives (Column/Row/Grid/Card/
// EditableImage). Gated on the data-we-bg-image attribute (see getBgImageAttrs) so
// elements that never set bgImage don't pay for an extra paint layer. z-index: -1 paints
// above the host's own background but below all real in-flow children (CSS painting
// order: a stacking context with negative z-index sits above the host's own background/
// border but below non-positioned in-flow descendants) — no wrapper markup needed.
//
// isolation: isolate is required, not optional: position:relative alone does NOT
// establish a new stacking context (only position + an explicit z-index, or
// isolation, or a few other properties do). Without it, the ::before's z-index: -1
// isn't scoped to "behind this element's own content" — it escapes to compete in
// whatever ancestor stacking context actually exists, which can land it behind a large
// opaque ancestor background several levels up, making it invisible. isolation:isolate
// creates a local stacking context with no other visual side effects (unlike z-index,
// which needs a position value; unlike opacity<1, which visually changes rendering).
const BG_IMAGE_CSS = `
[data-we-bg-image] {
  position: relative;
  isolation: isolate;
}
[data-we-bg-image]::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  pointer-events: none;
  background-image: var(--we-bg-image-composite);
  background-size: var(--we-bg-image-fit, cover);
  background-position: var(--we-bg-image-position, center);
  background-repeat: no-repeat;
}
`;

// Native :hover/:active/focus for Solid layout primitives, generated from the exact same
// PropSpec tables (INTERACTIVE_SPECS) that useStateProps emits --we-ds-* vars for — one
// source of truth, so this stylesheet can never drift out of sync with the JS that populates
// it. The focus selector comes from the shared focusSelector() for the same reason: it is the
// one place that decides what `focusProps` means, for Lit primitives and Solid layout
// primitives alike. Declaration order below is the precedence order: for equal-specificity
// selectors, the rule declared later wins when multiple states are true at once (e.g.
// :hover:active), so focus < :hover < :active reproduces the same active-over-hover-over-focus
// precedence useStateProps used to compute via JS merge order before this stylesheet existed.
function buildInteractiveStateCSS(): string {
  const base = `[data-we-interactive] { ${joinDeclsCSS('--we-ds-', INTERACTIVE_SPECS)} }`;
  const focus = `${focusSelector('[data-we-interactive]')} { ${joinStateDeclsCSS('--we-ds-focus-', '--we-ds-', INTERACTIVE_SPECS)} }`;
  const hover = `[data-we-interactive]:hover { ${joinStateDeclsCSS('--we-ds-hover-', '--we-ds-', INTERACTIVE_SPECS)} }`;
  const active = `[data-we-interactive]:active { ${joinStateDeclsCSS('--we-ds-active-', '--we-ds-', INTERACTIVE_SPECS)} }`;
  // Layout elements have no native :disabled, so disabledProps keys off
  // aria-disabled="true" — the consumer marks the element disabled the accessible
  // way and the styling follows. Declared last so a disabled element's styles win
  // over hover/active at equal specificity.
  const disabled = `[data-we-interactive][aria-disabled='true'] { ${joinStateDeclsCSS('--we-ds-disabled-', '--we-ds-', INTERACTIVE_SPECS)} }`;
  return [base, focus, hover, active, disabled].join('\n');
}

/**
 * The DS interop stylesheet — the escape hatch for the handful of CSS features Solid's
 * inline-style-driven DesignSystemProps model can't express directly: pseudo-elements
 * and native :hover/:active/focus. Not a theme: no [data-we-theme] scoping, no
 * color tokens defined here — purely structural, so it's injected once, unconditionally,
 * regardless of which theme is active.
 */
export function injectDSInteropStyles() {
  const css = [BG_IMAGE_CSS, buildInteractiveStateCSS(), KEYFRAMES_CSS].join('\n');
  let styleEl = document.getElementById(STYLE_EL_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_EL_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}
