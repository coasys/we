import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { recordFormModal } from '@we/template-kit';

import { boardBar, boardCanvas, boardQuery } from './Board';
import { openCardModal } from './CardModal';
import { edgeDetailModal } from './EdgeDetail';
import { clearOnEmptySelection, expandRequest, nodeDetailPanel, selectNode } from './NodeDetail';

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
  options: { $: "local.layout == 'tree' ? { direction: 'right', levelGap: 200 } : { distance: 130 }" },
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
    // `pan-zoom` last: it is the background fallback, and it claims a press on empty canvas — listed
    // before `select`, that press never reaches selection and clicking the background cannot clear it.
    behaviours: ['node-double-click', 'select', { type: 'drag-node' }, 'pan-zoom'],
    height: '100%',
    revision: { $local: 'revision' },
    onNodeClick: selectNode,
    onSelectionChange: clearOnEmptySelection,
    onNodeDoubleClick: { $setLocal: 'cardOpen', value: true },
    expandRequest,
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
      /*
        One rule per kind this community has named — the payoff of the middle tier.

        A free-text label can only be read; a named kind can be *seen*, and a map whose vocabulary
        is legible at a glance is a different instrument from one where every line has to be read to
        be understood. `directed` decides the arrowhead, because "contradicts" is asymmetric and
        "related to" is not, and drawing a head on the second asserts something nobody meant.

        Nested inside the list rather than appended to it: a schema cannot merge two arrays —
        `$concat` joins strings — so rule lists flatten one level precisely so a `$map` over data can
        contribute rules alongside hand-written ones.
      */
      {
        $: "local.relationshipKinds.map(item, { when: { 'data.relationshipTypeId': item.id }, style: { showLabel: true, width: 2, color: item.color, arrow: item.directed ? 'target' : 'none' } })",
      },
    ],
    behaviours: [
      // Before drag-node, which is what makes arming mean anything: both claim a press on a node.
      { type: 'connect-nodes', options: { armed: { $local: 'connecting' } } },
      // `select` before `pan-zoom`, which is the background fallback: pan-zoom claims a press on the
      // background, and dispatch stops at the first behaviour that claims — so listing it first left
      // `select` never seeing a background press, and clicking empty canvas could not deselect.
      'select',
      /*
        Double-click opens the record rather than expanding it.

        `expand-on-double-click` claims the same gesture, and only the first of them sees it — so
        this is a choice, not an ordering accident. Opening is what the gesture means everywhere else
        in the app, and expansion has its own affordances in the panel: Relations and Fields, which
        say which question they answer where a double-click cannot.
      */
      'node-double-click',
      { type: 'drag-node' },
      'pan-zoom',
    ],
    height: '100%',
    revision: { $local: 'revision' },
    onNodeClick: selectNode,
    onSelectionChange: clearOnEmptySelection,
    onNodeDoubleClick: { $setLocal: 'cardOpen', value: true },
    expandRequest,
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
    // Keeps `expand-on-double-click` where the other modes take `node-double-click`: drilling in *is*
    // this mode. So no open handler either — it would be config that could never fire, since only
    // one behaviour ever sees the gesture. The panel's Open button still reaches a document here.
    behaviours: ['select', 'expand-on-double-click', 'pan-zoom'],
    height: '100%',
    revision: { $local: 'revision' },
    onNodeClick: selectNode,
    onSelectionChange: clearOnEmptySelection,
    expandRequest,
  },
};

