/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Guards the **published artifact**, not the source: does `dist/` keep reactivity?
 *
 * Every other test in this package imports from `src/`, compiled by vite-plugin-solid. A consumer
 * without a Solid toolchain instead gets `dist/`, pre-compiled by esbuild-plugin-solid via tsup —
 * a different compiler, and a path nothing else covers. The failure mode is silent and severe: JSX
 * still renders, so the initial paint looks correct, and only *updates* stop arriving.
 *
 * The cases below mirror portableSlice.test.tsx exactly and run against both entry points, so a
 * dist-vs-src difference is the only variable. The live-mutation case is the load-bearing one — it
 * exercises the scheduled `$query` effect, which is what breaks first when two Solid compilers or
 * two runtime instances meet.
 *
 * Requires a prior `pnpm build` — `dist/` is gitignored, so the suite skips itself when absent
 * rather than failing a fresh clone for the wrong reason.
 */
import { render } from '@solidjs/testing-library';
import { createInMemoryBackend } from '@we/backend-inmemory';
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { RenderSchema as RenderSchemaSrc } from '../src/SchemaRenderer';

// The specifier is built at runtime and marked @vite-ignore so vite cannot resolve it statically —
// a literal path makes an unbuilt `dist/` a transform-time failure, which would defeat the skip
// below and fail a fresh clone for the wrong reason.
const distSpecifier = ['..', 'dist', 'index.js'].join('/');
const RenderSchemaDist: any = await import(/* @vite-ignore */ distSpecifier).then(
  (m) => m.RenderSchema,
  () => null,
);
const distBuilt = RenderSchemaDist != null;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const Stack = (p: any) => <div data-testid={p.testid ?? 'stack'}>{p.children}</div>;
const Field = (p: any) => <span class="field">{p.children}</span>;
const registry: any = { Stack, Field };

function seedBackend() {
  return createInMemoryBackend({
    uuid: 'in-memory-dataset',
    tables: {
      Agent: [
        { id: 'a1', name: 'Ada' },
        { id: 'a2', name: 'Bo' },
      ],
      Post: [
        { id: 'p1', title: 'Graph theory', content: 'nodes and edges', authorId: 'a1', createdAt: 3 },
        { id: 'p2', title: 'Cooking', content: 'about graphs too', authorId: 'a2', createdAt: 2 },
        { id: 'p3', title: 'Weather', content: 'sunny today', authorId: 'a1', createdAt: 1 },
      ],
    },
    relations: {
      Post: { author: { type: 'hasOne', target: 'Agent', foreignKey: 'authorId' } },
    },
  });
}

const feedTemplate: SchemaNode = {
  type: 'Stack',
  props: { testid: 'feed' },
  children: [
    {
      type: '$each',
      props: {
        items: {
          $query: {
            entity: 'Post',
            where: { OR: [{ title: { contains: 'graph' } }, { content: { contains: 'graph' } }] },
            order: { createdAt: 'desc' },
            include: { author: true },
          },
        },
        as: 'post',
      },
      children: [
        {
          type: 'Stack',
          props: { testid: 'post' },
          children: [
            { type: 'Field', children: ['$post.title'] },
            { type: 'Field', children: ['by ', '$post.author.name'] },
          ],
        },
      ],
    },
  ],
};

function suite(Renderer: () => any) {
  it('resolves the async query and renders the feed', async () => {
    const backend = seedBackend();
    const { container } = render(() => Renderer()({ node: feedTemplate, stores: backend.stores, registry }));
    await tick();

    const posts = container.querySelectorAll('[data-testid="post"]');
    expect(posts.length).toBe(2);
    expect(posts[0].textContent).toContain('Graph theory');
    expect(posts[0].textContent).toContain('by Ada');
    expect(container.textContent).not.toContain('Weather');
  });

  it('reacts live when the backend mutates', async () => {
    const backend = seedBackend();
    const { container } = render(() => Renderer()({ node: feedTemplate, stores: backend.stores, registry }));
    await tick();
    expect(container.querySelectorAll('[data-testid="post"]').length).toBe(2);

    backend.mutate((tables: any) => {
      tables.Post.push({ id: 'p4', title: 'Graph databases', content: 'triples', authorId: 'a2', createdAt: 4 });
    });
    await tick();

    const posts = container.querySelectorAll('[data-testid="post"]');
    expect(posts.length).toBe(3);
    expect(posts[0].textContent).toContain('Graph databases');
  });
}

// The src baseline: if this fails, the problem is the renderer, not the packaging.
describe('src entry', () => suite(() => RenderSchemaSrc));

describe.skipIf(!distBuilt)('dist entry (published artifact)', () => suite(() => RenderSchemaDist));
