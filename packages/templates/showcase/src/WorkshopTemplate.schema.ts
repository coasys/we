/**
 * Workshop — a call, its transcript, and what came out of it.
 *
 * The seventh showcase template, and the first that is about *panels* rather than about a content
 * arrangement. The other six demonstrate that channels, boards, playlists and events are all one
 * container seen differently; this one demonstrates that where the surfaces around the content sit
 * is also data.
 *
 * ## The screen
 *
 * A call is running. Down the left, the transcript as everyone speaks, and beneath it a readout of
 * what extraction is making of it. On the right, the call itself. In the middle, a board of the
 * records the call produced — tasks and events — which can be dragged into an arrangement and joined
 * to each other.
 *
 * Then two more routes over the same material: the tasks as a list by state, and the record of past
 * calls. **The panels change with the route**, which is the point: the board wants a transcript
 * beside it, and a task list does not.
 *
 * ## What it does not mint
 *
 * Nothing. Like the other six, this template adds no content model. The transcript is the
 * `CollectionBlock` `@we/module-transcribe` already writes (`docs/architecture/transcripts.md`), and
 * the board's cards are the `TaskBlock`s and `EventBlock`s extraction already produces from it. The
 * template is arrangement over both.
 *
 * ## Where the panels come from
 *
 * `meta.panels`, and three of the four kinds of entry it can carry:
 *
 * - **`module`** for the transcript and the call — panels those modules already contribute.
 * - **`node`** for the extraction readout, which is this template's own schema.
 * - **`route`** on all of them, because a showcase template routes itself and so has no sections to
 *   hang a declaration on.
 * - **`open: false`** on the call, because the call module's launcher action is `goToCall`, which
 *   *joins a call* when there is not one. Placed, never opened.
 */
import type { RouteSchema, SchemaNode, TemplateSchema } from '@we/schema-shared';
import { agentByline, emptyState, gatePrompt } from '@we/template-kit';

/**
 * What extraction is allowed to make from a transcript.
 *
 * The same two classes `@we/module-transcribe` names, restated because `templates → modules` is a
 * sideways edge. If that list grows, this one has to grow with it — the board would simply stop
 * showing the new kind, silently, which is the failure `docs/architecture/transcripts.md` exists to
 * make visible.
 */
const EXTRACTED = ['TaskBlock', 'EventBlock'];

/** The call whose transcript is on screen — the record the module is writing into right now. */
const CALL = { $store: 'modules.transcribe.collectionId' };

/** Routes, as segments. Compared against `routeStore.segments`, which is how `route` matches too. */
const ROUTE = { board: 'board', tasks: 'tasks', record: 'record' } as const;

const NAV = [
  { path: '/board', segment: ROUTE.board, icon: 'graph', label: 'Board' },
  { path: '/tasks', segment: ROUTE.tasks, icon: 'check-square', label: 'Tasks' },
  { path: '/record', segment: ROUTE.record, icon: 'archive', label: 'Record' },
];

/**
 * The view switcher, floating over the content.
 *
 * Chrome rather than layout: it is pinned, it sits above whatever the route renders, and the routes
 * fill the screen underneath it. `meta.chromeReserve` declares the band it occupies so floating
 * panels clear it — without that a panel snapped top-left opens underneath this.
 *
 * Centred on the content rather than the window, through `--we-chrome-center-x`. A right-hand panel
 * that displaces slides the content's centre, and a bar that ignored it would drift off-centre as
 * soon as anything opened.
 */
const switcher: SchemaNode = {
  type: 'Row',
  props: {
    position: 'fixed',
    top: '300',
    left: '50%',
    styles: { transform: 'translateX(calc(-50% + var(--we-chrome-center-x, 0px)))' },
    zIndex: 'sticky',
    gap: '100',
    p: '100',
    r: 'pill',
    bg: 'surface-raised',
    border: '1px solid border',
    shadow: 'lg',
  },
  children: [
    {
      type: '$each',
      props: { items: NAV, as: 'nav' },
      children: [
        {
          type: 'we-button',
          props: {
            size: 'sm',
            r: 'pill',
            gap: '200',
            variant: {
              $if: {
                condition: { $in: ['$nav.segment', { $store: 'routeStore.segments' }] },
                then: 'secondary',
                else: 'ghost',
              },
            },
            onClick: { $action: 'routeStore.navigate', args: ['$nav.path'] },
          },
          children: [
            { type: 'we-icon', props: { name: '$nav.icon' } },
            { type: 'we-text', children: ['$nav.label'] },
          ],
        },
      ],
    },
  ],
};

