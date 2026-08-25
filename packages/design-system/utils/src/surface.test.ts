import { describe, expect, it } from 'vitest';

import { INTERACTIVE_SPECS, tierDeclCSS, tierRulesCSS } from './index';
import {
  generateTierCSS,
  readTier,
  SURFACE_TIER_ATTR,
  surfaceStyles,
  TIER_VAR,
  tierQuery,
  tierSentinelStyles,
} from './surface';

describe('surface', () => {
  it('declares a named container, not an anonymous one', () => {
    // Anonymous would bind to the nearest container of any kind — and the call module makes every
    // video tile a size container, so an anonymous query inside a tile would be answered by a 200px
    // cell instead of by the panel.
    expect(surfaceStyles()['container-name']).toBe('we-surface');
    expect(surfaceStyles()['container-type']).toBe('inline-size');
  });

  it('keeps the tier sentinel out of flow and out of sight', () => {
    // Out of flow so it contributes no gap in a flex or grid surface; hidden and zero-size so it
    // paints nothing. Declared inline by its renderer, not by the stylesheet, so a host that never
    // injected the design-system CSS gets no visible empty box.
    expect(tierSentinelStyles().position).toBe('absolute');
    expect(tierSentinelStyles().visibility).toBe('hidden');
    expect(tierSentinelStyles().width).toBe('0');
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
      const selectors = css.match(/\[data-we-surface-tier\][^{]*\{/g) ?? [];
      expect(selectors.length).toBe(4);
      expect(selectors.every((sel) => sel.trim() === `[${SURFACE_TIER_ATTR}] {`)).toBe(true);
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

  describe('tier declarations', () => {
    const spec: [string, string] = ['gap', 'gap'];

    it('falls back down through the tiers beneath it', () => {
      // This chain is what makes a tier *cascade through* rather than replace: something set only
      // in smUpProps still applies at lg, because lg falls back through md and sm on the way down.
      expect(tierDeclCSS('lg', '--we-ds-', spec)).toBe(
        'gap: var(--we-ds-lg-gap, var(--we-ds-md-gap, var(--we-ds-sm-gap, var(--we-ds-gap))));',
      );
      expect(tierDeclCSS('sm', '--we-ds-', spec)).toBe('gap: var(--we-ds-sm-gap, var(--we-ds-gap));');
    });

    it('keeps the spec fallback at the base of the chain', () => {
      // Otherwise a mdUpProps mentioning only `gap` would blank out the component's token default
      // for everything else it did not mention.
      const withFallback: [string, string, string] = ['border-radius', 'radius', 'var(--we-radius-400)'];
      expect(tierDeclCSS('md', '--we-btn-', withFallback)).toContain('var(--we-btn-radius, var(--we-radius-400))');
    });

    it('emits one rule per tier, ascending, against the given target', () => {
      const css = tierRulesCSS('[data-we-responsive]', '--we-ds-', INTERACTIVE_SPECS);
      const order = ['sm', 'md', 'lg'].map((t) => css.indexOf(`(min-width: ${{ sm: 640, md: 900, lg: 1200 }[t]}px)`));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(css.match(/@container we-surface/g)?.length).toBe(3);
    });
  });
});
