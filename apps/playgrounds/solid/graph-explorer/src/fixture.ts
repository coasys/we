/**
 * A small dataset, shaped like what interpretation over a call transcript actually produces.
 *
 * Chosen to exercise every expander rather than to look pretty:
 *
 * - **Typed relations, forwards** — `Belief.author`, `Task.owner`, both `→ Agent`.
 * - **Typed relations, backwards** — several classes point at `Topic`, so expanding a topic
 *   inward is the only way to see what it gathers. That is the half a one-directional map loses.
 * - **A self-relation** — `Task.blocks → Task`, which is where an edge router that cannot handle
 *   two nodes related in both directions falls over.
 * - **An untyped to-many** — `CollectionBlock.children`, invisible to a schema-driven walk, which
 *   is the whole reason the containment expander exists. One collection holds another so the
 *   drill-down recurses.
 * - **Shared scalar values** — several beliefs share a `confidence`, several tasks a `status`, so
 *   the property expander's value nodes visibly converge rather than producing a starburst.
 */
import type { EntityShape } from '@we/graph-protocol';

export type Row = Record<string, unknown>;

/**
 * Shapes, in the neutral form the engine reads.
 *
 * In the app these are derived from the dataset's own SHACL by the backend adapter; here they are
 * written out, which is the point of the harness — the engine cannot tell the difference, so
 * anything that works here works against a real dataset with the same shapes.
 */
export const SHAPES: EntityShape[] = [
  {
    name: 'Agent',
    identityProperty: 'name',
    description: 'A person in the conversation.',
    properties: [
      { name: 'name', type: 'string', required: true },
      { name: 'role', type: 'string' },
    ],
    relations: [],
  },
  {
    name: 'Topic',
    identityProperty: 'title',
    description: 'A subject the participants discuss.',
    properties: [{ name: 'title', type: 'string', required: true }],
    relations: [],
  },
  {
    name: 'Belief',
    identityProperty: 'title',
    description: 'A claim someone holds to be true.',
    properties: [
      { name: 'title', type: 'string', required: true },
      { name: 'confidence', type: 'string' },
    ],
    relations: [
      { name: 'author', target: 'Agent', cardinality: 'one' },
      { name: 'topic', target: 'Topic', cardinality: 'one' },
    ],
  },
  {
    name: 'Task',
    identityProperty: 'title',
    description: 'A commitment to act.',
    properties: [
      { name: 'title', type: 'string', required: true },
      { name: 'status', type: 'string' },
    ],
    relations: [
      { name: 'owner', target: 'Agent', cardinality: 'one' },
      { name: 'topic', target: 'Topic', cardinality: 'one' },
      { name: 'blocks', target: 'Task', cardinality: 'many' },
    ],
  },
  {
    name: 'Question',
    identityProperty: 'title',
    description: 'Something raised and not resolved.',
    properties: [{ name: 'title', type: 'string', required: true }],
    relations: [
      { name: 'asker', target: 'Agent', cardinality: 'one' },
      { name: 'topic', target: 'Topic', cardinality: 'one' },
    ],
  },
  {
    name: 'CollectionBlock',
    identityProperty: 'name',
    description: 'A container — a call transcript, a note, a nested group.',
    properties: [
      { name: 'name', type: 'string', required: true },
      { name: 'kind', type: 'string' },
    ],
    // `children` is deliberately absent from `relations`: it is untyped in WE, which is exactly why
    // the containment expander has to reach it through the drill-down path instead.
    relations: [],
  },
  {
    name: 'TextBlock',
    identityProperty: 'text',
    description: 'A single utterance or note.',
    properties: [{ name: 'text', type: 'string', required: true }],
    relations: [],
  },
];

export const TABLES: Record<string, Row[]> = {
  Agent: [
    { id: 'ag-james', name: 'James', role: 'design' },
    { id: 'ag-nico', name: 'Nico', role: 'runtime' },
    { id: 'ag-josh', name: 'Josh', role: 'product' },
  ],

  Topic: [
    { id: 'to-graph', title: 'Graph rendering' },
    { id: 'to-interp', title: 'Interpretation' },
    { id: 'to-sync', title: 'Peer sync' },
  ],

  Belief: [
    {
      id: 'be-1',
      title: 'Graph viz is the hardest part of the interface',
      confidence: 'high',
      author: 'ag-james',
      topic: 'to-graph',
    },
    {
      id: 'be-2',
      title: 'Hints beat per-class extraction code',
      confidence: 'high',
      author: 'ag-nico',
      topic: 'to-interp',
    },
    {
      id: 'be-3',
      title: 'Reverse traversal is what makes a map explorable',
      confidence: 'medium',
      author: 'ag-james',
      topic: 'to-graph',
    },
    {
      id: 'be-4',
      title: 'Dedup by title alone will duplicate near-identical nodes',
      confidence: 'medium',
      author: 'ag-josh',
      topic: 'to-interp',
    },
  ],

  Task: [
    {
      id: 'ta-1',
      title: 'Build the expander protocol',
      status: 'done',
      owner: 'ag-james',
      topic: 'to-graph',
      blocks: ['ta-2', 'ta-3'],
    },
    {
      id: 'ta-2',
      title: 'Add reverse relations to the query IR',
      status: 'open',
      owner: 'ag-nico',
      topic: 'to-graph',
      blocks: [],
    },
    {
      id: 'ta-3',
      title: 'Ship the plugin catalog to the AI context',
      status: 'open',
      owner: 'ag-james',
      topic: 'to-graph',
      blocks: [],
    },
    {
      id: 'ta-4',
      title: 'Semantic dedup as a runtime parameter',
      status: 'open',
      owner: 'ag-nico',
      topic: 'to-interp',
      blocks: [],
    },
  ],

  Question: [
    { id: 'qu-1', title: 'Should boards share the exploration engine?', asker: 'ag-josh', topic: 'to-graph' },
    { id: 'qu-2', title: 'How do we coordinate which peer runs interpretation?', asker: 'ag-nico', topic: 'to-sync' },
  ],

  CollectionBlock: [
    { id: 'co-standup', name: 'Standup, 10 Aug', kind: 'call', children: ['tx-1', 'tx-2', 'co-thread'] },
    { id: 'co-thread', name: 'Side thread on layouts', kind: 'call', children: ['tx-3', 'tx-4'] },
    { id: 'co-notes', name: 'Scratch notes', kind: 'notes', children: ['tx-5'] },
  ],

  TextBlock: [
    { id: 'tx-1', text: 'The engine should be one thing with plugins, not six widgets.' },
    { id: 'tx-2', text: 'Agreed — expanders are the unit.' },
    { id: 'tx-3', text: 'Tree layout for containment, force for everything else.' },
    { id: 'tx-4', text: 'And a warm start, or the map jumps every expansion.' },
    { id: 'tx-5', text: 'Remember: collapse has to bundle, not hide.' },
  ],
};

/** The dataset id the harness pretends to be scoped to. */
export const DATASET = 'playground';
