/* eslint-disable @typescript-eslint/no-explicit-any */
import { render } from '@solidjs/testing-library';
import {
  type AdapterCapabilities,
  irToFlatQuery,
  planQuery,
  type QueryAdapter,
  type QueryIR,
  type RendererStores,
} from '@we/backend-shared';
import type { SchemaNode } from '@we/schema-shared';
import { createRoot, createSignal } from 'solid-js';
import { render as webRender } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';

/**
 * A backend that can do everything, so a test can be about the token rather than about capabilities.
 *
 * Every query the renderer issues is compiled to the IR and lowered by the host's own adapter — there
 * is no path around it — so a store bag without one is not a host with fewer features, it is a host
 * whose queries all refuse. That is what {@link asStores} supplies below, and what these tests would
 * otherwise all be asserting instead of what they are about.
 */
const passthroughAdapter: QueryAdapter = (() => {
  const capabilities: AdapterCapabilities = {
    operators: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'contains', 'startsWith', 'endsWith', 'exists'],
    booleanCombinators: true,
    relationFilters: true,
    scope: true,
    include: { supported: true },
    aggregate: ['count'],
    sort: { multiKey: true, byRelationPath: true, byAggregate: true },
    pagination: ['offset'],
    live: 'push',
  };
  return {
    capabilities,
    plan: (ir: QueryIR) => planQuery(ir, capabilities),
    lower: (ir: QueryIR) => {
      const { scope, ...rest } = ir;
      const { entity: _entity, ...opts } = irToFlatQuery(rest as QueryIR);
      void _entity;
      return scope ? { ...opts, scope } : opts;
    },
  };
})();

/**
 * Mocks are deliberately loose (vitest stubs don't structurally match `EntityClass`). The
 * `RendererStores` contract exists to type-check real hosts at the boundary, not test doubles.
 *
 * A bag that names its own `$queryAdapter` keeps it — including as `undefined`, for a test about a
 * host that supplies none.
 *
 * Copied by *descriptor* rather than spread. A bag may declare a binding as a getter so the renderer
 * re-reads it reactively — `get $getEntity()` is how the "backend connects after mount" case is
 * written — and a spread would call that getter once and freeze whatever it answered at copy time.
 */