/**
 * The extraction readout — this template's own panel, supplied as a `node`.
 *
 * Two questions, and they are different: what is the model *doing*, and what has it *made*. The
 * first comes from `interpretationStore.activity`, which already carries display-ready strings and
 * covers peers' passes as well as this agent's — extraction runs on whoever's node it runs on, and a
 * readout that showed only your own would be quietly wrong in a meeting. The second is an ordinary
 * query against the call.
 *
 * Gated on `capable`, which answers "can this node interpret at all". False means no fix exists from
 * inside the app, so the panel says so rather than offering a control that cannot work.
 */
const extractionPanel: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', p: '300', gap: '300', overflow: 'hidden' },
  children: [
    {
      type: '$if',
      props: {
        condition: { $store: 'interpretationStore.capable' },
        then: {
          type: 'Column',
          props: { width: '100%', flex: '1', minHeight: '0', gap: '300' },
          children: [
            // What is running, if anything. `activity` is empty in the ordinary case, which means
            // "nothing is happening" rather than "not supported" — hence the separate `capable` gate
            // above, and no empty state here.
            {
              type: '$each',
              props: { items: { $store: 'interpretationStore.activity' }, as: 'pass' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center', bg: 'surface-sunken', r: '300', px: '300', py: '200' },
                  children: [
                    {
                      type: '$if',
                      props: {
                        condition: '$pass.running',
                        then: { type: 'we-spinner', props: { size: 'xs' } },
                        else: { type: 'we-icon', props: { name: 'check', color: 'success-text' } },
                      },
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', flex: '1', truncate: true },
                      children: ['$pass.label'],
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-faint' },
                      children: ['$pass.elapsed'],
                    },
                  ],
                },
              ],
            },
            {
              type: 'we-text',
              props: { variant: 'label', color: 'text-muted', textTransform: 'uppercase', letterSpacing: 'wide' },
              children: ['Extracted'],
            },
            {
              type: 'we-scroll-area',
              props: { flex: '1', minHeight: '0' },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: CALL,
                    then: {
                      type: 'Column',
                      props: { gap: '200' },
                      children: [
                        {
                          type: '$each',
                          props: {
                            items: {
                              $query: {
                                entity: 'TaskBlock',
                                scope: { anchor: 'CollectionBlock', via: 'children', anchorId: CALL },
                                // Newest first: this is a "what just happened" readout, not a record.
                                order: { createdAt: 'desc' },
                                limit: 12,
                              },
                            },
                            as: 'item',
                          },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center', bg: 'surface-sunken', r: '300', px: '300', py: '200' },
                              children: [
                                { type: 'we-icon', props: { name: 'check-square', color: 'accent-text' } },
                                {
                                  type: 'we-text',
                                  props: { variant: 'footnote', flex: '1', truncate: true },
                                  children: ['$item.title'],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    else: emptyState({ icon: 'sparkle', label: 'extracted records' }),
                  },
                },
              ],
            },
          ],
        },
        else: {
          // A property of the node rather than a failure, so it says so plainly instead of offering
          // a control that cannot work from here. Not `emptyState`, which describes an empty list —
          // this list is not empty, it is unavailable.
          type: 'Column',
          props: { ax: 'center', ay: 'center', gap: '200', p: '400', flex: '1' },
          children: [
            { type: 'we-icon', props: { name: 'plugs', size: 'lg', color: 'text-faint' } },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint', textAlign: 'center' },
              children: ['This node has no model configured, so nothing can be extracted from a call.'],
            },
          ],
        },
      },
    },
  ],
};

