/**
 * Which state wins when two are true at once — and that it wins only over what it names.
 *
 * `hoverProps` and `focusProps` mean one thing to whoever writes them, so a Lit primitive and a
 * Solid layout component have to answer "I am hovered *and* focused" in the same order: hover, then
 * focus, then active, then disabled. They did not always; the two generators emitted their lists in
 * different orders, and nothing declared either.
 *
 * On the primitives the order used to matter more than it should have. A state rule declared every
 * property in the set and fell back to the base value for what it did not set, so the winning state
 * discarded the loser's values wholesale — hover last lost the focus ring under the pointer, focus
 * last put a hovered field's fill back to rest. Each state is now its own cascade layer, and a
 * declaration it has no value for reverts to the layer below, so two true states compose property by
 * property. The order only decides a property both of them set.
 *
 * Cascade resolution needs a browser, which a unit test does not have; these pin the shape of the
 * sheet that produces it. `src/cascade.browser.test.ts` checks the computed result.
 */
import { describe, expect, it } from 'vitest';

import { DS_LAYERS, getStaticDSStyles, STATES_ATTR } from './helpers';

describe('state precedence', () => {
  const css = getStaticDSStyles('input');

  it('declares the layers lowest first, with every state above every breakpoint', () => {
    expect(DS_LAYERS).toEqual([
      'we-base',
      'we-tier-sm',
      'we-tier-md',
      'we-tier-lg',
      'we-state-hover',
      'we-state-focus',
      'we-state-active',
      'we-state-disabled',
      'we-overlay',
    ]);
    // The statement opens the sheet, so the order is fixed before anything names a layer.
    expect(css.startsWith(`@layer ${DS_LAYERS.join(', ')};`)).toBe(true);
  });

  it('emits a layer per state', () => {
    for (const state of ['hover', 'focus', 'active', 'disabled']) {
      expect(css, `${state} layer missing`).toContain(`@layer we-state-${state} {`);
    }
  });

  it('has a state name only what it sets, and revert everything else to the layer below', () => {
    // The mechanism that makes two true states compose instead of one erasing the other.
    expect(css).toContain('border-color: var(--we-input-focus-border-color, revert-layer)');
    expect(css).toContain('border-color: var(--we-input-hover-border-color, revert-layer)');
    expect(css).not.toContain('var(--we-input-focus-border-color, var(--we-input-border-color))');
  });

  it('matches state rules only on an element that carries state props', () => {
    const hover = css.split('\n').find((line) => line.startsWith('@layer we-state-hover'));
    expect(hover).toContain(`:host([${STATES_ATTR}]) [part='base']:where(`);
    expect(hover).toContain(`:host([${STATES_ATTR}]:hover)`);
  });
});

describe('we-input, the component that found this', () => {
  const css = getStaticDSStyles('input');

  it('leaves the outline to the instance vars, so focus can set it', () => {
    // `focusProps` carries the border, which reaches the DOM as `--we-input-focus-border-*`. What this
    // asserts is the half that lives here: the focus layer reads those vars at all.
    expect(css).toContain('border-top: var(--we-input-focus-border-top, revert-layer)');
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

  it('keeps how a state arrives in the base layer, for every element', () => {
    // An arrival transition belongs to every element with a hover, not only to ones carrying state
    // props, so it is not gated and does not move into the state layers.
    const base = css.split('\n').find((line) => line.startsWith('@layer we-base'));
    expect(base).toBeDefined();
    expect(css).toContain(
      ":host [part='base']:where([part='base']:hover:not(:disabled):not([aria-disabled='true'])) { transition: var(--we-input-hover-transition,",
    );
    expect(css.indexOf('transition: var(--we-input-hover-transition')).toBeLessThan(css.indexOf('@layer we-tier-sm {'));
  });
});

describe('a state never undoes what a component does on purpose', () => {
  /*
    The bug this pins: a truncated `we-text` unwrapped onto two lines on hover, because the hover rule
    resolved `white-space` to its initial value over `:host([truncate]) [part='base']`. It was held off
    by keeping the state selectors below that rule's specificity. With the states in layers above the
    component's CSS there is no specificity arrangement left to keep — a state that does not set
    `white-space` reverts to the base layer, where the component's rule is.
  */
  const css = getStaticDSStyles('text');
  const stateLines = css.split('\n').filter((line) => line.startsWith('@layer we-state-'));

  it('emits the states for a component that has them', () => {
    expect(stateLines.length).toBe(4);
  });

  it('never gives a state a value it was not asked for', () => {
    // Every declaration in a state layer ends in `revert-layer`; there is no fallback chain to the
    // base value, which is what used to reset the component's own.
    for (const line of stateLines) {
      const declarations = line.match(/[a-z-]+: var\([^;]*\);/g) ?? [];
      expect(declarations.length).toBeGreaterThan(0);
      for (const declaration of declarations) expect(declaration).toMatch(/, revert-layer\);$/);
    }
  });
});