const asStores = (s: object): RendererStores => {
  const bag = Object.defineProperties({}, Object.getOwnPropertyDescriptors(s)) as Record<string, unknown>;
  if (!('$queryAdapter' in bag)) bag.$queryAdapter = passthroughAdapter;
  return bag as unknown as RendererStores;
};

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
    const MockEntity = { query: vi.fn(() => builder), findAll: vi.fn() };
    const stores = {
      $currentDataset: () => ({ uuid: 'test-perspective' }),
      $getEntity: () => MockEntity,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { entity: 'Post', subscribe: true } } },
    };

    const { container } = render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);

    await tick();

    // Should have called query with the perspective and subscribe
    expect(MockEntity.query).toHaveBeenCalledOnce();
    expect(builder.subscribe).toHaveBeenCalledOnce();

    // Initially empty
    const el = container.querySelector('[data-testid="data"]');
    expect(el?.textContent).toBe('[]');
  });

  it('updates when subscription pushes new results', async () => {
    const builder = createMockBuilder();
    const MockEntity = { query: vi.fn(() => builder), findAll: vi.fn() };
    const stores = {
      $currentDataset: () => ({ uuid: 'test-perspective' }),
      $getEntity: () => MockEntity,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { entity: 'Post', subscribe: true } } },
    };

    const { container } = render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
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
    const MockEntity = { query: vi.fn(() => builder), findAll: vi.fn() };
    const stores = {
      $currentDataset: () => ({ uuid: 'test-perspective' }),
      $getEntity: () => MockEntity,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { entity: 'Post', subscribe: true } } },
    };

    const container = document.createElement('div');
    const dispose = webRender(
      () => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />,
      container,
    );
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
    const MockEntity = {
      query: vi.fn(() => (callCount++ === 0 ? builder1 : builder2)),
      findAll: vi.fn(),
    };

    const [perspective, setPerspective] = createSignal<unknown>({ uuid: 'perspective-1' });
    const stores = {
      $currentDataset: perspective,
      $getEntity: () => MockEntity,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { entity: 'Post', subscribe: true } } },
    };

    let dispose: () => void;
    createRoot((d) => {
      dispose = d;
      const container = document.createElement('div');
      webRender(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />, container);
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
    const MockEntity = { query: vi.fn(), findAll: vi.fn() };
    const stores = {
      $currentDataset: () => null,
      $getEntity: () => MockEntity,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { entity: 'Post', subscribe: true } } },
    };

    const { container } = render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
    await tick();

    // Should NOT have called query — no perspective
    expect(MockEntity.query).not.toHaveBeenCalled();

    const el = container.querySelector('[data-testid="data"]');
    expect(el?.textContent).toBe('[]');
  });

  // ---- Non-subscribe (one-shot) mode ----

  it('uses findAll instead of subscribe when subscribe is false', async () => {
    const MockEntity = {
      query: vi.fn(),
      findAll: vi.fn(() => Promise.resolve([{ id: 1 }])),
    };
    const stores = {
      $currentDataset: () => ({ uuid: 'p1' }),
      $getEntity: () => MockEntity,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { entity: 'Post', subscribe: false } } },
    };

    const { container } = render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
    await tick();

    expect(MockEntity.findAll).toHaveBeenCalledOnce();
    expect(MockEntity.query).not.toHaveBeenCalled();

    const el = container.querySelector('[data-testid="data"]');
    expect(JSON.parse(el?.textContent ?? '[]')).toEqual([{ id: 1 }]);
  });

  // ---- AbortSignal threading + cleanup ----

  it('passes an AbortSignal to findAll and aborts it on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    const MockEntity = {
      query: vi.fn(),
      findAll: vi.fn((_p: unknown, _q: unknown, opts: { signal?: AbortSignal } = {}) => {
        capturedSignal = opts.signal;
        return Promise.resolve([]);
      }),
    };
    const stores = {
      $currentDataset: () => ({ uuid: 'p1' }),
      $getEntity: () => MockEntity,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { entity: 'Post', subscribe: false } } },
    };

    const { unmount } = render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
    await tick();

    expect(MockEntity.findAll).toHaveBeenCalledOnce();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal!.aborted).toBe(false);

    // Unmount should trigger onCleanup, which aborts the controller.
    unmount();
    expect(capturedSignal!.aborted).toBe(true);
  });

  it('aborts a stale findAll when the effect re-runs', async () => {
    const signals: AbortSignal[] = [];
    const MockEntity = {
      query: vi.fn(),
      findAll: vi.fn((_p: unknown, _q: unknown, opts: { signal?: AbortSignal } = {}) => {
        if (opts.signal) signals.push(opts.signal);
        return new Promise<unknown[]>(() => {
          // Never resolve — simulate slow query
        });
      }),
    };
    const [perspective, setPerspective] = createSignal<{ uuid: string } | null>({ uuid: 'p1' });
    const stores = {
      $currentDataset: perspective,
      $getEntity: () => MockEntity,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { entity: 'Post', subscribe: false } } },
    };

    render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
    await tick();
    expect(signals.length).toBe(1);
    expect(signals[0].aborted).toBe(false);

    // Trigger effect re-run by changing the reactive perspective dep.
    setPerspective({ uuid: 'p2' });
    await tick();

    // Old run's controller aborted; new run got its own fresh signal.
    expect(signals[0].aborted).toBe(true);
    expect(signals.length).toBe(2);
    expect(signals[1].aborted).toBe(false);
  });

  it('swallows AbortError from findAll without surfacing it', async () => {
    const MockEntity = {
      query: vi.fn(),
      findAll: vi.fn(() => Promise.reject(new DOMException('Aborted', 'AbortError'))),
    };
    const stores = {
      $currentDataset: () => ({ uuid: 'p1' }),
      $getEntity: () => MockEntity,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { entity: 'Post', subscribe: false } } },
    };

    // If the catch arm doesn't swallow AbortError, the unhandled rejection
    // would surface as a test failure.
    render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
    await tick();
    expect(MockEntity.findAll).toHaveBeenCalledOnce();
  });

  // ---- Query params forwarding ----

  it('forwards where/order/limit params to query builder', async () => {
    const builder = createMockBuilder();
    const MockEntity = { query: vi.fn(() => builder), findAll: vi.fn() };
    const stores = {
      $currentDataset: () => ({ uuid: 'p1' }),
      $getEntity: () => MockEntity,
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: {
        data: {
          $query: {
            entity: 'Post',
            where: { status: 'published' },
            order: { createdAt: 'desc' },
            limit: 10,
            subscribe: true,
          },
        },
      },
    };

    render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
    await tick();

    expect(MockEntity.query).toHaveBeenCalledWith(
      { uuid: 'p1' },
      { where: { status: 'published' }, order: { createdAt: 'desc' }, limit: 10 },
    );
  });

  // ---- Missing $getEntity ----

  it('is quietly empty without $getEntity, then goes live when the binding arrives', async () => {
    // The reload case: the template mounts before the backend's data bindings
    // land. The binding is read reactively inside the query effect, so the
    // subscription must start on its own when $getEntity appears — previously
    // the query was stranded empty until a route change remounted the tree.
    const [getEntitySignal, setGetEntitySignal] = createSignal<((name: string) => unknown) | undefined>(undefined);
    const stores = {
      $currentDataset: () => ({ uuid: 'p1' }),
      get $getEntity() {
        return getEntitySignal();
      },
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { entity: 'Post', subscribe: true } } },
    };

    const { container } = render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
    await tick();

    const el = container.querySelector('[data-testid="data"]');
    expect(el?.textContent).toBe('[]');

    // Backend connects: the binding appears, the query starts unprompted.
    const builder = createMockBuilder();
    const MockEntity = { query: vi.fn(() => builder), findAll: vi.fn() };
    setGetEntitySignal(() => () => MockEntity);
    await tick();
    expect(builder.subscribe).toHaveBeenCalledOnce();

    builder.push([{ id: 'p-1', title: 'Arrived' }]);
    await tick();
    expect(el?.textContent).toContain('Arrived');
  });
});

