import type { RouteSchema, SchemaNode } from '@we/schema-shared';

/**
 * The graph route — three graphs over the same space, switchable.
 *
 * A demonstration rather than a feature, and deliberately so: the point of the engine is that the
 * difference between a knowledge map, a schema map and a content tree is *configuration*, not code.
 * Putting all three behind one toggle makes that claim checkable in ten seconds, and each mode is a
 * complete example an author can copy.
 *
 * The layout picker is separate from the mode picker for the same reason. Changing the layout does
 * not reload the graph — it rearranges what is already there — so the two controls demonstrate the
 * two halves of the spec independently.
 */

/** Modes offered, in the order they answer "what is in this space?" from coarsest to finest. */
const MODES = [
  { value: 'schema', label: 'Schema' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'content', label: 'Content' },
] as const;

const LAYOUTS = [
  { value: 'force', label: 'Force' },
  { value: 'tree', label: 'Tree' },
  { value: 'radial', label: 'Radial' },
  { value: 'grid', label: 'Grid' },
] as const;

/** Layout spec built from the picker, so every mode honours the same choice. */
const layoutSpec = {
  type: { $local: 'layout' },
  options: {
    $if: {
      condition: { $eq: [{ $local: 'layout' }, 'tree'] },
      then: { direction: 'right', levelGap: 200 },
      else: { distance: 130 },
    },
  },
};

/**
 * The space's own vocabulary — one node per entity type.
 *
 * First because it works in every space including an empty one: it draws the shapes, not the records,
 * so it says something useful before anybody has written anything.
 */
const schemaGraph: SchemaNode = {
  type: 'GraphView',
  props: {
    seeds: { source: 'schema' },
    expansion: { defaultDepth: 0 },
    layout: layoutSpec,
    nodeStyle: [
      { style: { shape: 'rect', size: 18, color: 'primary-500' } },
      { when: { 'data.relations': { gt: 2 } }, style: { size: 26, color: 'primary-700' } },
      { when: { 'data.relations': 0 }, style: { color: 'neutral-400' } },
    ],
    edgeStyle: [{ style: { showLabel: true, arrow: 'target' } }],
    behaviours: ['pan-zoom', 'select', { type: 'drag-node' }],
    height: '100%',
    onNodeClick: { $setLocal: 'selected', from: '$event' },
  },
};

/** Posts and what they connect to, one hop out, expandable by double-click. */
const knowledgeGraph: SchemaNode = {
  type: 'GraphView',
  props: {
    seeds: { source: 'query', options: { entity: 'Post', limit: 40 } },
    expansion: { defaultDepth: 1, direction: 'out', limit: 20, maxNodes: 500 },
    layout: layoutSpec,
    nodeStyle: [
      { style: { size: 12, color: 'neutral-400' } },
      { when: { type: 'Post' }, style: { size: 20, color: 'primary-500' } },
      { when: { kind: 'literal' }, style: { shape: 'rect', size: 10, color: 'neutral-300' } },
      { when: { unresolved: true }, style: { color: 'neutral-200' } },
    ],
    edgeStyle: [{ style: { curve: 'bezier', arrow: 'target' } }],
    behaviours: ['pan-zoom', 'select', 'expand-on-double-click', { type: 'drag-node' }],
    height: '100%',
    onNodeClick: { $setLocal: 'selected', from: '$event' },
  },
};

/** Collections and their children, drilling into nested collections as you open them. */
const contentGraph: SchemaNode = {
  type: 'GraphView',
  props: {
    seeds: { source: 'query', options: { entity: 'CollectionBlock', limit: 30 } },
    expansion: { defaultDepth: 1, direction: 'out', expanders: ['collection'], maxNodes: 400 },
    layout: layoutSpec,
    nodeStyle: [
      { style: { size: 10, color: 'neutral-400', shape: 'rect' } },
      { when: { type: 'CollectionBlock' }, style: { size: 18, color: 'primary-500' } },
      { when: { 'data.kind': 'call' }, style: { color: 'success-500' } },
      { when: { 'data.kind': 'notes' }, style: { color: 'warning-500' } },
    ],
    edgeStyle: [{ style: { curve: 'orthogonal', color: 'neutral-200' } }],
    behaviours: ['pan-zoom', 'select', 'expand-on-double-click'],
    height: '100%',
    onNodeClick: { $setLocal: 'selected', from: '$event' },
  },
};

/** A segmented picker, built from a list so the two rows cannot drift apart. */
const picker = (field: string, options: readonly { value: string; label: string }[]): SchemaNode => ({
  type: 'Row',
  props: { gap: '100', bg: 'neutral-100', r: '300', p: '100' },
  children: options.map((option) => ({
    type: 'we-button',
    props: {
      size: 'sm',
      variant: { $if: { condition: { $eq: [{ $local: field }, option.value] }, then: 'primary', else: 'ghost' } },
      onClick: { $setLocal: field, value: option.value },
    },
    children: [option.label],
  })),
});

export const graphRoute: RouteSchema = {
  path: '/graph',
  type: 'Column',
  props: { width: '100%', height: '100%', gap: '0' },
  $localState: {
    mode: { type: 'string', initial: 'schema' },
    layout: { type: 'string', initial: 'force' },
    // Holds the last clicked node so the detail strip has something to read. An object rather than
    // scalars because it is one thing that arrives whole from the event.
    selected: { type: 'object', initial: null },
  },
  children: [
    {
      type: 'Row',
      props: {
        width: '100%',
        ax: 'between',
        ay: 'center',
        px: '400',
        py: '300',
        gap: '300',
        borderBottom: '1px solid neutral-200',
      },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [{ type: 'we-text', props: { variant: 'heading-sm' }, children: ['Graph'] }, picker('mode', MODES)],
        },
        picker('layout', LAYOUTS),
      ],
    },

    {
      type: 'Column',
      props: { width: '100%', flex: '1', position: 'relative', overflow: 'hidden' },
      children: [
        {
          type: '$if',
          props: { condition: { $eq: [{ $local: 'mode' }, 'schema'] }, then: schemaGraph },
        },
        {
          type: '$if',
          props: { condition: { $eq: [{ $local: 'mode' }, 'knowledge'] }, then: knowledgeGraph },
        },
        {
          type: '$if',
          props: { condition: { $eq: [{ $local: 'mode' }, 'content'] }, then: contentGraph },
        },
      ],
    },

    {
      type: '$if',
      props: {
        condition: { $local: 'selected' },
        then: {
          type: 'Row',
          props: {
            width: '100%',
            gap: '300',
            ay: 'center',
            px: '400',
            py: '300',
            bg: 'neutral-50',
            borderTop: '1px solid neutral-200',
          },
          children: [
            { type: 'we-badge', children: [{ $local: 'selected.type' }] },
            { type: 'we-text', props: { fontWeight: '600' }, children: [{ $local: 'selected.label' }] },
            {
              type: 'we-button',
              props: { size: 'xs', variant: 'ghost', onClick: { $setLocal: 'selected', value: null } },
              children: [{ type: 'we-icon', props: { name: 'x' } }],
            },
          ],
        },
      },
    },
  ],
};
