/**
 * The Solid layout components answer "hovered *and* focused" the same way the Lit primitives do.
 *
 * Both families read the same `INTERACTIVE_SPECS` and the same `focusSelector`, which is what keeps
 * them from drifting on *what* a state prop means. Nothing kept them from drifting on which state
 * *wins*, and they had: the Lit generator emitted hover before focus, this sheet emitted focus
 * before hover. At equal specificity that is the opposite precedence, from two lists written at
 * different times with no shared statement anywhere.
 *
 * Focus last is the choice, because a state rule declares every property and falls back to base for
 * whatever it does not set — so with hover last the hover rule's `box-shadow` resolves to base and
 * takes the focus ring with it while the pointer rests on a focused element. That is the ordinary
 * case of clicking into a text field, not a corner.
 *
 * The mirror of this test lives in `@we/primitives` (`shared/statePrecedence.test.ts`). Two tests
 * rather than one because the two generators are in packages that do not import each other; what
 * they share is the answer, and each side pins its own half of it.
 */
import { describe, expect, it } from 'vitest';

import { buildInteractiveStateCSSForTest } from '../src/frameworks/solid/dsInterop';

/** Where each state's rule appears, in declaration order. */
function statePositions(css: string): Record<string, number> {
  const rules = css.split('\n').filter((l) => l.includes('{'));
  const at = (test: (line: string) => boolean) => rules.findIndex(test);
  return {
    base: at((l) => !l.includes(':') || l.startsWith('[data-we-interactive], [data-we-responsive]')),
    hover: at((l) => l.includes(':hover')),
    focus: at((l) => l.includes(':focus-visible')),
    active: at((l) => l.includes(':active')),
    disabled: at((l) => l.includes("[aria-disabled='true']")),
  };
}

describe('the Solid interop sheet', () => {
  const css = buildInteractiveStateCSSForTest();
  const pos = statePositions(css);

  it('emits every state rule', () => {
    for (const [state, index] of Object.entries(pos)) {
      expect(index, `${state} rule missing`).toBeGreaterThan(-1);
    }
  });

  it('puts focus after hover, so the ring survives the pointer', () => {
    expect(pos.focus).toBeGreaterThan(pos.hover);
  });

  it('agrees with the Lit primitives: base < hover < focus < active < disabled', () => {
    expect(pos.hover).toBeGreaterThan(pos.base);
    expect(pos.active).toBeGreaterThan(pos.focus);
    expect(pos.disabled).toBeGreaterThan(pos.active);
  });

  it('shares the base declarations with the responsive gate', () => {
    // Not about precedence, but it is the other thing this rule's selector list is load-bearing
    // for: an element with only tier props still has its values moved into `--we-ds-*`.
    expect(css).toContain('[data-we-interactive], [data-we-responsive] {');
  });
});