describe('$queries reading each other', () => {
  /*
    A query's where or scope may read a sibling declared before it. The board reads its pool's anchor
    off the board record — `first(local.board).gathers` — and before this the sibling was undeclared
    at the moment the pool was created, so the anchor resolved to nothing, the scope was dropped, and
    the board drew the whole space. Not reactive either: an undeclared name is not a signal read.
  */
  it('re-runs a later query when the earlier one it reads answers', async () => {
    const boards = createMockBuilder();
    const tasks = createMockBuilder();
    const Board = { query: vi.fn(() => boards), findAll: vi.fn() };
    const Task = { query: vi.fn(() => tasks), findAll: vi.fn() };
    const stores = {
      $currentDataset: () => ({ uuid: 'test-perspective' }),
      $getEntity: (name: string) => (name === 'Board' ? Board : Task),
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      $queries: {
        board: { entity: 'Board', limit: 1 },
        pool: { entity: 'Task', where: { parent: { $: 'first(local.board).gathers' } } },
      },
      props: { data: { $: 'local.pool' } },
    };

    render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
    await tick();

    // Before the board answers, the operand is unresolved and the condition is pruned rather than
    // sent with a hole in it.
    expect(Task.query).toHaveBeenCalledTimes(1);
    expect((Task.query.mock.calls[0] as unknown[])[1]).not.toHaveProperty('where');

    boards.push([{ id: 'b1', gathers: 'call-1' }]);
    await tick();

    // The pool re-ran with the anchor the board carries.
    expect(Task.query).toHaveBeenCalledTimes(2);
    expect((Task.query.mock.calls[1] as unknown[])[1]).toMatchObject({ where: { parent: 'call-1' } });
  });

  it('works whichever of the two is declared first', async () => {
    const boards = createMockBuilder();
    const tasks = createMockBuilder();
    const Board = { query: vi.fn(() => boards), findAll: vi.fn() };
    const Task = { query: vi.fn(() => tasks), findAll: vi.fn() };
    const stores = {
      $currentDataset: () => ({ uuid: 'test-perspective' }),
      $getEntity: (name: string) => (name === 'Board' ? Board : Task),
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      $queries: {
        pool: { entity: 'Task', where: { parent: { $: 'first(local.board).gathers' } } },
        board: { entity: 'Board', limit: 1 },
      },
      props: { data: { $: 'local.pool' } },
    };

    render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
    await tick();
    boards.push([{ id: 'b1', gathers: 'call-1' }]);
    await tick();

    // Every accessor exists before any query's effect first runs, so the order the entries were
    // written in is not a rule an author has to know.
    expect(Task.query).toHaveBeenCalledTimes(2);
    expect((Task.query.mock.calls[1] as unknown[])[1]).toMatchObject({ where: { parent: 'call-1' } });
  });
});

