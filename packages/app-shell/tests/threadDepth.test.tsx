/**
 * A thread, rendered through the real fragment: `discussionSection`, `commentThread`, the renderer
 * and a model that answers a drill-down the way the backend does.
 *
 * The bug this was written for: a reply to a reply appeared nowhere. The unit tests could not see it
 * — they assert about the expansion, and the expansion was right — so this mounts it and watches
 * which queries are issued as rows arrive.
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
import type { SchemaNode } from '@we/schema-shared';
import { RenderSchema, resetSubscriptionPool, subscriptionPoolConfig } from '@we/schema-solid';
import { discussionSection } from '@we/template-kit';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const passthroughAdapter: QueryAdapter = (() => {
  const capabilities: AdapterCapabilities = {
    operators: ['eq', 'ne', 'in', 'nin', 'contains'],
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

interface Reply {
  id: string;
  parent: string;
  editorState: null;
  author: string;
  createdAt: string;
  comments: string[];
}

let dispose: (() => void) | undefined;

beforeEach(() => {
  subscriptionPoolConfig.releaseGraceMs = 0;
  resetSubscriptionPool();
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe('a thread in a panel', () => {
  it('asks each reply for its own replies, and draws them', async () => {
    const replies: Reply[] = [
      { id: 'r1', parent: 'task-1', editorState: null, author: 'did:them', createdAt: '2026-09-01', comments: ['r2'] },
      { id: 'r2', parent: 'r1', editorState: null, author: 'did:them', createdAt: '2026-09-02', comments: [] },
    ];
    /** Every drill-down the thread issues, by the id it asked about. */
    const asked: string[] = [];

    const collections = {
      query: vi.fn((_dataset: unknown, options: { scope?: { anchorId?: string } }) => {
        const anchor = options.scope?.anchorId;
        if (anchor !== undefined) asked.push(anchor);
        return {
          subscribe: () => Promise.resolve(replies.filter((reply) => reply.parent === anchor)),
          dispose: vi.fn(),
        };
      }),
    };
    const empty = { query: vi.fn(() => ({ subscribe: () => Promise.resolve([]), dispose: vi.fn() })) };

    const stores = {
      $getEntity: (name: string) => (name === 'CollectionBlock' ? collections : empty),
      $currentDataset: () => ({ uuid: 'space' }),
      $queryAdapter: passthroughAdapter,
      $me: { did: 'did:me' },
      $sources: hostSourceBag(),
      spaceStore: { mutedDids: [], currentSpace: { id: 'space' } },
      profileStore: { profiles: [] },
      routeStore: { params: {} },
      recordStore: { displays: {} },
    };

    const node: SchemaNode = {
      type: '$each',
      props: { items: [{ id: 'task-1', comments: ['r1'] }], as: 'row' },
      // The subscription the fragment reads for the counts on each reply — the panel's, in the app.
      $queries: { signalTypes: { entity: 'SignalType', subscribe: true } },
      children: [discussionSection({ record: 'row' })],
    };

    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(
      () => <RenderSchema node={node} stores={stores as never} registry={componentRegistry as never} />,
      host,
    );
    await settled();
    await tick();
    await settled();

    // The record's own replies, then that reply's — the second is the one nothing ever asked for.
    expect(asked).toContain('task-1');
    expect(asked).toContain('r1');

    /*
      And it is drawn. `$each` renders its first child and drops the rest, so a row built as a list —
      the reply, then the thread under it — lost every level below the first without a word. Two
      gutters is the cheapest proof a nested level mounted: one belongs to the reply that has a
      reply, the other to the one under it.
    */
    const html = host.innerHTML.replace(/<!--.*?-->/g, '');
    // The rail's column, under the author's face: an `xs` avatar wide, so the line falls under the
    // middle of it and a reply's own face starts where that author's name does.
    expect(html.match(/width: 24px/g) ?? []).not.toHaveLength(0);
    // A branch that can be folded says so, with a caret pointing down while it is open.
    expect(html).toContain('caret-down');
  });

  it("keeps a reply's actions out of the way until the comment is pressed", async () => {
    // A thread is read far more often than it is acted on: a reaction row and a Reply under every
    // reply is a column of furniture between one sentence and the next.
    const replies: Reply[] = [
      { id: 'r1', parent: 'task-1', editorState: null, author: 'did:them', createdAt: '2026-09-01', comments: [] },
    ];
    const collections = {
      query: vi.fn((_dataset: unknown, options: { scope?: { anchorId?: string } }) => ({
        subscribe: () => Promise.resolve(replies.filter((reply) => reply.parent === options.scope?.anchorId)),
        dispose: vi.fn(),
      })),
    };
    const empty = { query: vi.fn(() => ({ subscribe: () => Promise.resolve([]), dispose: vi.fn() })) };
    const stores = {
      $getEntity: (name: string) => (name === 'CollectionBlock' ? collections : empty),
      $currentDataset: () => ({ uuid: 'space' }),
      $queryAdapter: passthroughAdapter,
      $me: { did: 'did:me' },
      $sources: hostSourceBag(),
      spaceStore: { mutedDids: [], currentSpace: { id: 'space' } },
      profileStore: { profiles: [] },
      routeStore: { params: {} },
      recordStore: { displays: {} },
    };

    const node: SchemaNode = {
      type: '$each',
      props: { items: [{ id: 'task-1', comments: ['r1'] }], as: 'row' },
      $queries: { signalTypes: { entity: 'SignalType', subscribe: true } },
      children: [discussionSection({ record: 'row' })],
    };

    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(
      () => <RenderSchema node={node} stores={stores as never} registry={componentRegistry as never} />,
      host,
    );
    await settled();
    await tick();
    await settled();

    // One "Reply" on screen — the record's own, at the foot of the section. The reply has none yet.
    expect(host.textContent?.match(/Reply/g) ?? []).toHaveLength(1);

    const words = host.querySelector('[style*="cursor: pointer"]') as HTMLElement | null;
    expect(words).not.toBeNull();
    words?.click();
    await settled();

    // Pressed: the reply's own Reply appears beside the reactions.
    expect(host.textContent?.match(/Reply/g) ?? []).toHaveLength(2);

    // Pressed again, it goes away — one open at a time, and this was the one.
    words?.click();
    await settled();
    expect(host.textContent?.match(/Reply/g) ?? []).toHaveLength(1);
  });
});
