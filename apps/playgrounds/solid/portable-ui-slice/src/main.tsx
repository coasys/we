/**
 * Browser harness — proves WE's renderer + design system paint over a non-AD4M backend,
 * and is the seed of the L0/L1 "hello world" starter. This is, in miniature, what a `mountWe(...)`
 * integration does: pick a dataSource (in-memory), a registry (design system), and a template.
 */
import '@we/primitives'; // side-effect: defines all we-* custom elements
import '@we/tokens/css'; // design-token CSS variables

import { createInMemoryBackend, type Row as BackendRow } from '@we/backend-inmemory';
import { Row } from '@we/components/solid';
import { mountTemplateEditor } from '@we/editor';
import type { TemplateSchema } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import { onCleanup } from 'solid-js';
import { render } from 'solid-js/web';

import { feedTemplate } from './feedTemplate';
import { registry } from './registry';
import { createStandaloneEditorHost } from './standaloneEditorHost';

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
    (tables.Post as BackendRow[]).push({
      id: `new-${n}`,
      title: `Graph update #${n}`,
      content: 'Added at runtime — the live subscription re-rendered this.',
      authorId: n % 2 ? 'a1' : 'a2',
      createdAt: 100 + n,
    });
  });
}

/**
 * The editing surface, over the same in-memory backend.
 *
 * `@we/editor` claims to reach its application only through ports. This is the proof: a host built
 * from plain signals (`standaloneEditorHost.ts`), no WE shell, no stores, no perspective, and no
 * `@coasys/*` anywhere in this app's dependency graph — and the toolbar and panels mount and run.
 */
const editor = createStandaloneEditorHost(feedTemplate as TemplateSchema);

function EditingSurface() {
  let el!: HTMLDivElement;
  onCleanup(() => dispose?.());
  let dispose: (() => void) | undefined;
  return (
    <div
      ref={(node) => {
        el = node;
        dispose = mountTemplateEditor(el, { host: editor.host });
      }}
    />
  );
}

function App() {
  return (
    <div>
      <EditingSurface />
      {/* A `we-button` rather than a styled `<button>`: this harness exists to show the design system
          rendering over a non-AD4M backend, and its own control opting out of that was quietly
          undermining the demonstration. */}
      <Row position="fixed" top="400" right="400" zIndex={10}>
        <we-button size="sm" onClick={addPost}>
          + Add graph post (test live reactivity)
        </we-button>
      </Row>
      <RenderSchema node={feedTemplate} stores={backend.stores} registry={registry} />
    </div>
  );
}

render(() => <App />, document.getElementById('root')!);