describe('$query when', () => {
  /*
    A query that waits for another's answer. Pruning an unresolved operand widens the query, which is
    right for an optional filter and wrong for a scope that is about to exist — the board's pool ran
    once over the whole space before the board record said what to narrow to. `when` says do not ask
    yet, and `Loaded` stays false so a loading state can hold.
  */
  it('is not asked until the condition is truthy, and is loaded only once it has been', async () => {
    // A board whose first answer has not come back yet: `createMockBuilder` resolves at once with
    // nothing, which would count as answered.
    let pending: ((results: unknown[]) => void) | null = null;
    const boards = {
      subscribe: vi.fn((cb: (results: unknown[]) => void) => {
        pending = cb;
        return new Promise<unknown[]>(() => {});
      }),
      dispose: vi.fn(),
      push: (results: unknown[]) => pending?.(results),
    };
    const tasks = createMockBuilder();
    const Board = { query: vi.fn(() => boards), findAll: vi.fn() };
    const Task = { query: vi.fn(() => tasks), findAll: vi.fn() };
    const stores = {
      $currentDataset: () => ({ uuid: 'test-perspective' }),
      $getEntity: (name: string) => (name === 'Board' ? Board : Task),
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      $queries: {
        board: { entity: 'Board', limit: 1 },
        pool: { entity: 'Task', when: { $: 'local.boardLoaded' } },
      },
      props: { data: { $: '[local.poolLoaded, local.pool]' } },
    };

    const { container } = render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
    await tick();

    // The board has been asked; the pool has not, and says so.
    expect(Board.query).toHaveBeenCalledTimes(1);
    expect(Task.query).not.toHaveBeenCalled();
    const el = () => JSON.parse(container.querySelector('[data-testid="data"]')?.textContent ?? '[]');
    expect(el()).toEqual([false, []]);

    boards.push([{ id: 'b1' }]);
    await tick();
    expect(Task.query).toHaveBeenCalledTimes(1);

    tasks.push([{ id: 't1' }]);
    await tick();
    expect(el()).toEqual([true, [{ id: 't1' }]]);
  });
});

