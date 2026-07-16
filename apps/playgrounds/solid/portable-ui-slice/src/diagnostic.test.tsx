/* Diagnostic — isolate WHERE the feed breaks: backend? renderer reactivity? the $query effect? */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-solid';
import { RenderSchema } from '@we/schema-solid';
import { describe, expect, it } from 'vitest';

import { createInMemoryBackend } from './inMemoryBackend';
import { registry } from './registry';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function seed() {
  return createInMemoryBackend({
    id: 'ds',
    tables: { Post: [{ id: 'p1', title: 'Graph theory', authorId: 'a1', createdAt: 3 }] },
  });
}

describe('diagnostics', () => {
  it('A: backend query().subscribe delivers rows (pure, no renderer)', async () => {
    const backend = seed();
    const model = backend.stores.$getModel('Post');
    let got: unknown[] = [];
    model.query({ id: 'ds' }, {}).subscribe((rows) => (got = rows));
    await tick();
    expect(got.length).toBe(1); // backend works in this env
  });

  it('B: $each over a LITERAL array renders via real renderer + registry', async () => {
    const backend = seed();
    const node: SchemaNode = {
      type: 'Column',
      children: [
        {
          type: '$each',
          props: { items: [{ title: 'Alpha' }, { title: 'Beta' }], as: 'row' },
          children: [{ type: 'we-text', children: ['$row.title'] }],
        },
      ],
    };
    const { container } = render(() => <RenderSchema node={node} stores={backend.stores} registry={registry} />);
    await tick();
    expect(container.textContent).toContain('Alpha'); // isolates renderer reactivity from $query
    expect(container.textContent).toContain('Beta');
  });

  it('C: $each over a $query renders', async () => {
    const backend = seed();
    const node: SchemaNode = {
      type: 'Column',
      children: [
        {
          type: '$each',
          props: { items: { $query: { model: 'Post' } }, as: 'post' },
          children: [{ type: 'we-text', children: ['$post.title'] }],
        },
      ],
    };
    const { container } = render(() => <RenderSchema node={node} stores={backend.stores} registry={registry} />);
    await tick();
    expect(container.textContent).toContain('Graph theory'); // isolates the $query effect
  });
});
