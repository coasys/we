/**
 * Which state wins when two are true at once — and that both design-system families agree.
 *
 * `hoverProps` and `focusProps` mean one thing to whoever writes them, so a Lit primitive and a
 * Solid layout component have to answer "I am hovered *and* focused" the same way. They did not:
 * the Lit generator emitted hover before focus and the Solid interop sheet emitted focus before
 * hover, which at equal specificity is the opposite precedence. Nothing declared that; it fell out
 * of two lists written at different times.
 *
 * The order matters more than it looks, because a state rule declares **every** property in the set
 * and falls back to the base value for whatever it does not set. So the winning state discards the
 * loser's values wholesale, including properties only the loser mentions:
 *
 * - hover last → the hover rule's `box-shadow` resolves to base, and the **focus ring disappears**
 *   while the pointer rests on a focused element. Clicking a text field is exactly that.
 * - focus last → a focused element shows its resting fill rather than its hover fill. Cosmetic, and
 *   fixable at the call site by restating the property in `focusProps` (see `we-input`).
 *
 * Hence focus last, in both families. This test pins the ordering rather than any one component's
 * props: an individual component getting it wrong is a bug in that component, but the two
 * generators disagreeing is a bug nobody can see from either side.
 */
import { describe, expect, it } from 'vitest';

import { getStaticDSStyles } from './helpers';

/** Where each state's rule for `[part='base']` appears, in declaration order. */
function statePositions(css: string): Record<string, number> {
  const lines = css.split('\n');
  const at = (test: (line: string) => boolean) => lines.findIndex((l) => l.includes("[part='base']") && test(l));
  return {
    hover: at((l) => l.includes(':hover')),
    focus: at((l) => l.includes(':focus-visible')),
    active: at((l) => l.includes(':active')),
    disabled: at((l) => l.includes(':disabled,') || l.includes("[aria-disabled='true'] {")),
  };
}

describe('state precedence', () => {
  const css = getStaticDSStyles('input');
  const pos = statePositions(css);

  it('emits every state rule', () => {
    for (const [state, index] of Object.entries(pos)) {
      expect(index, `${state} rule missing`).toBeGreaterThan(-1);
    }
  });

  it('puts focus after hover, so the ring survives the pointer', () => {
    // The whole point. Reversed, hovering a focused field resolves box-shadow to base and the ring
    // vanishes for as long as the pointer is there.
    expect(pos.focus).toBeGreaterThan(pos.hover);
  });

  it('puts active after focus, and disabled last', () => {
    expect(pos.active).toBeGreaterThan(pos.focus);
    expect(pos.disabled).toBeGreaterThan(pos.active);
  });

  it('has every state fall back to the base value for what it does not set', () => {
    // This is the mechanism that makes the ordering consequential, and it is what makes a state
    // "stay quiet about" a property equivalent to "put it back to rest".
    expect(css).toContain('border-color: var(--we-input-focus-border-color, var(--we-input-border-color))');
    expect(css).toContain('border-color: var(--we-input-hover-border-color, var(--we-input-border-color))');
  });
});

describe('we-input, the component that found this', () => {
  const css = getStaticDSStyles('input');

  it('leaves the outline to the instance vars, so focus can restate it', () => {
    // The fix lives in DEFAULT_PROPS (focusProps carries the border), which reaches the DOM as
    // `--we-input-focus-border-*` rather than as CSS. What this asserts is the half that lives
    // here: the focus rule reads those vars at all, so setting them has somewhere to land.
    expect(css).toContain('border-top: var(--we-input-focus-border-top, var(--we-input-border-top))');
  });

  it('feeds the base rule from the same var a component-level transition sets', () => {
    /*
      Why a `transition` prop is not a free choice. The base rule governs the way *out* of a state,
      and its default resolves to `0s` so departures snap — but it reads `--we-input-transition`
      first, which is exactly what setting the prop writes. So one prop meant to slow the arrival
      silently slows the departure too, which is what `we-input` used to do.

      This asserts the mechanism, not the component's current choice: the prop lives in
      DEFAULT_PROPS and never reaches this CSS, so no assertion here could see whether one is set.
    */
    expect(css).toContain(
      'transition: var(--we-input-transition, background-color var(--we-theme-switch-duration, 0s)',
    );
  });
});
