/**
 * Phase 0/4 browser harness — proves WE's renderer + design system paint over a non-AD4M backend,
 * and is the seed of the L0/L1 "hello world" starter. This is, in miniature, what a `mountWe(...)`
 * integration does: pick a dataSource (in-memory), a registry (design system), and a template.
 */
import '@we/primitives'; // side-effect: defines all we-* custom elements
import '@we/tokens/css'; // design-token CSS variables

import { RenderSchema } from '@we/schema-solid';
import { render } from 'solid-js/web';

import { feedTemplate } from './feedTemplate';
import { createInMemoryBackend, type Row } from './inMemoryBackend';
import { registry } from './registry';

const backend = createInMemoryBackend({
  id: 'in-memory-dataset',
  tables: {
    Agent: [
      { id: 'a1', name: 'Ada' },
      { id: 'a2', name: 'Bo' },
    ],
    Post: [
      { id: 'p1', title: 'Graph theory', content: 'On nodes and edges.', authorId: 'a1', createdAt: 3 },
      { id: 'p2', title: 'Cooking', content: 'A recipe that mentions graphs too.', authorId: 'a2', createdAt: 2 },
      { id: 'p3', title: 'Weather', content: 'Sunny today.', authorId: 'a1', createdAt: 1 },
    ],
  },
  relations: {
    Post: { author: { type: 'hasOne', target: 'Agent', foreignKey: 'authorId' } },
  },
});

// Demo live reactivity: add a matching post; the feed should re-render with it at the top.
let n = 0;
function addPost() {
  n += 1;
  backend.mutate((tables) => {
    (tables.Post as Row[]).push({
      id: `new-${n}`,
      title: `Graph update #${n}`,
      content: 'Added at runtime — the live subscription re-rendered this.',
      authorId: n % 2 ? 'a1' : 'a2',
      createdAt: 100 + n,
    });
  });
}

function App() {
  return (
    <div>
      <button
        onClick={addPost}
        style={{
          position: 'fixed',
          top: '16px',
          right: '16px',
          'z-index': '10',
          padding: '8px 14px',
          'border-radius': '8px',
          border: '1px solid #ccc',
          cursor: 'pointer',
        }}
      >
        + Add graph post (test live reactivity)
      </button>
      <RenderSchema node={feedTemplate} stores={backend.stores} registry={registry} />
    </div>
  );
}

render(() => <App />, document.getElementById('root')!);
