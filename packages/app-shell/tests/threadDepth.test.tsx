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
    // A thread asks each level about every parent on it at once, so an adapter that cannot do that
    // is refused rather than quietly asked about one of them — which is what happens here without
    // this line, and is how the capability gate is meant to behave.
    boundedTraversal: { multiAnchor: true, transitive: true, inbound: true, perAnchorLimit: true, levelWalk: true },
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
  it('reads the whole thread in one walked query, and draws every level', async () => {
    const replies: Reply[] = [
      { id: 'r1', parent: 'task-1', editorState: null, author: 'did:them', createdAt: '2026-09-01', comments: ['r2'] },
      { id: 'r2', parent: 'r1', editorState: null, author: 'did:them', createdAt: '2026-09-02', comments: [] },
    ];
    /** Every drill-down the thread issues: its anchors, and the per-depth limits it asked for. */
    const asked: { anchors: string[]; levels?: number[] }[] = [];

    /** Everything under `anchors`, to any depth — what a walked read answers with. */
    const descendantsOf = (anchors: string[]): Reply[] => {
      const out: Reply[] = [];
      let frontier = anchors;
      while (frontier.length) {
        const next = replies.filter((r) => frontier.includes(r.parent) && !out.includes(r));
        out.push(...next);
        frontier = next.map((r) => r.id);
      }
      return out;
    };

    const collections = {
      query: vi.fn((_dataset: unknown, options: { scope?: { anchorId?: string | string[]; levels?: number[] } }) => {
        const anchor = options.scope?.anchorId;
        const anchors = anchor === undefined ? [] : Array.isArray(anchor) ? anchor : [anchor];
        const levels = options.scope?.levels;
        if (anchor !== undefined) asked.push({ anchors, levels });
        // A walked query answers with the bounded subtree; without levels, a single step.
        const rows = levels ? descendantsOf(anchors) : replies.filter((r) => anchors.includes(r.parent));
        return {
          // Flat either way, so each row says whose reply it is — which is what the renderer puts
          // the tree back together from.
          subscribe: () => Promise.resolve(rows.map((reply) => ({ ...reply, inReplyTo: { id: reply.parent } }))),
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
    // Three rounds, one per level: each level's anchors are the level above's answer, so the chain
    // settles a level at a time rather than all at once.
    await settled();
    await tick();
    await settled();
    await tick();
    await settled();
    await tick();
    await settled();

    /*
      ONE question for the whole conversation.

      This has been wrong in two different directions. It began as a query per *reply*, so a level
      cost a subscription per row and the level below cost one per row of that. Hoisting it to a
      query per *level* fixed the count and left the latency: each level anchors on the ids the one
      above returns, so three levels are three sequential round trips and the thread unfolds instead
      of appearing. A transitive read is one round trip whatever the depth.
    */
    expect(asked).toHaveLength(1);
    expect(asked[0].anchors).toEqual(['task-1']);
    // Bounded at every depth rather than by a cap on the total — and trimmed to the drawn depth,
    // since a level nobody renders is a level nobody should pay for.
    expect(asked[0].levels).toEqual([10, 5, 3]);

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
    /*
      And an open comment says it can be folded — with the rule down its gutter, not with a caret.

      The caret is gone: it said "this folds" at rest and said it twice, since a folded comment's
      stub carries a `caret-right` already. The rule is the open state, and what the caret was doing
      for discoverability the hover does instead. So the mark to look for is the line's own fill.
    */
    expect(html).toContain('background-color: var(--we-role-border)');
  });

  /**
   * A caller's own limits reach the backend as the walk's shape.
   *
   * There is no second query strategy to choose between any more: the backend walks the levels, so
   * asking for different breadth at each depth changes one argument rather than the number of
   * questions.
   */
  it('passes a caller’s own per-depth limits to the backend', async () => {
    const asked: { levels?: number[] }[] = [];
    const collections = {
      query: vi.fn((_dataset: unknown, options: { scope?: { levels?: number[] } }) => {
        if (options.scope) asked.push({ levels: options.scope.levels });
        return { subscribe: () => Promise.resolve([]), dispose: vi.fn() };
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
      props: { items: [{ id: 'task-1', comments: [] }], as: 'row' },
      $queries: { signalTypes: { entity: 'SignalType', subscribe: true } },
      children: [discussionSection({ record: 'row', perLevel: [4, 2] })],
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

    expect(asked).toHaveLength(1);
    expect(asked[0].levels).toEqual([4, 2]);
  });

  it("keeps a reply's actions out of the way until the comment is pressed", async () => {
    // A thread is read far more often than it is acted on: a reaction row and a Reply under every
    // reply is a column of furniture between one sentence and the next.
    const replies: Reply[] = [
      { id: 'r1', parent: 'task-1', editorState: null, author: 'did:them', createdAt: '2026-09-01', comments: [] },
    ];
    const collections = {
      query: vi.fn((_dataset: unknown, options: { scope?: { anchorId?: string } }) => ({
        // `inReplyTo` is how the thread finds a row's place: one flat answer, each row naming its
        // parent. A fixture without it renders nothing, whatever rows it returns.
        subscribe: () =>
          Promise.resolve(
            replies
              .filter((reply) => reply.parent === options.scope?.anchorId)
              .map((reply) => ({ ...reply, inReplyTo: { id: reply.parent } })),
          ),
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

    /*
      No "Reply" anywhere yet.

      It used to be one — the record's own, at the foot of the section — and that button is now the
      composer's icon-only send, which carries its name as an `aria-label` rather than as text. So
      the only thing that can put the word on screen is a REPLY's own Reply, which is what this test
      is about: the count is the furniture, and at rest there should be none of it.
    */
    expect(host.textContent?.match(/Reply/g) ?? []).toHaveLength(0);

    const words = host.querySelector('[style*="cursor: pointer"]') as HTMLElement | null;
    expect(words).not.toBeNull();
    words?.click();
    await settled();

    // Pressed: the reply's own Reply appears beside the reactions.
    expect(host.textContent?.match(/Reply/g) ?? []).toHaveLength(1);

    // Pressed again, it goes away. Several replies can be open at once now, so this says only that
    // a second press on the SAME one closes it — which is the row's own affordance.
    words?.click();
    await settled();
    expect(host.textContent?.match(/Reply/g) ?? []).toHaveLength(0);
  });
});
