import { focusSelector, generateTierCSS, joinDeclsCSS, joinStateDeclsCSS, tierRulesCSS } from '@we/design-utils';
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
/**
 * A panel arriving.
 *
 * The content region eases aside to make room for a displacing panel, and the panel appeared at its
 * full width in the first frame of that — the room opening slowly and the thing filling it instantly.
 * It cannot be fixed with a transition: the element did not exist a moment ago, so there is no
 * previous value to interpolate from.
 *
 * And it cannot be fixed by wrapping the frame, which is what `$if`'s own transitions do — a panel
 * whose whole job is to be positioned by the host must not sit inside a box that also positions
 * itself. So the animation is on the frame directly, keyed off the attribute it already carries, and
 * runs once when the element is created. Timed with the inset it is arriving into.
 *
 * `prefers-reduced-motion` turns it off rather than shortening it: this animation exists to soften a
 * change of layout, and to a reader who has asked for less movement it *is* the movement.
 */
const DOCK_CSS = `
@keyframes we-dock-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
[data-we-dock-frame] {
  animation: we-dock-in var(--we-transition-300, 300ms) ease;
}
@media (prefers-reduced-motion: reduce) {
  [data-we-dock-frame] { animation: none; }
}
`;

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
// primitives alike.
//
// Declaration order below is the precedence order: at equal specificity the rule declared later
// wins when several states are true at once, so this reads hover < focus < active < disabled — the
// same order `ELEMENT_STATES` gives the Lit primitives, and the two families must agree because
// `hoverProps` and `focusProps` mean one thing to whoever writes them.
//
// **Focus outranks hover**, and that is the load-bearing half. A state rule declares every property
// in the set and falls back to the *base* value for whatever it does not set, so whichever state
// wins discards the loser's values wholesale — including properties only the loser mentions. With
// hover last, the hover rule's `box-shadow` resolves to base (none) and **takes the focus ring with
// it** for as long as the pointer rests on the focused element. That is the common case, not an
// exotic one: clicking a text field focuses it with the pointer sitting right there.
//
// This used to read focus < hover, on the stated grounds of reproducing the JS merge order
// `useStateProps` computed before this stylesheet existed. That is a description of what the code
// did, not an argument for it, and what it did was drop the ring.
//
// The cost of the choice is real and is the lesser one: a focused element shows its *resting* fill
// rather than its hover fill while the pointer is over it, because focus stays quiet about the
// properties hover sets. Where that matters, `focusProps` restates them — see `we-input`, which is
// where this was found.
function buildInteractiveStateCSS(): string {
  /*
    Both gates share the base declarations.

    An element that varies by breakpoint but has no hover state still has its values moved out of
    the inline style into `--we-ds-*` — that is how a stylesheet gets to pick the winner at all. If
    the base rule named only `[data-we-interactive]`, such an element would have those properties
    declared nowhere and would render with none of them.
  */
  const base = `[data-we-interactive], [data-we-responsive] { ${joinDeclsCSS('--we-ds-', INTERACTIVE_SPECS)} }`;
  const focus = `${focusSelector('[data-we-interactive]')} { ${joinStateDeclsCSS('--we-ds-focus-', '--we-ds-', INTERACTIVE_SPECS)} }`;
  const hover = `[data-we-interactive]:hover { ${joinStateDeclsCSS('--we-ds-hover-', '--we-ds-', INTERACTIVE_SPECS)} }`;
  const active = `[data-we-interactive]:active { ${joinStateDeclsCSS('--we-ds-active-', '--we-ds-', INTERACTIVE_SPECS)} }`;
  // Layout elements have no native :disabled, so disabledProps keys off
  // aria-disabled="true" — the consumer marks the element disabled the accessible
  // way and the styling follows. Declared last so a disabled element's styles win
  // over hover/active at equal specificity.
  const disabled = `[data-we-interactive][aria-disabled='true'] { ${joinStateDeclsCSS('--we-ds-disabled-', '--we-ds-', INTERACTIVE_SPECS)} }`;
  return [base, hover, focus, active, disabled].join('\n');
}

/*
  The breakpoint tiers, from the same PropSpec table as the states above.

  A second axis rather than a second system: `@container` is another condition a stylesheet can
  test, exactly as `:hover` is, so `*UpProps` reuses the whole `--we-ds-*` indirection unchanged.

  Emitted *after* the state rules, and that ordering is a decision. Container queries add no
  specificity, so at equal specificity the later rule wins — which means a tier value beats a hover
  value on the same property when both apply. That is the right way round for the one case where it
  can happen: a hover background is a state everywhere, while a tier is a different layout, and a
  layout that only half-applies is worse than a hover that does.

  The tier rules themselves come first, since they set the variable `*UpProps` never reads but
  `$surface.tier` does — one set of thresholds for the CSS and the schema alike.
*/
function buildResponsiveCSS(): string {
  return [generateTierCSS(), tierRulesCSS('[data-we-responsive]', '--we-ds-', INTERACTIVE_SPECS)].join('\n');
}

/**
 * The state rules alone, for the precedence test.
 *
 * Exported rather than reached through `injectDSInteropStyles`, which needs a document and returns
 * nothing — and the thing under test is the *order* of these rules, which is decided here.
 */
export const buildInteractiveStateCSSForTest = buildInteractiveStateCSS;

/**
 * The DS interop stylesheet — the escape hatch for the handful of CSS features Solid's
 * inline-style-driven DesignSystemProps model can't express directly: pseudo-elements
 * and native :hover/:active/focus. Not a theme: no [data-we-theme] scoping, no
 * color tokens defined here — purely structural, so it's injected once, unconditionally,
 * regardless of which theme is active.
 */
export function injectDSInteropStyles() {
  const css = [BG_IMAGE_CSS, buildInteractiveStateCSS(), buildResponsiveCSS(), KEYFRAMES_CSS, DOCK_CSS].join('\n');
  let styleEl = document.getElementById(STYLE_EL_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_EL_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}
