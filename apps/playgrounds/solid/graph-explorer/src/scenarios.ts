/**
 * The scenarios, as specs.
 *
 * Each is exactly what a template would write — no harness-only escape hatches — so what you see
 * here is what an author gets. Between them they cover every extension axis: seeds, expanders,
 * layouts, styling, behaviours.
 */
import type { GraphSpec } from '@we/graph-protocol';

export interface Scenario {
  id: string;
  label: string;
  /** What to look at, and what would be wrong. */
  note: string;
  spec: GraphSpec;
}

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
    note: 'Beliefs one hop out. Double-click any node to expand it further; double-click again to collapse. Watch the author nodes converge — two beliefs by one person reach the same node.',
    spec: {
      seeds: { source: 'query', options: { entity: 'Belief', limit: 20, relations: ['author', 'topic'] } },
      expansion: { defaultDepth: 0, direction: 'both', limit: 25, maxNodes: 300 },
      layout: { type: 'force' },
      nodeStyle: [
        { style: { size: 12, color: 'neutral-400' } },
        { when: { type: 'Belief' }, style: { size: 20, color: 'primary-500' } },
        { when: { type: 'Agent' }, style: { size: 18, color: 'success-500' } },
        { when: { type: 'Topic' }, style: { size: 22, color: 'warning-500', shape: 'rect' } },
        { when: { type: 'Task' }, style: { color: 'danger-500' } },
        { when: { unresolved: true }, style: { color: 'neutral-200' } },
      ],
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
      nodeStyle: [
        { style: { size: 12, color: 'neutral-400' } },
        { when: { type: 'Topic' }, style: { size: 26, color: 'warning-500' } },
        { when: { type: 'Belief' }, style: { color: 'primary-500' } },
        { when: { type: 'Task' }, style: { color: 'danger-500' } },
        { when: { type: 'Question' }, style: { color: 'success-500' } },
      ],
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
];

export const LAYOUTS = ['force', 'tree', 'radial', 'grid'] as const;
