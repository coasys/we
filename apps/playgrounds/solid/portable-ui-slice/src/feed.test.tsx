/**
 * Harness regression test — renders the REAL feed template with REAL @we/components (Card/Column/Row)
 * over the in-memory backend. This is what the headless slice's stand-in components couldn't cover.
 *
 * It also guards the solid-js dedupe fix: without a single solid-js instance, the $query's
 * createEffect never fires, the feed renders empty, and these assertions fail — exactly the browser
 * symptom. With dedupe (see vitest.config.ts / vite.config.ts) reactivity works and this passes.
 */
import { render } from '@solidjs/testing-library';
import { createInMemoryBackend, type Row } from '@we/backend-inmemory';
import { describe, expect, it } from 'vitest';

import { feedTemplate } from './feedTemplate';
import { registry } from './registry';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function seed() {
  return createInMemoryBackend({
    id: 'in-memory-dataset',
    tables: {
      Agent: [
        { id: 'a1', name: 'Ada' },
        { id: 'a2', name: 'Bo' },
      ],
      Post: [
        { id: 'p1', title: 'Graph theory', content: 'nodes and edges', authorId: 'a1', createdAt: 3 },
        { id: 'p2', title: 'Cooking', content: 'about graphs too', authorId: 'a2', createdAt: 2 },
        { id: 'p3', title: 'Weather', content: 'sunny', authorId: 'a1', createdAt: 1 },
      ],
    },
    relations: {
      Post: { author: { type: 'hasOne', target: 'Agent', foreignKey: 'authorId' } },
    },
  });
}

describe('portable-ui harness — real design-system components over a non-AD4M backend', () => {
  it('renders the filtered/ordered/hydrated feed (reactivity across the dist boundary works)', async () => {
    const backend = seed();
    const { container } = render(() => <RenderSchemaWrapper backend={backend} />);
    await tick();

    const text = container.textContent ?? '';
    // If reactivity is severed (dual solid-js), the $query never emits and these are all absent.
    expect(text).toContain('Graph theory'); // matched title, author hydrated
    expect(text).toContain('Cooking'); // matched via content "graphs"
    expect(text).not.toContain('Weather'); // filtered out
  });

  it('reacts to a live backend mutation', async () => {
    const backend = seed();
    const { container } = render(() => <RenderSchemaWrapper backend={backend} />);
    await tick();
    expect(container.textContent).not.toContain('Graph databases');

    backend.mutate((tables) => {
      (tables.Post as Row[]).push({
        id: 'p4',
        title: 'Graph databases',
        content: 'triples',
        authorId: 'a2',
        createdAt: 9,
      });
    });
    await tick();

    expect(container.textContent).toContain('Graph databases');
  });

  /*
    These two replace a pair that flipped `$useQueryIR` on and off and asserted the feed rendered the
    same either way. There is no longer an either: every query compiles to the IR and is lowered by
    the backend's own adapter, so the tests above already exercise that path and the interesting
    question has moved. It is now what happens to a host that supplies no adapter — which used to
    render a perfectly good feed down the raw-dialect path, and so could ship against a backend whose
    capabilities nothing had ever consulted.
  */
  it('renders through the adapter the backend supplies — there is no unrouted path', async () => {
    const backend = seed();
    expect(backend.stores.$queryAdapter).toBeDefined();

    const { container } = render(() => <RenderSchemaWrapper backend={backend} />);
    await tick();

    expect(container.textContent).toContain('Graph theory');
  });

  it('refuses, rather than falling back, when the host supplies no adapter', async () => {
    const backend = seed();
    const { $queryAdapter: _dropped, ...withoutAdapter } = backend.stores as Record<string, unknown>;
    void _dropped;
    const reported: string[] = [];
    const stores = { ...withoutAdapter, $onError: (msg: string) => reported.push(msg) };

    const { container } = render(() => <RenderSchema node={feedTemplate} stores={stores} registry={registry} />);
    await tick();

    // Nothing rendered, and a reason given that names the missing binding rather than blaming the
    // query — the whole point of removing the fallback is that this case stops being invisible.
    expect(container.textContent).not.toContain('Graph theory');
    expect(reported.join(' ')).toContain('$queryAdapter');
  });
});

// Local wrapper so the test mirrors main.tsx's mount exactly.
import { RenderSchema } from '@we/schema-solid';
function RenderSchemaWrapper(props: { backend: ReturnType<typeof createInMemoryBackend> }) {
  return <RenderSchema node={feedTemplate} stores={props.backend.stores} registry={registry} />;
}
