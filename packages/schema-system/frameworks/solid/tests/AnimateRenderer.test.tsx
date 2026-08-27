/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, waitFor } from '@solidjs/testing-library';
import { markReactive, type SchemaNode } from '@we/schema-shared';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';

// Helper: render a schema node and return the container
function renderSchema(
  node: SchemaNode | null,
  options: { stores?: Record<string, unknown>; registry?: ComponentRegistry; context?: Record<string, unknown> } = {},
) {
  const { stores = {}, registry = {}, context } = options;
  return render(() => <RenderSchema node={node} stores={stores} registry={registry} context={context} />);
}

describe('$animate with a condition — stays mounted, toggles in place', () => {
  const registry: ComponentRegistry = { Box: (props: any) => <div data-testid="box">{props.children}</div> };

  it('starts open with no flash when the condition is already true', () => {
    const node: SchemaNode = {
      type: '$animate',
      props: { condition: true, enterTransition: { type: 'fade', duration: 200 } },
      children: [{ type: 'Box' }],
    };
    const { container } = renderSchema(node, { registry });
    expect(container.querySelector('[data-testid="box"]')).toBeTruthy();
    expect(container.querySelector('div')?.style.opacity).toBe('1');
  });

  it('starts closed (hidden opacity) with no flash when the condition is already false', () => {
    const node: SchemaNode = {
      type: '$animate',
      props: { condition: false, enterTransition: { type: 'fade', duration: 200 } },
      children: [{ type: 'Box' }],
    };
    const { container } = renderSchema(node, { registry });
    // The child is still mounted — that's the entire point of `condition` over `$if`.
    expect(container.querySelector('[data-testid="box"]')).toBeTruthy();
    expect(container.querySelector('div')?.style.opacity).toBe('0');
  });

  it('animates in when the condition flips true, without ever unmounting the child', async () => {
    const [show, setShow] = createSignal(false);
    const stores = { appStore: { show: markReactive(show) } };
    const node: SchemaNode = {
      type: '$animate',
      props: { condition: { $: 'appStore.show' }, enterTransition: { type: 'fade', duration: 50 } },
      children: [{ type: 'Box' }],
    };
    const { container } = renderSchema(node, { registry, stores });
    const box = container.querySelector('[data-testid="box"]');
    expect(box).toBeTruthy();
    expect(container.querySelector('div')?.style.opacity).toBe('0');

    setShow(true);

    await waitFor(() => expect(container.querySelector('div')?.style.opacity).toBe('1'));
    // Same node reference the whole time — never torn down and rebuilt.
    expect(container.querySelector('[data-testid="box"]')).toBe(box);
  });

  it('animates out when the condition flips false, without ever unmounting the child', async () => {
    const [show, setShow] = createSignal(true);
    const stores = { appStore: { show: markReactive(show) } };
    const node: SchemaNode = {
      type: '$animate',
      props: { condition: { $: 'appStore.show' }, enterTransition: { type: 'fade', duration: 50 } },
      children: [{ type: 'Box' }],
    };
    const { container } = renderSchema(node, { registry, stores });
    const box = container.querySelector('[data-testid="box"]');
    expect(container.querySelector('div')?.style.opacity).toBe('1');

    setShow(false);

    await waitFor(() => expect(container.querySelector('div')?.style.opacity).toBe('0'));
    expect(container.querySelector('[data-testid="box"]')).toBe(box);
  });

  it('falls back to enterTransition for the exit state when no exitTransition is given', async () => {
    const [show, setShow] = createSignal(true);
    const stores = { appStore: { show: markReactive(show) } };
    const node: SchemaNode = {
      type: '$animate',
      props: { condition: { $: 'appStore.show' }, enterTransition: { type: 'fade', duration: 50 } },
      children: [{ type: 'Box' }],
    };
    const { container } = renderSchema(node, { registry, stores });
    setShow(false);
    // Closing uses the fade from `enterTransition` (mirrored) since no `exitTransition` exists —
    // it should still reach the hidden opacity, not stay stuck open.
    await waitFor(() => expect(container.querySelector('div')?.style.opacity).toBe('0'));
  });

  it('starts the reveal grid track closed when the condition starts false', () => {
    const node: SchemaNode = {
      type: '$animate',
      props: { condition: false, enterTransition: { type: 'reveal', duration: 200 } },
      children: [{ type: 'Box' }],
    };
    const { container } = renderSchema(node, { registry });
    const wrapper = container.querySelector('div');
    expect(wrapper?.style.display).toBe('grid');
    expect(wrapper?.style.gridTemplateRows).toBe('0fr');
  });

  it('starts the reveal grid track open when the condition starts true', () => {
    const node: SchemaNode = {
      type: '$animate',
      props: { condition: true, enterTransition: { type: 'reveal', duration: 200 } },
      children: [{ type: 'Box' }],
    };
    const { container } = renderSchema(node, { registry });
    expect(container.querySelector('div')?.style.gridTemplateRows).toBe('1fr');
  });

  it('opens the reveal grid track when the condition flips true', async () => {
    const [open, setOpen] = createSignal(false);
    const stores = { groupStore: { open: markReactive(open) } };
    const node: SchemaNode = {
      type: '$animate',
      props: { condition: { $: 'groupStore.open' }, enterTransition: { type: 'reveal', duration: 50 } },
      children: [{ type: 'Box' }],
    };
    const { container } = renderSchema(node, { registry, stores });
    expect(container.querySelector('div')?.style.gridTemplateRows).toBe('0fr');

    setOpen(true);

    await waitFor(() => expect(container.querySelector('div')?.style.gridTemplateRows).toBe('1fr'));
    // The row list never left the DOM while collapsed — the reveal only ever changed its size.
    expect(container.querySelector('[data-testid="box"]')).toBeTruthy();
  });

  it('disables pointer events while closed under a plain fade (no reveal), restores them open', async () => {
    const [show, setShow] = createSignal(false);
    const stores = { appStore: { show: markReactive(show) } };
    const node: SchemaNode = {
      type: '$animate',
      props: { condition: { $: 'appStore.show' }, enterTransition: { type: 'fade', duration: 50 } },
      children: [{ type: 'Box' }],
    };
    const { container } = renderSchema(node, { registry, stores });
    expect(container.querySelector('div')?.style.pointerEvents).toBe('none');

    setShow(true);

    await waitFor(() => expect(container.querySelector('div')?.style.pointerEvents).toBe('auto'));
  });

  it('leaves pointer events alone for a reveal — a closed track is already unreachable', () => {
    const node: SchemaNode = {
      type: '$animate',
      props: { condition: false, enterTransition: { type: 'reveal', duration: 200 } },
      children: [{ type: 'Box' }],
    };
    const { container } = renderSchema(node, { registry });
    expect(container.querySelector('div')?.style.pointerEvents).toBe('');
  });

  it('leaves pointer events alone entirely without a condition (scroll/mount triggers unaffected)', () => {
    const node: SchemaNode = {
      type: '$animate',
      props: { enterTransition: { type: 'fade', duration: 50 } },
      children: [{ type: 'Box' }],
    };
    const { container } = renderSchema(node, { registry });
    expect(container.querySelector('div')?.style.pointerEvents).toBe('');
  });
});
