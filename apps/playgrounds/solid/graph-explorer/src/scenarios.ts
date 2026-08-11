/**
 * The scenarios, as specs.
 *
 * Each is exactly what a template would write — no harness-only escape hatches — so what you see
 * here is what an author gets. Between them they cover every extension axis: seeds, expanders,
 * layouts, styling, behaviours.
 */
import type { GraphSpec, NodeStyleRules } from '@we/graph-protocol';

export interface Scenario {
  id: string;
  label: string;
  /** What to look at, and what would be wrong. */
  note: string;
  spec: GraphSpec;
}

/**
 * One palette, shared.
 *
 * These were copy-pasted across four scenarios, which is how `Belief` ends up two different purples.
 * A base rule plus per-type overrides, spread into whichever scenario needs it.
 */
const PALETTE: NodeStyleRules = [
  { style: { size: 12, color: 'neutral-400' } },
  { when: { type: 'Belief' }, style: { size: 20, color: 'primary-500' } },
  { when: { type: 'Agent' }, style: { size: 18, color: 'success-500' } },
  { when: { type: 'Topic' }, style: { size: 22, color: 'warning-500', shape: 'rect' } },
  { when: { type: 'Task' }, style: { size: 18, color: 'danger-500' } },
  { when: { type: 'Question' }, style: { size: 16, color: 'success-600' } },
  { when: { type: 'Utterance' }, style: { size: 10, color: 'neutral-500' } },
  // Last, so "not here yet" wins over whatever the type would otherwise paint.
  { when: { unresolved: true }, style: { color: 'neutral-200' } },
];

