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
    name: 'SemanticRelationship',
    description: 'An edge with data — which topic a belief is about, and how strongly.',
    properties: [{ name: 'relevance', type: 'number', required: true }],
    relations: [
      { name: 'expression', target: 'Belief', cardinality: 'one' },
      { name: 'tag', target: 'Topic', cardinality: 'one' },
    ],
  },
  {
    name: 'Utterance',
    identityProperty: 'text',
    description: 'A line of transcript — enough of them to make paging visible.',
    properties: [
      { name: 'text', type: 'string', required: true },
      { name: 'speaker', type: 'string' },
    ],
    relations: [{ name: 'topic', target: 'Topic', cardinality: 'one' }],
  },
  {
    name: 'CollectionBlock',
    identityProperty: 'name',
    description: 'A container — a call transcript, a note, a nested group.',
    properties: [
      { name: 'name', type: 'string', required: true },
      { name: 'kind', type: 'string' },
      // Board positions live on the entity — the inversion that makes a freeform canvas a *mode* of
      // this engine rather than a different engine. `manual` layout reads exactly these.
      { name: 'x', type: 'number' },
      { name: 'y', type: 'number' },
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
    {
      // Deliberately authored by someone who is not in the Agent table. In a peer-to-peer system a
      // relation target that has not synced is ordinary, and the engine must render it as a
      // placeholder — "not here yet" rather than "nothing there". Nothing else exercises that path.
      id: 'be-5',
      title: 'Peers will disagree about what was said',
      confidence: 'low',
      author: 'ag-unsynced',
      topic: 'to-sync',
    },
  ],

  // Edges with data. Drawn naively these would be four extra dots; the engine collapses each into the
  // single relationship it stands for, carrying `relevance` and staying clickable via `reifiedAs`.
  SemanticRelationship: [
    { id: 'sr-1', relevance: 0.9, expression: 'be-1', tag: 'to-graph' },
    { id: 'sr-2', relevance: 0.6, expression: 'be-2', tag: 'to-graph' },
    { id: 'sr-3', relevance: 0.95, expression: 'be-2', tag: 'to-interp' },
    { id: 'sr-4', relevance: 0.4, expression: 'be-4', tag: 'to-sync' },
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
    { id: 'co-standup', name: 'Standup, 10 Aug', kind: 'call', children: ['tx-1', 'tx-2', 'co-thread'], x: 120, y: 90 },
    { id: 'co-thread', name: 'Side thread on layouts', kind: 'call', children: ['tx-3', 'tx-4'], x: 460, y: 260 },
    { id: 'co-notes', name: 'Scratch notes', kind: 'notes', children: ['tx-5'], x: 150, y: 420 },
    { id: 'co-board', name: 'Roadmap board', kind: 'board', children: [], x: 520, y: 60 },
  ],

  Utterance: [
    { id: 'ut-01', text: 'The expander is the unit, not the widget.', speaker: 'James', topic: 'to-graph' },
    {
      id: 'ut-02',
      text: 'Reverse traversal is half of what makes it explorable.',
      speaker: 'Nico',
      topic: 'to-interp',
    },
    { id: 'ut-03', text: 'Collapse has to bundle, or the view lies.', speaker: 'Josh', topic: 'to-sync' },
    { id: 'ut-04', text: 'Warm start, or the map jumps every expansion.', speaker: 'James', topic: 'to-graph' },
    { id: 'ut-05', text: 'Hit-testing belongs to the core.', speaker: 'Nico', topic: 'to-interp' },
    { id: 'ut-06', text: 'Placeholders are a first-class state here.', speaker: 'Josh', topic: 'to-sync' },
    { id: 'ut-07', text: 'Paging is not optional on a hub node.', speaker: 'James', topic: 'to-graph' },
    { id: 'ut-08', text: 'A budget that truncates silently is worse than none.', speaker: 'Nico', topic: 'to-interp' },
    { id: 'ut-09', text: 'Tree layout wants crossing reduction.', speaker: 'Josh', topic: 'to-sync' },
    { id: 'ut-10', text: 'Community detection gives us cluster maps.', speaker: 'James', topic: 'to-graph' },
    { id: 'ut-11', text: 'Metrics stay out of hit-testing.', speaker: 'Nico', topic: 'to-interp' },
    { id: 'ut-12', text: 'One address scheme or the explorer is a rewrite.', speaker: 'Josh', topic: 'to-sync' },
    { id: 'ut-13', text: 'Reified edges must not render as nodes.', speaker: 'James', topic: 'to-graph' },
    { id: 'ut-14', text: 'The catalog is what makes plugins reachable.', speaker: 'Nico', topic: 'to-interp' },
    { id: 'ut-15', text: 'Manual layout inverts who owns position.', speaker: 'Josh', topic: 'to-sync' },
    { id: 'ut-16', text: 'Schema maps work in an empty space.', speaker: 'James', topic: 'to-graph' },
    { id: 'ut-17', text: 'Degree is a decent proxy for importance.', speaker: 'Nico', topic: 'to-interp' },
    { id: 'ut-18', text: 'Barycentre sweeps beat traversal order.', speaker: 'Josh', topic: 'to-sync' },
    { id: 'ut-19', text: 'Two conventions for one problem is one too many.', speaker: 'James', topic: 'to-graph' },
    { id: 'ut-20', text: 'The harness found the bug, which is the point.', speaker: 'Nico', topic: 'to-interp' },
    { id: 'ut-21', text: 'Fit has to survive a zero-sized box.', speaker: 'Josh', topic: 'to-sync' },
    { id: 'ut-22', text: 'Reindex on every path that moves a node.', speaker: 'James', topic: 'to-graph' },
    { id: 'ut-23', text: 'Untyped relations need the drill-down path.', speaker: 'Nico', topic: 'to-interp' },
    { id: 'ut-24', text: 'Value nodes converge or they are pointless.', speaker: 'Josh', topic: 'to-sync' },
    { id: 'ut-25', text: 'Seed sources and expanders are the same shape.', speaker: 'James', topic: 'to-graph' },
    { id: 'ut-26', text: 'A cluster is a collapsed synthetic node.', speaker: 'Nico', topic: 'to-interp' },
    { id: 'ut-27', text: 'Do not grow JSON toward a language.', speaker: 'Josh', topic: 'to-sync' },
    { id: 'ut-28', text: 'Name the plugin, keep the data declarative.', speaker: 'James', topic: 'to-graph' },
    { id: 'ut-29', text: 'Forward-only relations shape the whole engine.', speaker: 'Nico', topic: 'to-interp' },
    { id: 'ut-30', text: 'Bundles carry a weight so the count survives.', speaker: 'Josh', topic: 'to-sync' },
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

/**
 * Which field of a node is worth editing, if any.
 *
 * The harness needs *a* write path to exercise — a graph that can only be read tells you nothing
 * about whether editing a record flows back through seeds and expanders. This picks the identity
 * property, which is the one a card actually displays.
 */
export function editableField(node: { type: string; data?: Record<string, unknown> }): string | null {
  const shape = SHAPES.find((s) => s.name === node.type);
  const field = shape?.identityProperty;
  return field && node.data && field in node.data ? field : null;
}

/**
 * Write a value back into the fixture.
 *
 * Mutating the source rows rather than patching the rendered node on purpose: the point is to prove
 * the value survives a round trip *through* the seed and expander path, exactly as it would through a
 * real data layer. Returns false when the row cannot be found, so the caller can leave the UI alone
 * rather than showing a change that did not happen.
 */
export function writeField(node: { type: string; id: string }, field: string, value: string): boolean {
  // The graph node's id is an address; the row id is its last segment.
  const rowId = decodeURIComponent(node.id.split('/').pop() ?? '');
  const row = (TABLES[node.type] ?? []).find((candidate) => candidate.id === rowId);
  if (!row) return false;
  row[field] = value;
  return true;
}
