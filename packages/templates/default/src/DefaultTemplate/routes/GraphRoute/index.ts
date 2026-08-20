import type { RouteSchema, SchemaNode } from '@we/schema-shared';
import { recordFormModal } from '@we/template-kit';

import { boardBar, boardCanvas, boardQuery } from './Board';
import { edgeDetailModal } from './EdgeDetail';

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
  // Last, and different in kind from the three before it: those derive an arrangement from the
  // data, and this one is the arrangement.
  { value: 'board', label: 'Board' },
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
    revision: { $local: 'revision' },
    onNodeClick: { $setLocal: 'selected', from: '$event' },
  },
};

/**
 * The things people made, and what they connect to — one hop out, expandable by double-click.
 *
 * Seeded on `CollectionBlock`, because **there is no `Post` entity in WE.** A post is a
 * `CollectionBlock` with `type: 'root'`, which is exactly what the cards route queries. The seed
 * named `Post` for as long as this route existed and failed the only way it could — the registry
 * had nothing under that name, so the mode showed a toast and no graph.
 *
 * Worth noticing that the toast was right and the route was wrong. A seed naming an entity that
 * does not exist is an authoring error, and the query layer surfacing it rather than rendering an
 * empty canvas is what let it be found at all.
 */
const knowledgeGraph: SchemaNode = {
  type: 'GraphView',
  props: {
    /*
      Two seeds: what people made, and what they have said about how it relates.

      `Relationship` is seeded rather than only expanded into, because a connection nobody has
      opened a node to find is still a thing the community asserted, and a knowledge map that only
      showed connections you had gone looking for would hide exactly the ones you did not know about.
      It draws as an edge rather than a node — see `reified` on GraphView — so seeding it adds lines,
      not dots.
    */
    seeds: [
      { source: 'query', options: { entity: 'CollectionBlock', limit: 40 } },
      { source: 'query', options: { entity: 'Relationship', limit: 60 } },
    ],
    expansion: { defaultDepth: 1, direction: 'out', limit: 20, maxNodes: 500 },
    layout: layoutSpec,
    nodeStyle: [
      { style: { size: 12, color: 'neutral-400' } },
      { when: { type: 'CollectionBlock' }, style: { size: 20, color: 'primary-500' } },
      { when: { kind: 'literal' }, style: { shape: 'rect', size: 10, color: 'neutral-300' } },
      { when: { unresolved: true }, style: { color: 'neutral-200' } },
    ],
    edgeStyle: [
      { style: { curve: 'arc', arrow: 'target' } },
      // A drawn connection carries somebody's own words, so it says them. Heavier and coloured
      // because the distinction that matters on this map is "a schema says so" against "a person
      // says so", and the second is the one worth arguing with.
      { when: { type: 'relates' }, style: { showLabel: true, color: 'primary-500', width: 2 } },
    ],
    behaviours: [
      // Before drag-node, which is what makes arming mean anything: both claim a press on a node.
      { type: 'connect-nodes', options: { armed: { $local: 'connecting' } } },
      'pan-zoom',
      'select',
      'expand-on-double-click',
      { type: 'drag-node' },
    ],
    height: '100%',
    revision: { $local: 'revision' },
    onNodeClick: { $setLocal: 'selected', from: '$event' },
    onEdgeClick: { $setLocal: 'selectedEdge', from: '$event' },
    // Straight to the store: it opens the same record form every other model uses, on
    // `Relationship`, holding the two ends the gesture produced.
    onEdgeCreate: { $action: 'recordStore.connectNodes', args: ['$event'] },
  },
};

