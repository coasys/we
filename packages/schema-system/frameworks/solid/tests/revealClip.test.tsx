/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * What a `reveal` clips, and for how long.
 *
 * The clip is what makes the effect work — a growing track has to hide the content overflowing it —
 * but it was applied for the element's whole life rather than for the animation's. Anything that
 * paints outside its own box was then cut off permanently: a focus ring, a shadow, a select's
 * dropdown. It surfaced as inputs inside an expandable panel losing their hover ring on one side.
 *
 * The second case here is the other half of the same section: an omitted `exitTransition` mirrors
 * the enter, which the operator documentation always promised and only `$animate` did — so a panel
 * that eased open vanished on close.
 */
import { render, waitFor } from '@solidjs/testing-library';
import { markReactive, type SchemaNode } from '@we/schema-shared';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';

const registry: ComponentRegistry = { Box: (props: any) => <div data-testid="box">{props.children}</div> };

const renderSchema = (node: SchemaNode, stores: Record<string, unknown> = {}) =>
  render(() => <RenderSchema node={node} stores={stores} registry={registry} />);

/** Every inline `overflow` in the rendered tree — the clip lives on the inner wrapper. */
const overflows = (container: HTMLElement) =>
  [...container.querySelectorAll('div')].map((el) => (el as HTMLElement).style.overflow).filter(Boolean);

describe('$if with a reveal', () => {
  it('releases the clip once the section has settled open', async () => {
    const node: SchemaNode = {
      type: '$if',
      props: {
        condition: true,
        enterTransition: { type: 'reveal', duration: 20 },
        then: { type: 'Box' },
      },
    };
    const { container } = renderSchema(node);
    // Starts open, so there is no motion to clip for.
    await waitFor(() => expect(overflows(container)).toEqual([]));
  });

  it('clips while it is opening, and lets go afterwards', async () => {
    const [show, setShow] = createSignal(false);
    const stores = { appStore: { show: markReactive(show) } };
    const node: SchemaNode = {
      type: '$if',
      props: {
        condition: { $store: 'appStore.show' },
        enterTransition: { type: 'reveal', duration: 30 },
        then: { type: 'Box' },
      },
    };
    const { container } = renderSchema(node, stores);

    setShow(true);
    await waitFor(() => expect(container.querySelector('[data-testid="box"]')).toBeTruthy());
    await waitFor(() => expect(overflows(container)).toContain('hidden'));
    // …and released once the track has finished moving.
    await waitFor(() => expect(overflows(container)).toEqual([]), { timeout: 500 });
  });

  it('mirrors the enter transition on the way out, so a section that eased open eases closed', async () => {
    const [show, setShow] = createSignal(true);
    const stores = { appStore: { show: markReactive(show) } };
    const node: SchemaNode = {
      type: '$if',
      props: {
        condition: { $store: 'appStore.show' },
        enterTransition: { type: 'reveal', duration: 60 },
        then: { type: 'Box' },
      },
    };
    const { container } = renderSchema(node, stores);
    expect(container.querySelector('[data-testid="box"]')).toBeTruthy();

    setShow(false);
    // Still mounted immediately after the flip: it is animating out rather than vanishing.
    expect(container.querySelector('[data-testid="box"]')).toBeTruthy();
    await waitFor(() => expect(container.querySelector('[data-testid="box"]')).toBeFalsy(), { timeout: 500 });
  });
});
