/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 0 (portable-UI slice) — proves the schema renderer renders a real, non-trivial template
 * (a feed: $each over a live $query, with a `where` filter, `order`, and an `include` relation)
 * against an arbitrary in-memory backend, with **zero AD4M**.
 *
 * If this passes, WE's UI half is genuinely backend-portable — the whole thesis of the port. The
 * list of everything the renderer read off the injected `stores` bag (see below) is the empirical
 * input to Phase 1's `DataSource` interface.
 */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';
import { createInMemoryBackend } from './inMemoryDataSource';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// Lightweight stand-in components (real @we/components rendering is the browser step; this proves
// the render + query + reactivity path headlessly). Each renders its resolved children.
const Stack = (p: any) => <div data-testid={p.testid ?? 'stack'}>{p.children}</div>;
const Field = (p: any) => <span class="field">{p.children}</span>;
const registry: ComponentRegistry = { Stack, Field };

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

// A real feed template: filter posts mentioning "graph" in title OR content, newest first, with the
// author hydrated via include. Exercises $query, $each, where/OR, order, include, and context paths.
const feedTemplate: SchemaNode = {
  type: 'Stack',
  props: { testid: 'feed' },
  children: [
    {
      type: '$each',
      props: {
        items: {
          $query: {
            model: 'Post',
            where: {
              OR: [{ title: { contains: 'graph' } }, { content: { contains: 'graph' } }],
            },
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

describe('portable-UI slice — renderer over an in-memory (non-AD4M) backend', () => {
  it('renders a filtered, ordered, relation-hydrated feed', async () => {
    const backend = seedBackend();

    const { container } = render(() => (
      <RenderSchema node={feedTemplate} stores={backend.stores} registry={registry} />
    ));
    await tick();

    const posts = container.querySelectorAll('[data-testid="post"]');
    // Filter: only p1 (title) and p2 (content) mention "graph"; p3 excluded.
    expect(posts.length).toBe(2);

    const text = Array.from(posts).map((el) => el.textContent);
    // Order: createdAt desc → Graph theory (3) before Cooking (2).
    expect(text[0]).toContain('Graph theory');
    expect(text[0]).toContain('by Ada'); // include hydrated the author relation
    expect(text[1]).toContain('Cooking');
    expect(text[1]).toContain('by Bo');

    // The excluded post never rendered.
    expect(container.textContent).not.toContain('Weather');
  });

  it('reacts live when the backend mutates', async () => {
    const backend = seedBackend();

    const { container } = render(() => (
      <RenderSchema node={feedTemplate} stores={backend.stores} registry={registry} />
    ));
    await tick();
    expect(container.querySelectorAll('[data-testid="post"]').length).toBe(2);

    // Add a new matching post; the live subscription should re-emit and the feed re-render.
    backend.mutate((tables) => {
      tables.Post.push({ id: 'p4', title: 'Graph databases', content: 'triples', authorId: 'a2', createdAt: 4 });
    });
    await tick();

    const posts = container.querySelectorAll('[data-testid="post"]');
    expect(posts.length).toBe(3);
    // Newest → first.
    expect(posts[0].textContent).toContain('Graph databases');
  });
});