/**
 * Collections and their children, drilling into nested collections as you open them.
 *
 * Also where a call's extraction shows up. Opening a call now yields two visibly different kinds of
 * child: the utterances somebody said, and the tasks and events a model found in them. Styling them
 * apart is the whole point of looking at this as a graph rather than a list — you can see structure
 * precipitating out of conversation, and see which node it came from.
 */
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
      // Extracted records, after the collection rules so a call keeps its own colour. Circles
      // against the rectangles of composed blocks: the distinction that matters at a glance is
      // "somebody wrote this" against "something was inferred from it", and shape carries that
      // without depending on colour being legible in the viewer's theme.
      { when: { type: 'TaskBlock' }, style: { shape: 'circle', size: 14, color: 'primary-600' } },
      { when: { type: 'EventBlock' }, style: { shape: 'circle', size: 14, color: 'warning-600' } },
    ],
    edgeStyle: [{ style: { curve: 'step', color: 'neutral-200' } }],
    behaviours: ['pan-zoom', 'select', 'expand-on-double-click'],
    height: '100%',
    revision: { $local: 'revision' },
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
  // Hoisted rather than left on the picker: the empty state has to count the same boards the picker
  // lists, and two subscriptions could disagree about how many there are.
  $queries: { boards: boardQuery },
  $localState: {
    mode: { type: 'string', initial: 'schema' },
    layout: { type: 'string', initial: 'force' },
    // Holds the last clicked node so the detail strip has something to read. An object rather than
    // scalars because it is one thing that arrives whole from the event.
    selected: { type: 'object', initial: null },
    /** The last clicked edge, for the strip that reads a drawn connection back. */
    selectedEdge: { type: 'object', initial: null },
    /*
      Whether dragging a node means connecting it rather than moving it.

      A mode with a visible control rather than a modifier key. The modifiers are taken or do not
      travel — shift extends the selection, and there are none at all on a touchscreen — and a
      gesture nobody can discover is a gesture nobody uses. It also gives the reader somewhere to
      see which of the two things a drag is about to do.
    */
    connecting: { type: 'boolean', initial: false },
    /*
      Which board is open, mirrored into the URL.

      View state in the strict sense: someone sent a link to a board, and the recipient should see
      the board rather than a picker. `push` so the browser's Back button steps between boards, the
      way it steps between the modes.
    */
    boardId: { type: 'string', initial: '', syncParam: { name: 'board', push: true } },
    newBoardOpen: { type: 'boolean', initial: false },
    newCardOpen: { type: 'boolean', initial: false },
    /*
      Flipped after a record is created, which tells the graph to re-read and merge.

      A boolean rather than a counter because the schema language has no arithmetic — `$toggleLocal`
      is the whole of "something happened", and the graph only compares the value to the last one.

      Belt and braces beside the live watches the engine holds: a watch depends on the backend
      reporting the write, and this is the one case where the template *knows* something changed
      because it is what changed it. The graph merges either way, so the update arriving twice costs
      a query and changes nothing on screen.
    */
    revision: { type: 'boolean', initial: false },
  },
  children: [
    /*
        Chrome inside the template's column, canvas edge to edge.

        The graph fills the viewport because a map wants every pixel, but its *controls* are reading
        matter and belong on the same measure as everything else in this template — the globe route
        already does exactly this with its overlaid controls. Without it the mode picker sits hard
        against the left edge and the detail strip against the right, which reads as a different
        application rather than another route.
      */
    {
      type: 'Row',
      props: {
        width: '100%',
        ax: 'center',
        py: '300',
        borderBottom: '1px solid neutral-200',
      },
      children: [
        {
          type: 'Row',
          props: {
            width: '100%',
            maxWidth: 'var(--we-layout-lg)',
            ax: 'between',
            ay: 'center',
            px: '400',
            gap: '300',
          },
          children: [
            {
              type: 'Row',
              props: { gap: '300', ay: 'center' },
              children: [
                { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Graph'] },
                picker('mode', MODES),
              ],
            },
            {
              type: 'Row',
              props: { gap: '300', ay: 'center' },
              children: [
                /*
                  Connect mode, on the knowledge map only.

                  The schema map draws types rather than records, and the content tree draws
                  containment somebody else's data already states — neither has anything a person's
                  own connection would attach to. Offering the toggle there would arm a gesture whose
                  save could not succeed.
                */
                {
                  type: '$if',
                  props: {
                    condition: { $eq: [{ $local: 'mode' }, 'knowledge'] },
                    then: {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: { $if: { condition: { $local: 'connecting' }, then: 'primary', else: 'ghost' } },
                        onClick: { $toggleLocal: 'connecting' },
                      },
                      children: [{ type: 'we-icon', props: { name: 'flow-arrow' } }, 'Connect'],
                    },
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: { $eq: [{ $local: 'mode' }, 'board'] },
                    // A board's positions are its data, so there is no layout to choose. Its own
                    // controls — which board, and adding to it — take the same place instead.
                    then: boardBar,
                    else: picker('layout', LAYOUTS),
                  },
                },
                /*
                  Creating a record, from the map of what is in the space.

                  Here rather than in a settings page because this is where the absence is felt: the
                  schema mode draws a community's vocabulary, and until now the only thing you could
                  do with a type on that map was look at it. Hidden when the space has no authorable
                  models at all, since a button whose menu is empty teaches people it is broken.
                */
                {
                  type: '$if',
                  props: {
                    condition: { $count: { items: { $store: 'recordStore.creatableEntities' } } },
                    then: {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: 'secondary',
                        onClick: { $action: 'recordStore.openRecordForm' },
                      },
                      children: [{ type: 'we-icon', props: { name: 'plus' } }, 'New'],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },

    /*
      The form sits above the canvas rather than inside it.

      A graph is a transformed, zoomable surface, and text entry on one is its own project — the
      board work says so twice. A modal is not a compromise here: what is being authored is a
      record, which has nothing to do with where it will land.
    */
    recordFormModal({ onCreated: [{ $toggleLocal: 'revision' }] }),

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
        {
          type: '$if',
          props: { condition: { $eq: [{ $local: 'mode' }, 'board'] }, then: boardCanvas },
        },
      ],
    },

    {
      type: '$if',
      props: {
        condition: { $local: 'selected' },
        // The strip spans the window so its background and rule reach the edges; its contents sit on
        // the template's measure, like the header above. Same reasoning, same numbers.
        then: {
          type: 'Row',
          props: {
            width: '100%',
            ax: 'center',
            py: '300',
            bg: 'neutral-50',
            borderTop: '1px solid neutral-200',
          },
          children: [
            {
              type: 'Row',
              props: { width: '100%', maxWidth: 'var(--we-layout-lg)', gap: '300', ay: 'center', px: '400' },
              children: [
                { type: 'we-badge', children: [{ $local: 'selected.type' }] },
                { type: 'we-text', props: { fontWeight: '600' }, children: [{ $local: 'selected.label' }] },
                {
                  type: 'we-button',
                  props: {
                    size: 'xs',
                    variant: 'ghost',
                    ml: 'auto',
                    onClick: { $setLocal: 'selected', value: null },
                  },
                  children: [{ type: 'we-icon', props: { name: 'x' } }],
                },
              ],
            },
          ],
        },
      },
    },

    edgeDetailModal,
  ],
};
