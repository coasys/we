/* eslint-disable @typescript-eslint/no-explicit-any */
import { render } from '@solidjs/testing-library';
import { type SchemaNode, SURFACE_ATTR, SURFACE_TIER_ATTR } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';

const registry: ComponentRegistry = {
  Box: (props: any) => <div data-testid="box">{props.children}</div>,
  Label: (props: any) => <div data-testid="label">{props.text}</div>,
};

function renderSchema(node: SchemaNode) {
  return render(() => <RenderSchema node={node} stores={{}} registry={registry} />);
}

describe('$surface', () => {
  it('renders one container box, a tier sentinel, and its children', () => {
    const { container } = renderSchema({ type: '$surface', children: [{ type: 'Box' }] });

    const outer = container.querySelector(`[${SURFACE_ATTR}]`) as HTMLElement;
    const sentinel = container.querySelector(`[${SURFACE_TIER_ATTR}]`) as HTMLElement;

    expect(outer.style.containerName).toBe('we-surface');
    expect(outer.style.containerType).toBe('inline-size');
    // An element cannot query itself, so the tier has to land on something inside. A zero-size
    // out-of-flow box rather than a `display: contents` wrapper, which Firefox declines to evaluate
    // container queries for at all.
    expect(sentinel).toBeTruthy();
    expect(sentinel.style.position).toBe('absolute');
    expect(sentinel.getAttribute('aria-hidden')).toBe('true');
    // Children sit directly in the surface, so dropping one into a tree rearranges nothing.
    expect(outer.querySelector('[data-testid="box"]')).toBeTruthy();
  });

  it('provides $surface to descendants, defaulting to the base tier', () => {
    // No container-query support in the test DOM, so CSS decides nothing and the tier falls back.
    // That fallback is the contract: `*UpProps` is inert under exactly the same conditions, so both
    // mechanisms report the same un-adapted layout rather than disagreeing about it.
    const { container } = renderSchema({
      type: '$surface',
      children: [{ type: 'Label', props: { text: '$surface.tier' } }],
    });

    expect(container.querySelector('[data-testid="label"]')?.textContent).toBe('base');
  });

  it('takes an `as` name, so a nested surface can be addressed separately', () => {
    const { container } = renderSchema({
      type: '$surface',
      props: { as: 'page' },
      children: [
        {
          type: '$surface',
          props: { as: 'pane' },
          children: [
            { type: 'Label', props: { text: '$page.tier' } },
            { type: 'Label', props: { text: '$pane.tier' } },
          ],
        },
      ],
    });

    const labels = [...container.querySelectorAll('[data-testid="label"]')].map((el) => el.textContent);
    expect(labels).toEqual(['base', 'base']);
  });

  it('lets a host override how the surface fills its box', () => {
    const { container } = renderSchema({
      type: '$surface',
      props: { styles: { overflow: 'auto', height: 'auto' } },
      children: [{ type: 'Box' }],
    });

    const outer = container.querySelector(`[${SURFACE_ATTR}]`) as HTMLElement;
    expect(outer.style.overflow).toBe('auto');
    expect(outer.style.height).toBe('auto');
    // …without losing what makes it a surface.
    expect(outer.style.containerName).toBe('we-surface');
  });
});