export const SCENARIOS: Scenario[] = [
  {
    id: 'static',
    label: 'Static diagram',
    note: 'No data layer at all — a literal fragment. Nothing here should query anything: the log stays empty.',
    spec: {
      seeds: {
        literal: true,
        nodes: [
          { id: 'draft', kind: 'resource', type: 'step', label: 'Draft' },
          { id: 'review', kind: 'resource', type: 'step', label: 'Review' },
          { id: 'revise', kind: 'resource', type: 'step', label: 'Revise' },
          { id: 'publish', kind: 'resource', type: 'step', label: 'Publish' },
        ],
        edges: [
          { id: 'e1', source: 'draft', target: 'review', type: 'next' },
          { id: 'e2', source: 'review', target: 'revise', type: 'sends back' },
          { id: 'e3', source: 'revise', target: 'review', type: 'resubmit' },
          { id: 'e4', source: 'review', target: 'publish', type: 'approve' },
        ],
      },
      layout: { type: 'tree', options: { direction: 'right', levelGap: 190 } },
      nodeStyle: [
        { style: { shape: 'rect', size: 22, color: 'primary-500' } },
        { when: { label: 'Publish' }, style: { color: 'success-500' } },
      ],
      // review↔revise are mutual: they must bow apart, not draw as one line.
      edgeStyle: [{ style: { showLabel: true, arrow: 'target' } }],
      behaviours: ['pan-zoom', 'select', { type: 'drag-node', options: { pin: true } }],
      // A hand-arranged diagram is exactly what `lock` is for: once it reads the way you meant, the
      // only thing left to do to it is nudge it by mistake.
      controls: ['zoom-in', 'zoom-out', 'fit', 'lock'],
    },
  },

  {
    id: 'schema',
    label: 'Schema map',
    note: "The dataset's own vocabulary — types as nodes, declared relations as edges. Works in an empty space, and picks up classes added after a template was written. Double-click a type to open it into its records.",
    spec: {
      seeds: { source: 'schema' },
      expansion: { defaultDepth: 0, limit: 20 },
      layout: { type: 'force', options: { distance: 170, charge: -320 } },
      // `pin` belongs on a derived layout: select the node the map is really about, hold it, and let
      // the simulation arrange everything else around it.
      controls: ['zoom-in', 'zoom-out', 'fit', 'pin'],
      nodeStyle: [
        { style: { shape: 'rect', size: 20, color: 'primary-500' } },
        { when: { 'data.relations': 0 }, style: { color: 'neutral-400', size: 14 } },
        { when: { 'data.relations': { gt: 2 } }, style: { size: 28, color: 'primary-700' } },
        // Records opened out of a type node are round and small, so the two levels stay distinct.
        {
          when: { kind: 'entity', type: { not: '$schema' } },
          style: { shape: 'circle', size: 12, color: 'neutral-400' },
        },
      ],
      edgeStyle: [{ style: { showLabel: true, curve: 'bezier' } }],
      behaviours: ['pan-zoom', 'select', 'expand-on-double-click', { type: 'drag-node' }],
    },
  },

  {
    id: 'knowledge',
    label: 'Knowledge map',
    note: 'Beliefs with their author and topic drawn straight from the seed — no expansion yet. Double-click to open a node further, again to collapse. Two beliefs by one person converge on one author node, and the fifth belief cites an author who has not synced: it renders as a dashed placeholder, which is "not here yet", not "nothing there".',
    spec: {
      seeds: { source: 'query', options: { entity: 'Belief', limit: 20, relations: ['author', 'topic'] } },
      expansion: { defaultDepth: 0, direction: 'both', limit: 25, maxNodes: 300 },
      layout: { type: 'force' },
      nodeStyle: PALETTE,
      edgeStyle: [{ style: { curve: 'bezier', arrow: 'target', showLabel: true } }],
      behaviours: ['pan-zoom', 'select', 'expand-on-double-click', { type: 'drag-node' }],
    },
  },

  {
    id: 'reverse',
    label: 'Reverse traversal',
    note: 'Seeded with topics, which point at nothing. Every edge you can reach is a backward one — double-click a topic and what gathers around it arrives entirely through the inward pass.',
    spec: {
      seeds: { source: 'query', options: { entity: 'Topic', limit: 10 } },
      expansion: { defaultDepth: 1, direction: 'in', limit: 25 },
      layout: { type: 'radial', options: { ringGap: 190 } },
      nodeStyle: [...PALETTE, { when: { type: 'Topic' }, style: { size: 26 } }],
      edgeStyle: [{ style: { arrow: 'target', showLabel: true } }],
      behaviours: ['pan-zoom', 'select', 'expand-on-double-click'],
    },
  },

  {
    id: 'content',
    label: 'Content tree',
    note: 'Containment through an untyped relation, which a schema-driven walk cannot see. One collection holds another, so drilling in recurses. Collapse a collection with children still linked outside it and the bundle edge shows the count.',
    spec: {
      seeds: { source: 'query', options: { entity: 'CollectionBlock', limit: 10 } },
      expansion: { defaultDepth: 1, direction: 'out', expanders: ['collection'], maxNodes: 200 },
      layout: { type: 'tree', options: { direction: 'right', levelGap: 240, siblingGap: 70 } },
      nodeStyle: [
        { style: { size: 10, color: 'neutral-400', shape: 'rect' } },
        { when: { type: 'CollectionBlock' }, style: { size: 20, color: 'primary-500' } },
        { when: { 'data.kind': 'call' }, style: { color: 'success-500' } },
        { when: { 'data.kind': 'notes' }, style: { color: 'warning-500' } },
      ],
      edgeStyle: [{ style: { curve: 'orthogonal', color: 'neutral-300', arrow: 'none' } }],
      behaviours: ['pan-zoom', 'select', 'expand-on-double-click'],
    },
  },

  {
    id: 'properties',
    label: 'Property drill-down',
    note: 'The resolution level below an entity. Every task opens into its own fields, and the shared value nodes converge — three open tasks meet at one `open` node, which is the only reason promoting values to nodes is worth doing.',
    spec: {
      seeds: { source: 'query', options: { entity: 'Task', limit: 10 } },
      expansion: { defaultDepth: 1, direction: 'out', expanders: ['property'], maxNodes: 200 },
      layout: { type: 'force', options: { distance: 70, charge: -160, collide: 20 } },
      nodeStyle: [
        { style: { size: 8, color: 'neutral-400' } },
        { when: { type: 'Task' }, style: { size: 20, color: 'primary-500' } },
        { when: { kind: 'property' }, style: { size: 6, color: 'neutral-300' } },
        { when: { kind: 'literal' }, style: { shape: 'rect', size: 14, color: 'warning-500' } },
      ],
      edgeStyle: [{ style: { color: 'neutral-200', arrow: 'none' } }],
      behaviours: ['pan-zoom', 'select', 'expand-on-double-click'],
    },
  },

  {
    id: 'budget',
    label: 'Budget guard',
    note: 'A deliberately tiny ceiling. Expansion should stop and *say so* in the status strip rather than quietly truncating — a map that silently stops growing reads as complete.',
    spec: {
      seeds: { source: 'schema' },
      expansion: { defaultDepth: 3, direction: 'both', maxNodes: 12 },
      layout: { type: 'grid', options: { columns: 4, gap: 130 } },
      nodeStyle: [{ style: { shape: 'rect', size: 18, color: 'primary-500' } }],
      behaviours: ['pan-zoom', 'select'],
    },
  },

  {
    id: 'reified',
    label: 'Edges with data',
    note: 'SemanticRelationship is an entity whose two relations name what it connects. Drawn naively each one is an extra dot; here each collapses into the single edge it stands for, thicker where relevance is higher. Click an edge — it still knows the record it came from.',
    spec: {
      seeds: [
        { source: 'query', options: { entity: 'SemanticRelationship', limit: 20 } },
        { source: 'query', options: { entity: 'Topic', limit: 10 } },
      ],
      expansion: { defaultDepth: 0, direction: 'both' },
      layout: { type: 'force', options: { distance: 150 } },
      nodeStyle: PALETTE,
      edgeStyle: [
        { style: { curve: 'bezier', arrow: 'target', color: 'neutral-300' } },
        { when: { type: 'tagged' }, style: { showLabel: false, color: 'primary-400', width: 2 } },
        { when: { 'data.relevance': { gt: 0.8 } }, style: { color: 'primary-600', width: 4 } },
      ],
      behaviours: ['pan-zoom', 'select', 'expand-on-double-click'],
    },
  },

  {
    id: 'clusters',
    label: 'Cluster map',
    note: 'Colour and size are computed, not declared: community detection groups the graph and degree sizes it. Both are metric plugins named from JSON — the escape hatch for anything the rule vocabulary cannot express.',
    spec: {
      seeds: { source: 'query', options: { entity: 'Utterance', limit: 30, relations: ['topic'] } },
      expansion: { defaultDepth: 1, direction: 'in', limit: 30, maxNodes: 200 },
      layout: { type: 'force', options: { distance: 60, charge: -140, collide: 16 } },
      nodeStyle: [
        {
          style: {
            size: { metric: 'degree', range: [8, 30] },
            color: { metric: 'community', scale: 'categorical' },
          },
        },
      ],
      edgeStyle: [{ style: { color: 'neutral-200', arrow: 'none' } }],
      behaviours: ['pan-zoom', 'select', 'expand-on-double-click'],
    },
  },

  {
    id: 'paging',
    label: 'Paging a hub',
    note: 'Thirty utterances behind a page size of eight. The type node shows a "+" while more remain; double-click repeatedly to pull the next page, and watch the query log. A node that has given everything stops responding — an expansion that silently repeats itself looks identical to one that is broken.',
    spec: {
      seeds: { source: 'schema', options: { entities: ['Utterance', 'Topic', 'Belief'] } },
      expansion: { defaultDepth: 0, limit: 8, maxNodes: 400 },
      layout: { type: 'force', options: { distance: 90 } },
      nodeStyle: [
        { style: { shape: 'rect', size: 22, color: 'primary-500' } },
        { when: { type: { not: '$schema' } }, style: { shape: 'circle', size: 9, color: 'neutral-400' } },
      ],
      edgeStyle: [{ style: { color: 'neutral-200', arrow: 'none' } }],
      behaviours: ['pan-zoom', 'select', 'expand-on-double-click'],
    },
  },

  {
    id: 'board',
    label: 'Board (manual)',
    note: 'Post-it cards, positioned by their own x/y rather than by a layout — position is the data here. Drag one and it stays put; a real board would persist the drop via onNodeDragEnd. Select a card to read and edit it in the inspector. Inline editing is deliberately absent: text editing on a transformed canvas is the board project, not a flag.',
    spec: {
      seeds: { source: 'query', options: { entity: 'CollectionBlock', limit: 10 } },
      expansion: { defaultDepth: 0, expanders: ['collection'] },
      layout: { type: 'manual' },
      nodeStyle: [
        // A card carries its text inside the box — the node *is* the content, rather than a mark with
        // a caption. `size` stops meaning radius here and the width/height take over.
        { style: { shape: 'card', width: 170, color: 'primary-100', labelColor: 'primary-900' } },
        { when: { 'data.kind': 'call' }, style: { color: 'success-100', labelColor: 'success-900' } },
        { when: { 'data.kind': 'notes' }, style: { color: 'warning-100', labelColor: 'warning-900' } },
        { when: { 'data.kind': 'board' }, style: { color: 'danger-100', labelColor: 'danger-900' } },
        // Children opened out of a card stay small marks, so the two levels read differently.
        { when: { type: { not: 'CollectionBlock' } }, style: { shape: 'circle', size: 10, color: 'neutral-400' } },
      ],
      edgeStyle: [{ style: { curve: 'orthogonal', color: 'neutral-300', arrow: 'none' } }],
      // `pin: true` is what separates a board from an explorer: a dropped node stays dropped rather
      // than being reclaimed by the layout on the next change.
      behaviours: ['pan-zoom', 'select', { type: 'drag-node', options: { pin: true } }],
      // And `lock` rather than `pin`: every card is placed already, so there is nothing to hold, and
      // the risk worth guarding against is rearranging somebody else's board by accident.
      controls: ['zoom-in', 'zoom-out', 'fit', 'lock'],
    },
  },
];

export const LAYOUTS = ['force', 'tree', 'radial', 'grid', 'manual'] as const;

/**
 * The edge shapes, for the picker.
 *
 * Worth being able to flip between on a live graph rather than choosing from a description: which one
 * reads best depends on how dense the graph is and how much the layout is already saying, and that is
 * not a judgement anybody makes correctly from a name.
 */
export const CURVES = ['arc', 'straight', 'smooth', 'step'] as const;
