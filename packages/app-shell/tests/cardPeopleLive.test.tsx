/**
 * A kanban card's faces, rendered through the real board: `taskBoard`, the renderer, the components,
 * the primitives and the host functions, with the involvement rows pushed the way a subscription does.
 *
 * Each case here was a bug somebody saw on the Workshop's kanban and none of the unit tests could:
 * a face that stayed after it was taken off, a reviewer that vanished a second after being added,
 * and a menu row that faded out and back in under a still pointer. They live in how the pieces meet,
 * so this mounts the pieces.
 */
import { hostSourceBag } from '@shared/sources';
import { componentRegistry } from '@solid/registries/componentRegistry';
import {
  type AdapterCapabilities,
  irToFlatQuery,
  planQuery,
  type QueryAdapter,
  type QueryIR,
} from '@we/backend-shared';
import { withPredictions } from '@we/entities';
import { RenderSchema, resetSubscriptionPool, subscriptionPoolConfig } from '@we/schema-solid';
import { taskBoard } from '@we/template-kit';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { liveRows } from './liveRows';
import { SEEDED_INVOLVEMENT_TYPES } from './seededVocabulary';
import { testPredictions } from './support/operations';

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

/** A model whose live query opens on `initial` and can be pushed to afterwards. */
function live(initial: unknown[]) {
  let current = liveRows(initial);
  return {
    model: {
      query: vi.fn(() => (current = liveRows(initial))),
    },
    push: (rows: unknown[]) => current.push(rows),
  };
}

const ME = 'did:me';
const SPACE = { uuid: 'space' };
const assignee = (id: string) => ({ id, agent: ME, kind: 'assignee', node: 't1' });
const reviewer = (id: string) => ({ id, agent: ME, kind: 'reviewer', node: 't1' });

/** The row each kind's press makes: the id the real run will give it, as an operation's ids are. */
const ROW_ID: Record<string, string> = { assignee: 'i1', reviewer: 'i2' };
let presses = 0;

/**
 * A press whose write has returned — `core.setInvolvement` as the host invokes it: its predicted
 * write drawn in every read, and the real run back.
 */
function press(kind: string, on: boolean) {
  const invocation = `press-${++presses}`;
  const id = ROW_ID[kind];
  testPredictions.predict(SPACE, invocation, [
    on
      ? { kind: 'create', entity: 'Involvement', id, fields: { agent: ME, kind, node: 't1' } }
      : { kind: 'delete', entity: 'Involvement', id },
  ]);
  testPredictions.landed(invocation);
}

let dispose: (() => void) | undefined;

beforeEach(() => {
  subscriptionPoolConfig.releaseGraceMs = 0;
  resetSubscriptionPool();
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  testPredictions.clear();
});

/** One board with one column and one task, wired the way `TemplateProvider` wires the host functions. */
async function mountBoard() {
  const column = { id: 'c1', kind: 'column', slug: 'todo', title: 'To do', arranges: [] };
  const boards = {
    query: vi.fn((_dataset: unknown, options: { where?: { kind?: string } }) => ({
      ...liveRows<unknown>(
        options.where?.kind === 'column' ? [column] : [{ id: 'b1', gathers: 'call1', children: [column] }],
      ),
    })),
  };
  const tasks = live([{ id: 't1', title: 'A task', status: 'todo', createdAt: '2026-09-01' }]);
  const involvements = live([]);
  const types = SEEDED_INVOLVEMENT_TYPES;
  const sources = hostSourceBag();
  const state = [{ id: 'todo', slug: 'todo', name: 'To do', semantic: 'open' }];
  const stores = {
    // The reads as the host's bindings hand them over: with what is pending laid over them.
    $getEntity: (name: string) =>
      withPredictions(
        testPredictions,
        name === 'Involvement' ? involvements.model : name === 'TaskBlock' ? tasks.model : boards,
        [name],
      ),
    $currentDataset: () => SPACE,
    $queryAdapter: passthroughAdapter,
    $me: { did: ME },
    $sources: sources,
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

  it('keeps drawing a removal until the rows without it arrive', async () => {
    const board = await mountBoard();
    board.involvements.push([assignee('i1'), reviewer('i2')]);
    await settled();

    press('assignee', false);
    await tick();
    expect(board.rings()).toEqual(['warning']);
    // A page that has not caught up yet is no answer about the removal.
    board.involvements.push([assignee('i1'), reviewer('i2')]);
    await settled();
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
