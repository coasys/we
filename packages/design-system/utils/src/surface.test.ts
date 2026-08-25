import { describe, expect, it } from 'vitest';

import { generateTierCSS, readTier, SURFACE_INNER_ATTR, surfaceStyles, TIER_VAR, tierQuery } from './surface';

describe('surface', () => {
  it('declares a named container, not an anonymous one', () => {
    // Anonymous would bind to the nearest container of any kind — and the call module makes every
    // video tile a size container, so an anonymous query inside a tile would be answered by a 200px
    // cell instead of by the panel.
    expect(surfaceStyles()['container-name']).toBe('we-surface');
    expect(surfaceStyles()['container-type']).toBe('inline-size');
  });

  it('turns a tier into a query against that container', () => {
    expect(tierQuery('md')).toBe('@container we-surface (min-width: 900px)');
  });

  describe('generateTierCSS', () => {
    const css = generateTierCSS();

    it('declares base first, then ascending', () => {
      // Container queries add no specificity, so precedence here is declaration order and nothing
      // else. Out of order, a surface at 1200px would report whichever tier happened to be last.
      const order = ['base', 'sm', 'md', 'lg'].map((tier) => css.indexOf(`${TIER_VAR}: ${tier}`));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(order.every((i) => i >= 0)).toBe(true);
    });

    it('uses a bare attribute selector for every tier, base included', () => {
      // Equal specificity is the other half of the same rule: a base rule written with any extra
      // specificity outranks every tier above it, and the failure only shows between breakpoints.
      const selectors = css.match(/\[data-we-surface-inner\][^{]*\{/g) ?? [];
      expect(selectors.length).toBe(4);
      expect(selectors.every((sel) => sel.trim() === `[${SURFACE_INNER_ATTR}] {`)).toBe(true);
    });

    it('emits one query per threshold and none for base', () => {
      expect(css.match(/@container/g)?.length).toBe(3);
    });
  });

  describe('readTier', () => {
    it('falls back to base when nothing answered', () => {
      // A host that never injected the design-system stylesheet, or an environment with no
      // container-query support. `*UpProps` is inert under exactly those conditions too, so both
      // mechanisms report the same un-adapted layout rather than disagreeing about it.
      expect(readTier(null)).toBe('base');
      expect(readTier(undefined)).toBe('base');
    });

    it('refuses a value that is not a tier', () => {
      const el = {} as unknown as Element;
      const original = globalThis.getComputedStyle;
      globalThis.getComputedStyle = (() => ({ getPropertyValue: () => 'enormous' })) as never;
      expect(readTier(el)).toBe('base');
      globalThis.getComputedStyle = original;
    });
  });
});
