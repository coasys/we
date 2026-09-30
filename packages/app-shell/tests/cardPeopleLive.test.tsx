/**
 * A kanban card's faces, rendered through the real board: `taskBoard`, the renderer, the components,
 * the primitives and the host functions, with the involvement rows pushed the way a subscription does.
 *
 * Each case here was a bug somebody saw on the Workshop's kanban and none of the unit tests could:
 * a face that stayed after it was taken off, a reviewer that vanished a second after being added,
 * and a menu row that faded out and back in under a still pointer. They live in how the pieces meet,
 * so this mounts the pieces.
 */
import { involvementOptimism } from '@shared/involvementOptimism';
import { resolveInvolvementTypes } from '@shared/involvements';
import { hostSourceBag } from '@shared/sources';
import { componentRegistry } from '@solid/registries/componentRegistry';
import {
  type AdapterCapabilities,
  irToFlatQuery,
  planQuery,
  type QueryAdapter,
  type QueryIR,
} from '@we/backend-shared';
import { RenderSchema, resetSubscriptionPool, subscriptionPoolConfig } from '@we/schema-solid';
import { taskBoard } from '@we/template-kit';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no constructable stylesheets, and the primitives adopt one as they connect.
vi.hoisted(() => {
  if (!('adoptedStyleSheets' in ShadowRoot.prototype)) {
    Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', {
      configurable: true,
      get() {
        return (this as { __sheets?: unknown[] }).__sheets ?? [];
      },
      set(sheets: unknown[]) {
        (this as { __sheets?: unknown[] }).__sheets = sheets;
      },
    });
  }
  const sheet = (globalThis as unknown as { CSSStyleSheet: { prototype: { replaceSync?: unknown } } }).CSSStyleSheet;
  if (!sheet.prototype.replaceSync) sheet.prototype.replaceSync = () => {};
});
// @ts-expect-error -- side-effect import: registers the custom elements.
await import('@we/primitives');

/** A backend that can do everything, so the test is about the card rather than about capabilities. */
const passthroughAdapter: QueryAdapter = (() => {
  const capabilities: AdapterCapabilities = {
    operators: ['eq', 'ne', 'in', 'contains'],
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
      const { entity: _entity, ...options } = irToFlatQuery(rest as QueryIR);
      void _entity;
      return scope ? { ...options, scope } : options;
    },
  };
})();

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settled = async () => {
  await tick();
  await tick();
};

/** A model whose subscription answers with `initial` and can be pushed to afterwards. */
function live(initial: unknown[]) {
  let push: (rows: unknown[]) => void = () => {};
  return {
    model: {
      query: vi.fn(() => ({
        subscribe: (callback: (rows: unknown[]) => void) => {
          push = callback;
          return Promise.resolve(initial);
        },
        dispose: vi.fn(),
      })),
    },
    push: (rows: unknown[]) => push(rows),
  };
}

const ME = 'did:me';
const assignee = (id: string) => ({ id, agent: ME, kind: 'assignee', node: 't1' });
const reviewer = (id: string) => ({ id, agent: ME, kind: 'reviewer', node: 't1' });

/** A press whose write has returned — what `setInvolvement` does around a hold. */
function press(kind: string, on: boolean) {
  involvementOptimism.ports.hold('t1', ME, kind, on);
  involvementOptimism.ports.done('t1', ME, kind);
}

let dispose: (() => void) | undefined;

beforeEach(() => {
  subscriptionPoolConfig.releaseGraceMs = 0;
  resetSubscriptionPool();
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  involvementOptimism.reset();
});