/**
 * The board — what the call produced, arranged.
 *
 * The `board` seed over the call's own collection: its contents at the positions somebody put them.
 * `contains` narrows it to what extraction makes, because the collection's children are *also* every
 * utterance, and a board of six hundred transcript fragments is not a board.
 *
 * `manual` layout parks anything without a placement in a grid, which is what makes a freshly
 * extracted record appear somewhere sensible rather than stacked at the origin. Dragging pins it and
 * `onNodeDragEnd` writes that back — without which the board is a layout that forgets, silently,
 * until the next reload.
 */
const board: SchemaNode = {
  type: 'GraphView',
  props: {
    seeds: {
      source: 'board',
      options: { board: CALL, contains: EXTRACTED, connections: 'Relationship' },
    },
    // Nothing opens automatically: a card's own blocks are fragments of it, not more cards.
    expansion: { defaultDepth: 0 },
    layout: { type: 'manual' },
    nodeStyle: [
      { style: { shape: 'card', width: 180, content: 'block', contentMinZoom: 0.5 } },
      { when: { type: 'TaskBlock' }, style: { color: 'primary-50', labelColor: 'primary-800' } },
      { when: { type: 'EventBlock' }, style: { color: 'warning-50', labelColor: 'warning-800' } },
      // The card's own presentation, in front of the rules above — a size and colour somebody chose
      // is a fact about the card, where the rules are this template's opinion about a kind.
      {
        style: {
          width: { from: 'data.boardWidth' },
          height: { from: 'data.boardHeight' },
          color: { from: 'data.boardColor' },
        },
      },
    ],
    behaviours: [
      // Before drag-node, which is what makes arming mean anything: both claim a press on a node.
      { type: 'connect-nodes', options: { armed: { $local: 'connecting' } } },
      'select',
      { type: 'drag-node', options: { pin: true } },
      // Last, because it is the background fallback — listed earlier it claims the press `select`
      // needs to see, and clicking empty canvas silently stops clearing the selection.
      'pan-zoom',
    ],
    edgeStyle: [{ style: { curve: 'smooth', arrow: 'target', width: 2, showLabel: true } }],
    controls: ['zoom-in', 'zoom-out', 'fit', 'lock'],
    height: '100%',
    // Connecting two records means the same thing wherever the line was drawn, so it goes through
    // the same store call the knowledge map makes and ends in the same form.
    onEdgeCreate: { $action: 'recordStore.connectNodes', args: ['$event'] },
    /*
      The drop, written back — an upsert against the *board* rather than an update of the record.

      A coordinate is a fact about the pair, so the same task can sit on two boards in two places and
      the record never learns it was on one. `recordId`/`recordType` rather than the node's address:
      the graph names a node `we-graph://entity/<dataset>/<type>/<id>` and a template has no operator
      that could take that apart.
    */
    onNodeDragEnd: {
      $action: 'recordStore.placeOnBoard',
      args: [CALL, '$event.recordId', '$event.recordType', '$event.x', '$event.y'],
    },
    onNodeResize: { $action: 'recordStore.resizeOnBoard', args: [CALL, '$event'] },
  },
};

const boardRoute: RouteSchema = {
  path: '/board',
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $localState: { connecting: { type: 'boolean', initial: false } },
  children: [
    {
      type: '$if',
      props: {
        condition: CALL,
        then: board,
        // No collection means nothing has been said yet — the record is created on the first
        // utterance, so its absence is exactly "this call has produced nothing".
        else: gatePrompt({
          icon: 'graph',
          iconColor: 'text-faint',
          title: 'Nothing to arrange yet',
          body: 'Start a call and turn on recording. What the conversation produces appears here as cards you can move and join up.',
        }),
      },
    },
  ],
};

/** The states a task moves through. `status` is a closed vocabulary the model fills from. */
const COLUMNS = [
  { status: 'todo', label: 'To do', color: 'text-muted' },
  { status: 'in-progress', label: 'In progress', color: 'accent-text' },
  { status: 'done', label: 'Done', color: 'success-text' },
];

/**
 * The tasks, by state.
 *
 * Read off `status` rather than off containment, which is the distinction `TasksView` already draws
 * and is worth keeping: a kanban board's columns are collections and moving a card is a relink,
 * while a task's state is a property of the task. Extraction fills `status`, so these columns are
 * populated by the conversation rather than by anyone dragging.
 *
 * Every task in the space, not only this call's — the point of the list is what is outstanding, and
 * a task does not stop being outstanding because the meeting it came from ended.
 */
