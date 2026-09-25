/**
 * The runtime half of the cascade layers: which elements the variant layers match, and that a
 * component's own CSS is inside the base layer.
 *
 * Both fail silently. An element missing `data-we-states` keeps its `hoverProps` in custom properties
 * no rule reads, so hovering it does nothing; a component sheet left outside the layers overrides
 * every breakpoint and state, so they all do nothing on that component. Neither throws, and neither
 * is visible without hovering the right thing at the right width.
 */
import '../primitives/button';
import '../primitives/text';

import type { CSSResult } from 'lit';
import { describe, expect, it } from 'vitest';

import { DS_LAYER_ORDER, STATES_ATTR, TIERS_ATTR } from './helpers';

type DSEl = HTMLElement & Record<string, unknown> & { updateComplete: Promise<unknown> };

async function mount(tag: string, props: Record<string, unknown> = {}): Promise<DSEl> {
  const el = document.createElement(tag) as DSEl;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('which elements the variant layers match', () => {
  it('marks neither on a plain element, so it has nothing to revert', async () => {
    const el = await mount('we-text');
    expect(el.hasAttribute(STATES_ATTR)).toBe(false);
    expect(el.hasAttribute(TIERS_ATTR)).toBe(false);
  });

  it('marks states for a state bag and tiers for a breakpoint bag, independently', async () => {
    const hovered = await mount('we-text', { hoverProps: { bg: 'surface-hover' } });
    expect(hovered.hasAttribute(STATES_ATTR)).toBe(true);
    expect(hovered.hasAttribute(TIERS_ATTR)).toBe(false);

    const responsive = await mount('we-text', { mdUpProps: { display: 'inline' } });
    expect(responsive.hasAttribute(TIERS_ATTR)).toBe(true);
    expect(responsive.hasAttribute(STATES_ATTR)).toBe(false);
  });

  it('counts a state the component itself declares', async () => {
    // Every button variant carries a focus ring in its defaults. Gating on explicit props alone would
    // leave that ring in a variable no rule reads.
    const button = await mount('we-button');
    expect(button.hasAttribute(STATES_ATTR)).toBe(true);
  });

  it('clears the marks when the bags go away', async () => {
    const el = await mount('we-text', { hoverProps: { bg: 'surface-hover' }, smUpProps: { gap: '300' } });
    el.hoverProps = undefined;
    el.smUpProps = undefined;
    await el.updateComplete;
    expect(el.hasAttribute(STATES_ATTR)).toBe(false);
    expect(el.hasAttribute(TIERS_ATTR)).toBe(false);
  });
});

describe("a component's own CSS", () => {
  it('is inside the base layer, behind the layer order', () => {
    const ctor = customElements.get('we-text') as unknown as { elementStyles: CSSResult[] };
    expect(ctor.elementStyles.length).toBeGreaterThan(0);
    for (const style of ctor.elementStyles) {
      expect(style.cssText.startsWith(`${DS_LAYER_ORDER}\n@layer we-base {\n`)).toBe(true);
      expect(style.cssText.trimEnd().endsWith('}')).toBe(true);
    }
  });

  it('keeps the authored text, so a shorthand holding var() survives', () => {
    // Built from source text rather than from parsed rules: CSSOM re-serialisation of a `border` or
    // `background` shorthand with a `var()` in it comes back lossy.
    const ctor = customElements.get('we-text') as unknown as { elementStyles: CSSResult[] };
    expect(ctor.elementStyles.some((style) => style.cssText.includes(":host([truncate]) [part='base']"))).toBe(true);
  });

  it('shares one layered copy of a style several components use', () => {
    const text = customElements.get('we-text') as unknown as { elementStyles: CSSResult[] };
    const button = customElements.get('we-button') as unknown as { elementStyles: CSSResult[] };
    const shared = text.elementStyles.filter((style) => button.elementStyles.includes(style));
    expect(shared.length).toBeGreaterThan(0);
  });
});