describe('$query over several entities', () => {
  /*
    `entity: ['TaskBlock', 'EventBlock']` — one question over records of more than one kind. Backends
    answer an entity at a time, so the renderer asks each and puts the answers together; these pin
    the parts a template relies on: every row says what it is, nothing shows until every kind has
    answered, the list is ordered and limited as a whole, and "no kinds" is an answer.
  */
  it('combines each entity’s answer, tagged, once every one has answered', async () => {
    let answerTasks: ((rows: unknown[]) => void) | null = null;
    const tasks = {
      subscribe: vi.fn((cb: (rows: unknown[]) => void) => {
        answerTasks = cb;
        return new Promise<unknown[]>(() => {});
      }),
      dispose: vi.fn(),
    };
    const events = createMockBuilder();
    const Task = { query: vi.fn(() => tasks), findAll: vi.fn() };
    const Event = { query: vi.fn(() => events), findAll: vi.fn() };
    const stores = {
      $currentDataset: () => ({ uuid: 'test-perspective' }),
      $getEntity: (name: string) => (name === 'TaskBlock' ? Task : Event),
    };

    const node: SchemaNode = {
      type: 'DataDisplay',
      $queries: {
        found: { entity: ['TaskBlock', 'EventBlock'], order: { at: 'asc' }, limit: 2, subscribe: true },
      },
      props: { data: { $: '[local.foundLoaded, local.found.map(r, [r.id, r.__subjectClass])]' } },
    };

    const { container } = render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
    await tick();
    const el = () => JSON.parse(container.querySelector('[data-testid="data"]')?.textContent ?? '[]');

    // Each entity was asked with the query's own options; the events have answered and the tasks
    // have not, so nothing is shown and nothing claims to be loaded.
    expect(Task.query).toHaveBeenCalledOnce();
    expect((Event.query.mock.calls[0] as unknown[])[1]).toMatchObject({ order: { at: 'asc' }, limit: 2 });
    events.push([{ id: 'e1', at: 2 }]);
    await tick();
    expect(el()).toEqual([false, []]);

    answerTasks!([
      { id: 't1', at: 3 },
      { id: 't2', at: 1 },
    ]);
    await tick();
    expect(el()).toEqual([
      true,
      [
        ['t2', 'TaskBlock'],
        ['e1', 'EventBlock'],
      ],
    ]);

    // A later push from one entity re-combines with the other's last answer.
    events.push([{ id: 'e0', at: 0 }]);
    await tick();
    expect(el()).toEqual([
      true,
      [
        ['e0', 'EventBlock'],
        ['t2', 'TaskBlock'],
      ],
    ]);
  });

  it('answers an empty list as loaded and empty, asking nothing', async () => {
    const getEntity = vi.fn();
    const stores = { $currentDataset: () => ({ uuid: 'p1' }), $getEntity: getEntity };
    const node: SchemaNode = {
      type: 'DataDisplay',
      $localState: { kinds: { type: 'array', initial: [] } },
      $queries: { found: { entity: { $: 'local.kinds' } } },
      props: { data: { $: '[local.foundLoaded, local.found]' } },
    };

    const { container } = render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
    await tick();

    expect(getEntity).not.toHaveBeenCalled();
    expect(JSON.parse(container.querySelector('[data-testid="data"]')?.textContent ?? '[]')).toEqual([true, []]);
  });

  it('keeps the entities it can read when one fails', async () => {
    const onError = vi.fn();
    const Task = { query: vi.fn(), findAll: vi.fn(() => Promise.resolve([{ id: 't1' }])) };
    const Event = { query: vi.fn(), findAll: vi.fn(() => Promise.reject(new Error('no such shape'))) };
    const stores = {
      $currentDataset: () => ({ uuid: 'p1' }),
      $getEntity: (name: string) => (name === 'TaskBlock' ? Task : Event),
      $onError: onError,
    };
    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { entity: ['TaskBlock', 'EventBlock'], subscribe: false } } },
    };

    const { container } = render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
    await tick();

    expect(JSON.parse(container.querySelector('[data-testid="data"]')?.textContent ?? '[]')).toEqual([
      { id: 't1', __subjectClass: 'TaskBlock' },
    ]);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('"EventBlock" failed: no such shape'));
  });

  it('refuses an offset, rather than paging a union wrongly', async () => {
    const onError = vi.fn();
    const Task = { query: vi.fn(), findAll: vi.fn(() => Promise.resolve([])) };
    const stores = { $currentDataset: () => ({ uuid: 'p1' }), $getEntity: () => Task, $onError: onError };
    const node: SchemaNode = {
      type: 'DataDisplay',
      props: { data: { $query: { entity: ['TaskBlock', 'EventBlock'], offset: 20, subscribe: false } } },
    };

    render(() => <RenderSchema node={node} stores={asStores(stores)} registry={registry} />);
    await tick();

    expect(Task.findAll).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('cannot take an offset'));
  });
});