const tasksRoute: RouteSchema = {
  path: '/tasks',
  type: 'Column',
  props: { width: '100%', minHeight: '100%', ax: 'center', px: '400', pt: '900', pb: '600' },
  children: [
    {
      type: 'Grid',
      props: { width: '100%', maxWidth: 'var(--we-layout-lg)', minChildWidth: '260px', gap: '400' },
      children: [
        {
          type: '$each',
          props: { items: COLUMNS, as: 'column' },
          children: [
            {
              type: 'Column',
              props: { gap: '300', bg: 'surface', r: '400', border: '1px solid border', p: '400' },
              $queries: {
                tasks: { entity: 'TaskBlock', where: { status: '$column.status' }, order: { createdAt: 'desc' } },
              },
              children: [
                {
                  type: 'Row',
                  props: { ay: 'center', gap: '200' },
                  children: [
                    {
                      type: 'we-text',
                      props: { variant: 'label', color: '$column.color' },
                      children: ['$column.label'],
                    },
                    {
                      type: 'we-badge',
                      props: { size: 'xs' },
                      children: [{ $count: { items: { $local: 'tasks' } } }],
                    },
                  ],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $count: { items: { $local: 'tasks' } } },
                    then: {
                      type: 'Column',
                      props: { gap: '300' },
                      children: [
                        {
                          type: '$each',
                          props: { items: { $local: 'tasks' }, as: 'task' },
                          children: [
                            {
                              type: 'Column',
                              props: { gap: '200', bg: 'surface-sunken', r: '300', p: '300' },
                              children: [
                                { type: 'we-text', props: { fontWeight: 'medium' }, children: ['$task.title'] },
                                {
                                  type: '$if',
                                  props: {
                                    condition: '$task.description',
                                    then: {
                                      type: 'we-text',
                                      props: { variant: 'footnote', color: 'text-muted' },
                                      children: ['$task.description'],
                                    },
                                  },
                                },
                                {
                                  type: 'Row',
                                  props: { ay: 'center', ax: 'between', gap: '200', wrap: true },
                                  children: [
                                    // Who wrote it — which for an extracted task is whoever's node
                                    // ran the pass, so it answers "where did this come from".
                                    agentByline({ did: '$task.author', as: 'author', avatarSize: 'xxs' }),
                                    {
                                      type: '$if',
                                      props: {
                                        condition: '$task.dueDate',
                                        then: {
                                          type: 'we-timestamp',
                                          props: { value: '$task.dueDate', fontSize: '100', color: 'text-faint' },
                                        },
                                      },
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    else: {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-faint', italic: true },
                      children: ['Nothing here.'],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/**
 * The record — past calls, and what was said in them.
 *
 * The counterpart to the live transcript panel: that one follows the call happening now, this one is
 * for going back. Both read the same collections, which is the whole argument of this package
 * repeated one level down — a live feed and an archive are the same records seen differently.
 */
const recordRoute: RouteSchema = {
  path: '/record',
  type: 'Column',
  props: { width: '100%', minHeight: '100%', ax: 'center', px: '400', pt: '900', pb: '600' },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: 'var(--we-layout-md)', gap: '400' },
      $queries: {
        calls: { entity: 'CollectionBlock', where: { kind: 'call' }, order: { createdAt: 'desc' }, limit: 30 },
      },
      children: [
        {
          type: '$if',
          props: {
            condition: { $count: { items: { $local: 'calls' } } },
            then: {
              type: 'Column',
              props: { gap: '400' },
              children: [
                {
                  type: '$each',
                  props: { items: { $local: 'calls' }, as: 'call' },
                  children: [
                    {
                      type: 'Column',
                      props: { bg: 'surface', r: '400', border: '1px solid border', p: '400', gap: '300' },
                      $localState: { open: { type: 'boolean', initial: false } },
                      children: [
                        {
                          type: 'we-button',
                          props: { variant: 'bare', width: '100%', onClick: { $toggleLocal: 'open' } },
                          children: [
                            {
                              type: 'Row',
                              props: { width: '100%', ay: 'center', gap: '300' },
                              children: [
                                { type: 'we-icon', props: { name: 'phone-call', color: 'accent-text' } },
                                {
                                  type: 'we-timestamp',
                                  props: { value: '$call.createdAt', relative: true, flex: '1' },
                                },
                                {
                                  type: 'we-icon',
                                  props: {
                                    name: {
                                      $if: { condition: { $local: 'open' }, then: 'caret-up', else: 'caret-down' },
                                    },
                                    color: 'text-faint',
                                  },
                                },
                              ],
                            },
                          ],
                        },
                        {
                          // $animate rather than $if: the transcript below holds a live subscription,
                          // and collapsing must not tear it down and refetch on every toggle.
                          type: '$animate',
                          props: {
                            condition: { $local: 'open' },
                            enterTransition: { type: 'reveal', duration: 250 },
                          },
                          children: [
                            {
                              type: 'Column',
                              props: { gap: '300', pt: '300' },
                              children: [
                                {
                                  type: '$each',
                                  props: {
                                    items: {
                                      $query: {
                                        entity: 'TextBlock',
                                        scope: { anchor: 'CollectionBlock', via: 'children', anchorId: '$call.id' },
                                        // Oldest first: a transcript read backwards is not a transcript.
                                        order: { createdAt: 'asc' },
                                      },
                                    },
                                    as: 'utterance',
                                  },
                                  children: [
                                    agentByline({
                                      did: '$utterance.author',
                                      as: 'speaker',
                                      stacked: true,
                                      nameColor: 'text-muted',
                                      timestamp: '$utterance.createdAt',
                                      children: [
                                        { type: 'we-text', props: { color: 'text' }, children: ['$utterance.text'] },
                                      ],
                                    }),
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            else: emptyState({ icon: 'archive', label: 'recorded calls' }),
          },
        },
      ],
    },
  ],
};

export const workshopTemplate: TemplateSchema = {
  meta: {
    name: 'Workshop',
    description: 'A call, its transcript, and what came out of it — as a board, a task list and a record.',
    icon: 'compass-tool',
    /*
      The band the floating switcher occupies, so panels clear it.

      Its collapsed height, as the contract asks: the bar is a row of `sm` buttons in a padded pill,
      and it never grows. The width is generous on purpose — over-reporting costs a panel that moves
      slightly earlier than it had to, and under-reporting puts two things on top of each other.
    */
    chromeReserve: { top: 64, width: 420 },
    /*
      The layout, per route.

      The board gets the transcript and the extraction readout down its left, because that is the
      route where knowing what was just said explains what just appeared. The other two routes get
      neither: a task list does not need a transcript beside it, and the record *is* the transcript.

      The call is placed on every route and opened by none of them — see `open` in `TemplatePanel`.
    */
    panels: [
      { id: 'transcript', module: 'transcribe', route: ROUTE.board, snap: 'left', order: 0, size: 'sm', grow: 1 },
      {
        id: 'extraction',
        node: extractionPanel,
        title: 'Extraction',
        route: ROUTE.board,
        snap: 'left',
        order: 1,
        size: 'sm',
        // Pinned to its own height while the transcript above absorbs the slack — which is what
        // "the transcript takes most of the height" is made of.
        grow: 0,
      },
      { id: 'call', module: 'call', snap: 'right', size: 'sm', open: false },
    ],
  },
  type: 'Column',
  // `minHeight` rather than `height`: a route taller than the viewport must grow rather than clip,
  // or this node's background stops at the fold while the content keeps scrolling.
  props: { bg: 'page', width: '100%', minHeight: '100%' },
  children: [switcher, { type: '$routes' }],
  routes: [
    { path: '/', redirect: '/board' },
    boardRoute,
    tasksRoute,
    recordRoute,
    {
      path: '*',
      type: 'Column',
      props: { flex: '1', ax: 'center', ay: 'center', p: '600' },
      children: [{ type: 'we-text', props: { color: 'text-faint' }, children: ['No such page.'] }],
    },
  ],
};
