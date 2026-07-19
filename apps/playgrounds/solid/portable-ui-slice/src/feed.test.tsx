/**
 * Harness regression test — renders the REAL feed template with REAL @we/components (Card/Column/Row)
 * over the in-memory backend. This is what the headless slice's stand-in components couldn't cover.
 *
 * It also guards the solid-js dedupe fix: without a single solid-js instance, the $query's
 * createEffect never fires, the feed renders empty, and these assertions fail — exactly the browser
 * symptom. With dedupe (see vitest.config.ts / vite.config.ts) reactivity works and this passes.
 */
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { feedTemplate } from './feedTemplate';
import { createInMemoryBackend, type Row } from './inMemoryBackend';
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

  it('renders identically with the QueryIR routing enabled ($useQueryIR)', async () => {
    // Flag on → createQuerySignal round-trips each query through compileQuery → irToFlatQuery
    // before hitting the backend. The feed must render exactly the same (proves the live IR path).
    const backend = seed();
    const stores = { ...backend.stores, $useQueryIR: true };
    const { container } = render(() => <RenderSchema node={feedTemplate} stores={stores} registry={registry} />);
    await tick();

    const text = container.textContent ?? '';
    expect(text).toContain('Graph theory');
    expect(text).toContain('Cooking');
    expect(text).not.toContain('Weather');
  });

  it('re-routes live when $useQueryIR flips (reactive accessor, no remount)', async () => {
    // $useQueryIR as a reactive accessor — flipping it must re-run the query effect (route through the
    // IR) without a remount, exactly like the live toggle on the Queries test page.
    const backend = seed();
    const [useIR, setUseIR] = createSignal(false);
    const stores = { ...backend.stores, $useQueryIR: useIR };
    const { container } = render(() => <RenderSchema node={feedTemplate} stores={stores} registry={registry} />);
    await tick();
    // flag off → legacy path → correct
    expect(container.textContent).toContain('Graph theory');
    expect(container.textContent).not.toContain('Weather');

    // flip on → query effect re-runs, routes through the IR → still correct, no reload
    setUseIR(true);
    await tick();
    expect(container.textContent).toContain('Graph theory');
    expect(container.textContent).toContain('Cooking');
    expect(container.textContent).not.toContain('Weather');
  });
});

// Local wrapper so the test mirrors main.tsx's mount exactly.
import { RenderSchema } from '@we/schema-solid';
function RenderSchemaWrapper(props: { backend: ReturnType<typeof createInMemoryBackend> }) {
  return <RenderSchema node={feedTemplate} stores={props.backend.stores} registry={registry} />;
}