/** A segmented picker, built from a list so the two rows cannot drift apart. */
const picker = (field: string, options: readonly { value: string; label: string }[]): SchemaNode => ({
  type: 'Row',
  props: { gap: '100', bg: 'surface-sunken', r: '300', p: '100' },
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

export const graphView: TemplateSchema = {
  meta: {
    name: 'Graph',
    description: 'The same space read as a map — what it holds, and how it connects',
    icon: 'graph',
    role: 'view',
    segment: 'graph',
  },
  type: 'Column',
  props: { width: '100%', height: '100%', gap: '0' },
  /*
    Hoisted rather than left on the picker: the empty state has to count the same boards the picker
    lists, and two subscriptions could disagree about how many there are.

    `relationshipKinds` is here for a different reason — the knowledge map's edge styles are built
    from it, and a style rule is a prop rather than a child, so it has to resolve where the graph is
    declared rather than somewhere inside it.
  */
  $queries: { boards: boardQuery, relationshipKinds: { entity: 'RelationshipType', order: { name: 'asc' } } },
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
      Whether the board's key is open.

      A preference rather than view state: somebody sent a link to a board, and the recipient should
      see the board rather than whichever panels the sender had open. Kept per device instead, since
      a person who wants the key generally wants it every time.
    */
    legendOpen: { type: 'boolean', initial: false, persist: 'board.keyOpen' },
    /*
      Which kind of expansion the panel last asked for, and the whole of the request's state.

      A kind rather than the request itself, because `$setLocal`'s `value` is a literal — a token
      inside it is stored as the token — so a button cannot write the selected node's id into an
      object. The request is composed from this plus the selection; see `NodeDetail`.
    */
    expandKind: { type: 'string', initial: '' },
    /*
      Which board is open, mirrored into the URL.

      View state in the strict sense: someone sent a link to a board, and the recipient should see
      the board rather than a picker. `push` so the browser's Back button steps between boards, the
      way it steps between the modes.
    */
    boardId: { type: 'string', initial: '', syncParam: { name: 'board', push: true } },
    newBoardOpen: { type: 'boolean', initial: false },
    newCardOpen: { type: 'boolean', initial: false },
    /** Where a double-click landed, so the card it opens can be placed there. Null from the toolbar. */
    newCardAt: { type: 'object', initial: null },
    /*
      Whether the selected card is open for reading.

      A flag rather than an id, because there is nowhere to copy an id to: `$setLocal`'s `value` is a
      literal and its `from` reads the event. Binding the modal to the selection is the better answer
      anyway — it always shows the node that is selected and cannot drift from it.
    */
    cardOpen: { type: 'boolean', initial: false },
    /** The detail panel was dismissed. Cleared whenever something is selected — see `selectNode`. */
    panelClosed: { type: 'boolean', initial: false },
    /*
      Bumped after a record is created, which tells the graph to re-read and merge.

      Belt and braces beside the live watches the engine holds: a watch depends on the backend
      reporting the write, and this is the one case where the template *knows* something changed
      because it is what changed it. The graph merges either way, so the update arriving twice costs
      a query and changes nothing on screen.
    */
    revision: { type: 'number', initial: 0 },
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
        borderBottom: '1px solid border',
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
                  Connect mode, on the knowledge map. The board has its own, in the board bar with
                  the rest of its controls.

                  The schema map draws types rather than records, and the content tree draws
                  containment somebody else's data already states — neither has anything a person's
                  own connection would attach to. Offering the toggle there would arm a gesture whose
                  save could not succeed.
                */
                {
                  type: '$if',
                  props: {
                    condition: { $: "local.mode == 'knowledge'" },
                    then: {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: { $: "local.connecting ? 'primary' : 'ghost'" },
                        onClick: { $toggleLocal: 'connecting' },
                      },
                      children: [{ type: 'we-icon', props: { name: 'flow-arrow' } }, 'Connect'],
                    },
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: "local.mode == 'board'" },
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
                  do with a type on that map was look at it.

                  Hidden when the space has no authorable models at all, since a button whose menu is
                  empty teaches people it is broken — and on a board, where `Record` in the board bar
                  is the same form and *places* what it makes.

                  It was hidden on boards once before and restored, because at the time this was the
                  only way to create a model instance anywhere and removing the sole entry point to a
                  capability leaves somebody with no way to do it at all. `Record` is that entry
                  point now, so the objection has been answered rather than overruled: two buttons
                  opening the same form, one of which quietly makes something that does not appear
                  where you made it, is worse than one button that works.
                */
                {
                  type: '$if',
                  props: {
                    condition: { $: "local.mode != 'board' && count(recordStore.creatableEntities)" },
                    then: {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: 'secondary',
                        // `args` given explicitly, and not omitted: a `$action` with no args forwards
                        // the handler's own arguments, so the button would call this with the click
                        // event as its optional `entity`. The store guards against that too — this is
                        // the call site saying what it means.
                        onClick: { $action: 'recordStore.openRecordForm', args: [''] },
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
    recordFormModal({ onCreated: [{ $setLocal: 'revision', by: 1 }] }),

    {
      type: 'Column',
      /*
        No background here, deliberately.

        A `bg` on this container is dead: `GraphView` paints its own, defaulting to `neutral-0`, and
        covers whatever is behind it. A template that wants a different canvas colour sets the
        graph's `bg` prop — putting one here looks like it works and does nothing, which is how the
        detail panel ended up the same colour as the canvas it sits on.
      */
      props: { width: '100%', flex: '1', position: 'relative', overflow: 'hidden' },
      children: [
        {
          type: '$if',
          props: { condition: { $: "local.mode == 'schema'" }, then: schemaGraph },
        },
        {
          type: '$if',
          props: { condition: { $: "local.mode == 'knowledge'" }, then: knowledgeGraph },
        },
        {
          type: '$if',
          props: { condition: { $: "local.mode == 'content'" }, then: contentGraph },
        },
        {
          type: '$if',
          props: { condition: { $: "local.mode == 'board'" }, then: boardCanvas },
        },
        // Inside the graph container, not after it: the panel overlays the canvas rather than
        // taking a slice of the route, which is what keeps the camera still when it opens.
        nodeDetailPanel,
      ],
    },

    openCardModal,

    edgeDetailModal,
  ],
};