/** One board with one column and one task, wired the way `TemplateProvider` wires the host functions. */
async function mountBoard() {
  const column = { id: 'c1', kind: 'column', slug: 'todo', title: 'To do', arranges: [] };
  const boards = {
    query: vi.fn((_dataset: unknown, options: { where?: { kind?: string } }) => ({
      subscribe: () =>
        Promise.resolve(
          options.where?.kind === 'column' ? [column] : [{ id: 'b1', gathers: 'call1', children: [column] }],
        ),
      dispose: vi.fn(),
    })),
  };
  const tasks = live([{ id: 't1', title: 'A task', status: 'todo', createdAt: '2026-09-01' }]);
  const involvements = live([]);
  const types = resolveInvolvementTypes([]);
  const sources = hostSourceBag();
  const state = [{ id: '', slug: 'todo', name: 'To do', semantic: 'open', defined: false }];
  const stores = {
    $getEntity: (name: string) =>
      name === 'Involvement' ? involvements.model : name === 'TaskBlock' ? tasks.model : boards,
    $currentDataset: () => ({ uuid: 'space' }),
    $queryAdapter: passthroughAdapter,
    $me: { did: ME },
    $sources: {
      ...sources,
      arrangedBoard: (options: { involvements?: unknown }) => {
        const view = sources.arrangedBoard({ ...options, pendingInvolvements: involvementOptimism.overlay() });
        queueMicrotask(() => involvementOptimism.settleFromRows(options.involvements));
        return view;
      },
      involvement: (options: { rows?: unknown }) => {
        const view = sources.involvement({ ...options, pending: involvementOptimism.overlay() });
        queueMicrotask(() => involvementOptimism.settleFromRows(options.rows));
        return view;
      },
      involvementMenu: (options: { rows?: unknown }) => {
        const view = sources.involvementMenu({ ...options, pending: involvementOptimism.overlay() });
        queueMicrotask(() => involvementOptimism.settleFromRows(options.rows));
        return view;
      },
    },
    spaceStore: {
      currentSpace: { id: 'space' },
      taskStates: state,
      offeredTaskStates: state,
      involvementTypes: types,
      offeredInvolvementTypes: types,
      members: [{ did: ME, name: 'Me' }],
    },
    profileStore: { profiles: [{ did: ME, name: 'Me' }] },
    routeStore: { params: {} },
    recordStore: { displays: {} },
  };

  const node = taskBoard({ boardId: { $: "'b1'" }, empty: { type: 'we-text', children: ['Empty'] }, people: true });
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(
    () => <RenderSchema node={node} stores={stores as never} registry={componentRegistry as never} />,
    host,
  );
  await settled();
  await tick();

  const card = () => host.querySelector('[data-we-id="t1"]') ?? host;
  const trigger = () => card().querySelector('[aria-label="Who is on this"]');
  /** The faces on the card — not the ones in the hovercards, which are slotted content. */
  const faces = () =>
    [...(trigger()?.querySelectorAll('we-avatar') ?? [])].filter((a) => !a.closest('[slot="content"]'));
  const rings = () => faces().map((face) => (face as unknown as { ringColor: string }).ringColor);
  const menuRows = () => [...card().querySelectorAll('we-menu-item')];

  return { host, involvements, faces, rings, menuRows };
}

describe('faces on a board card', () => {
  it('follows who is on the card as the rows arrive', async () => {
    const board = await mountBoard();
    expect(board.host.textContent).toContain('A task');
    expect(board.faces()).toHaveLength(0);

    press('assignee', true);
    await tick();
    expect(board.faces()).toHaveLength(1);
    board.involvements.push([assignee('i1')]);
    await settled();
    expect(board.faces()).toHaveLength(1);

    // A reviewer stays drawn once its row arrives, rather than showing for a second and going.
    press('reviewer', true);
    await tick();
    board.involvements.push([assignee('i1'), reviewer('i2')]);
    await settled();
    expect(board.rings()).toEqual(['', 'warning']);

    // The assignee taken off beside a reviewer who stays.
    press('assignee', false);
    await tick();
    board.involvements.push([reviewer('i2')]);
    await settled();
    expect(board.rings()).toEqual(['warning']);

    press('reviewer', false);
    await tick();
    board.involvements.push([]);
    await settled();
    expect(board.faces()).toHaveLength(0);
  });

  it('keeps drawing a removal while a surface with no rows yet reports in', async () => {
    // The inspector mounting mid-write read an empty list, released the hold, and the card drew the
    // row the removal had not reached yet.
    const board = await mountBoard();
    board.involvements.push([assignee('i1'), reviewer('i2')]);
    await settled();

    press('assignee', false);
    await tick();
    involvementOptimism.settleFromRows([]);
    await tick();
    expect(board.rings()).toEqual(['warning']);

    board.involvements.push([reviewer('i2')]);
    await settled();
    expect(board.rings()).toEqual(['warning']);
  });

  it('keeps the menu rows and the faces it already drew when the data catches up', async () => {
    // A row replaced under the pointer fades its hover out and in again, and takes a click with it.
    const board = await mountBoard();
    board.involvements.push([assignee('i1')]);
    await settled();
    const rows = board.menuRows();
    const faces = board.faces();

    press('reviewer', true);
    await tick();
    board.involvements.push([assignee('i1'), reviewer('i2')]);
    await settled();

    expect(board.menuRows()).toEqual(rows);
    expect(board.menuRows().every((row, index) => row === rows[index])).toBe(true);
    expect(faces.every((face) => board.faces().includes(face))).toBe(true);
  });
});
