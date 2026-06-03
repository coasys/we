/* eslint-disable @typescript-eslint/no-explicit-any */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import { createRoot, createSignal } from 'solid-js';
import { render as webRender } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal component that renders the resolved `data` prop as JSON text */
const DataDisplay = (props: any) => {
  const value = () => (typeof props.data === 'function' ? props.data() : props.data);
  return <span data-testid="data">{JSON.stringify(value())}</span>;
};

const registry: ComponentRegistry = { DataDisplay };

/** Flush pending micro-tasks (Promise.resolve / queueMicrotask) */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Mock builder factory
// ---------------------------------------------------------------------------

interface MockBuilder {
  subscribe: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  /** Simulate the backend pushing new results to the subscriber */
  push: (results: unknown[]) => void;
}

function createMockBuilder(): MockBuilder {
  let callback: ((results: unknown[]) => void) | null = null;
  const builder: MockBuilder = {
    subscribe: vi.fn((cb: (results: unknown[]) => void) => {
      callback = cb;
      return Promise.resolve([]);
    }),
    dispose: vi.fn(),
    push(results: unknown[]) {
      callback?.(results);
    },
  };
  return builder;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('$query token', () => {
  // ---- Basic subscription lifecycle ----

  it('subscribes and renders initial empty array', async () => {
    const builder = createMockBuilder();
    const MockModel = { query: vi.fn(() => builder), findAll: vi.fn() };
    const stores = {
      spaceStore: { perspective: () => ({ uuid: 'test-perspective' }) },
      $getModel: () => MockModel,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { model: 'Post', subscribe: true } } },
    };

    const { container } = render(() => <RenderSchema node={node} stores={stores} registry={registry} />);

    await tick();

    // Should have called query with the perspective and subscribe
    expect(MockModel.query).toHaveBeenCalledOnce();
    expect(builder.subscribe).toHaveBeenCalledOnce();

    // Initially empty
    const el = container.querySelector('[data-testid="data"]');
    expect(el?.textContent).toBe('[]');
  });

  it('updates when subscription pushes new results', async () => {
    const builder = createMockBuilder();
    const MockModel = { query: vi.fn(() => builder), findAll: vi.fn() };
    const stores = {
      spaceStore: { perspective: () => ({ uuid: 'test-perspective' }) },
      $getModel: () => MockModel,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { model: 'Post', subscribe: true } } },
    };

    const { container } = render(() => <RenderSchema node={node} stores={stores} registry={registry} />);
    await tick();

    // Push data from "backend"
    builder.push([
      { id: 1, title: 'Hello' },
      { id: 2, title: 'World' },
    ]);
    await tick();

    const el = container.querySelector('[data-testid="data"]');
    expect(JSON.parse(el?.textContent ?? '[]')).toEqual([
      { id: 1, title: 'Hello' },
      { id: 2, title: 'World' },
    ]);
  });

  it('disposes builder on cleanup', async () => {
    const builder = createMockBuilder();
    const MockModel = { query: vi.fn(() => builder), findAll: vi.fn() };
    const stores = {
      spaceStore: { perspective: () => ({ uuid: 'test-perspective' }) },
      $getModel: () => MockModel,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { model: 'Post', subscribe: true } } },
    };

    const container = document.createElement('div');
    const dispose = webRender(() => <RenderSchema node={node} stores={stores} registry={registry} />, container);
    await tick();

    expect(builder.subscribe).toHaveBeenCalledOnce();
    expect(builder.dispose).not.toHaveBeenCalled();

    // Trigger cleanup
    dispose();
    expect(builder.dispose).toHaveBeenCalledOnce();
  });

  // ---- Perspective reactivity ----

  it('re-subscribes when perspective changes', async () => {
    const builder1 = createMockBuilder();
    const builder2 = createMockBuilder();
    let callCount = 0;
    const MockModel = {
      query: vi.fn(() => (callCount++ === 0 ? builder1 : builder2)),
      findAll: vi.fn(),
    };

    const [perspective, setPerspective] = createSignal<unknown>({ uuid: 'perspective-1' });
    const stores = {
      spaceStore: { perspective },
      $getModel: () => MockModel,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { model: 'Post', subscribe: true } } },
    };

    let dispose: () => void;
    createRoot((d) => {
      dispose = d;
      const container = document.createElement('div');
      webRender(() => <RenderSchema node={node} stores={stores} registry={registry} />, container);
    });
    await tick();

    expect(builder1.subscribe).toHaveBeenCalledOnce();

    // Switch perspective — should dispose old builder and subscribe new one
    setPerspective({ uuid: 'perspective-2' });
    await tick();

    expect(builder1.dispose).toHaveBeenCalledOnce();
    expect(builder2.subscribe).toHaveBeenCalledOnce();

    dispose!();
  });

  it('returns empty array when perspective is null', async () => {
    const MockModel = { query: vi.fn(), findAll: vi.fn() };
    const stores = {
      spaceStore: { perspective: () => null },
      $getModel: () => MockModel,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { model: 'Post', subscribe: true } } },
    };

    const { container } = render(() => <RenderSchema node={node} stores={stores} registry={registry} />);
    await tick();

    // Should NOT have called query — no perspective
    expect(MockModel.query).not.toHaveBeenCalled();

    const el = container.querySelector('[data-testid="data"]');
    expect(el?.textContent).toBe('[]');
  });

  // ---- Non-subscribe (one-shot) mode ----

  it('uses findAll instead of subscribe when subscribe is false', async () => {
    const MockModel = {
      query: vi.fn(),
      findAll: vi.fn(() => Promise.resolve([{ id: 1 }])),
    };
    const stores = {
      spaceStore: { perspective: () => ({ uuid: 'p1' }) },
      $getModel: () => MockModel,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { model: 'Post', subscribe: false } } },
    };

    const { container } = render(() => <RenderSchema node={node} stores={stores} registry={registry} />);
    await tick();

    expect(MockModel.findAll).toHaveBeenCalledOnce();
    expect(MockModel.query).not.toHaveBeenCalled();

    const el = container.querySelector('[data-testid="data"]');
    expect(JSON.parse(el?.textContent ?? '[]')).toEqual([{ id: 1 }]);
  });

  // ---- Query params forwarding ----

  it('forwards where/order/limit params to query builder', async () => {
    const builder = createMockBuilder();
    const MockModel = { query: vi.fn(() => builder), findAll: vi.fn() };
    const stores = {
      spaceStore: { perspective: () => ({ uuid: 'p1' }) },
      $getModel: () => MockModel,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: {
        data: {
          $query: {
            model: 'Post',
            where: { status: 'published' },
            order: { createdAt: 'desc' },
            limit: 10,
            subscribe: true,
          },
        },
      },
    };

    render(() => <RenderSchema node={node} stores={stores} registry={registry} />);
    await tick();

    expect(MockModel.query).toHaveBeenCalledWith(
      { uuid: 'p1' },
      { where: { status: 'published' }, order: { createdAt: 'desc' }, limit: 10 },
    );
  });

  // ---- Missing $getModel ----

  it('warns and returns empty array when $getModel is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stores = {
      spaceStore: { perspective: () => ({ uuid: 'p1' }) },
      // Note: no $getModel
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { model: 'Post', subscribe: true } } },
    };

    const { container } = render(() => <RenderSchema node={node} stores={stores} registry={registry} />);
    await tick();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('$getModel not found'));

    const el = container.querySelector('[data-testid="data"]');
    expect(el?.textContent).toBe('[]');

    warnSpy.mockRestore();
  });
});
