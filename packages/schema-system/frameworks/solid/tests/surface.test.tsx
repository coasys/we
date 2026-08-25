/* eslint-disable @typescript-eslint/no-explicit-any */
import { render } from '@solidjs/testing-library';
import { type SchemaNode, SURFACE_ATTR, SURFACE_INNER_ATTR } from '@we/schema-shared';
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
  it('renders a container box and a layout-free inner box around its children', () => {
    const { container } = renderSchema({ type: '$surface', children: [{ type: 'Box' }] });

    const outer = container.querySelector(`[${SURFACE_ATTR}]`) as HTMLElement;
    const inner = container.querySelector(`[${SURFACE_INNER_ATTR}]`) as HTMLElement;

    expect(outer).toBeTruthy();
    expect(inner).toBeTruthy();
    // The outer box IS the container — an element cannot query itself, which is the whole reason
    // there are two boxes rather than one.
    expect(outer.style.containerName).toBe('we-surface');
    expect(outer.style.containerType).toBe('inline-size');
    // The inner box exists only to be targetable by the tier rules; it must not add a layout box,
    // or dropping a surface into a tree would rearrange what is inside it.
    expect(inner.style.display).toBe('contents');
    expect(inner.querySelector('[data-testid="box"]')).toBeTruthy();
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
