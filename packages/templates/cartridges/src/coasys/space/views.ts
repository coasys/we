import type { RouteSchema, SchemaNode, SchemaProp } from '@we/schema-shared';
import { FLOWS_LOCALS, lineComposer, recordFormModal, workflowsPage } from '@we/template-kit';

import { viewBar } from './bar.ts';
import { groupRoutes } from './groups.ts';
import { liveDot } from './marks.ts';
import { CHANNEL, CHANNEL_EXPR, channelPath, IN_ROOT_EXPR, PAGE_EXPR } from './paths.ts';
import { personRoute } from './person.ts';
import { newChannelDialog } from './tree.ts';

/**
 * What the view beside the tree draws: a channel as chat or as a canvas, the space's workflows, and — as
 * its own page — a call.
 */

/** The channel record, for its title. The root channel is the space's own collection and has none. */
const CHANNEL_TITLE = `${IN_ROOT_EXPR} ? 'General' : (first(local.channelRecord).title ? first(local.channelRecord).title : 'Channel')`;

/** Chat or canvas, for the channel on screen — the address keeps which channel. */
const channelModes: SchemaNode = {
  type: 'Row',
  props: { gap: '100', p: '100', r: 'control', bg: 'surface-sunken' },
  children: [
    ['', 'chat-circle', 'Chat'],
    ['canvas', 'squares-four', 'Canvas'],
  ].map(([page, icon, label]) => ({
    type: 'we-button',
    props: {
      size: 'sm',
      variant: { $: `(${PAGE_EXPR}) == '${page}' ? 'soft' : 'ghost'` },
      onClick: {
        $invoke: 'routeStore.navigate',
        args: [
          {
            $: page ? `spaceStore.spacePath + '/${page}?channel=' + (${CHANNEL_EXPR})` : channelPath(CHANNEL_EXPR),
          },
        ],
      },
    },
    children: [{ type: 'we-icon', props: { name: icon } }, label],
  })),
};

const channelQueries = {
  channelRecord: {
    entity: 'CollectionBlock',
    where: { id: CHANNEL },
    limit: 1,
    when: { $: `!(${IN_ROOT_EXPR})` },
  },
};

/**
 * The bottom of a view, kept clear of the call bar.
 *
 * The bar floats along the bottom of the window on every page while a call is up, so whatever a view
 * pins to its foot — the composer, the end of a transcript — rises above it, and settles back as the
 * bar goes. `--we-covered-bottom` is how much the host says is covered there.
 */
const CLEAR_OF_THE_BAR = 'calc(var(--we-space-500) + var(--we-covered-bottom, 0px))';
const LIFT = 'padding-bottom 300 ease';

/**
 * Where to start, in a space with nothing in it yet: a card for each first thing worth doing, which
 * does it when pressed. Shown in the root channel until the space has a call or a channel of its own.
 *
 * Each card is a bare button around the card itself, so it is reachable from the keyboard and
 * announced as what it does. It lights under the pointer — an accent border and a glow, as a
 * highlighted card is in Nico's design; how bright the glow is, is the theme's.
 */
const hint = (icon: string, title: string, body: string, onClick: SchemaProp, disabled?: SchemaProp): SchemaNode => ({
  type: 'we-button',
  props: { variant: 'bare', label: title, flex: '1 1 200px', onClick, ...(disabled ? { disabled } : {}) },
  children: [
    {
      type: 'Card',
      props: {
        bg: 'surface',
        gap: '200',
        width: '100%',
        height: '100%',
        border: '1px solid transparent',
        hoverProps: { border: '1px solid accent-border', shadow: 'glow' },
      },
      children: [
        { type: 'we-icon', props: { name: icon, color: 'accent-text', size: 'md' } },
        { type: 'we-text', props: { fontWeight: 'semibold' }, children: [title] },
        { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [body] },
      ],
    },
  ],
});

const firstSteps: SchemaNode = {
  type: '$if',
  props: {
    condition: {
      $: `(${IN_ROOT_EXPR}) && local.anyCallLoaded && local.anyChannelLoaded && !count(local.anyCall) && !count(local.anyChannel)`,
    },
    then: {
      type: 'Column',
      props: { gap: '300', px: '500', pt: '500' },
      children: [
        { type: 'we-text', props: { variant: 'overline' }, children: ['Start here'] },
        /*
          The statement, then its payoff in the accent: Nico's weight contrast inside one line. The
          payoff is a span with no size of its own, so it takes the heading's; the statement takes
          the theme's heading weight.
        */
        {
          type: 'we-text',
          props: { variant: 'heading-md' },
          children: [
            'A space starts with ',
            {
              type: 'we-text',
              props: { inline: true, fontWeight: 'semibold', color: 'accent-text' },
              children: ['a conversation'],
            },
          ],
        },
        {
          type: 'Row',
          props: { gap: '300', wrap: true },
          children: [
            hint(
              'phone',
              'Start a call',
              'Everyone here can join. What is said is written down, and what is decided becomes work you can see.',
              { $invoke: 'modules.call.goToCall' },
              { $: '!modules.call.canCall' },
            ),
            hint('hash', 'Make a channel', 'A place for one subject, also from the + beside Channels.', {
              $setLocal: 'newChannelOpen',
              value: true,
            }),
            hint('chat-circle', 'Say hello', 'Write below. Everyone in the space reads General.', {
              $callLocal: 'focusLine',
            }),
          ],
        },
      ],
    },
  },
};

const sendLine: SchemaProp = {
  $if: {
    condition: { $: '!local.sending' },
    then: [
      { $setLocal: 'sending', value: true },
      {
        $if: {
          condition: { $: "modules.transcribe.replyingTo.surface == 'transcript'" },
          then: {
            $invoke: 'modules.transcribe.reply',
            args: [{ $: 'modules.transcribe.replyingTo.id' }, { $: 'event.text' }, { $: 'event.marks' }],
            onFinally: [{ $setLocal: 'sending', value: false }],
          },
          else: {
            $invoke: 'modules.transcribe.addMessage',
            args: [CHANNEL, { $: 'event.text' }, { $: 'event.marks' }],
            onFinally: [{ $setLocal: 'sending', value: false }],
          },
        },
      },
    ],
  },
};

/**
 * A channel as chat: its lines, newest at the foot, and a box to write into it.
 *
 * The lines are the transcribe module's own, pointed at the channel — the same rows a call's
 * transcript draws, with replies inline and a typed line marked as typed. Written lines go in through
 * `addMessage`, as a line typed into a transcript does. So a call and a channel read alike, which is
 * what lets a call held in a channel sit among its messages later.
 */
const chatRoute: RouteSchema = {
  path: '/',
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $queries: {
    ...channelQueries,
    anyCall: { entity: 'CollectionBlock', where: { kind: 'call' }, limit: 1 },
    // Under the root, as the tree's own list is: the root is a channel too ("General"), so asking for
    // any channel in the space always found it, and the first steps never showed.
    anyChannel: {
      entity: 'CollectionBlock',
      where: { kind: 'channel' },
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: 'spaceStore.root' } },
      limit: 1,
      when: { $: 'spaceStore.root' },
    },
  },
  $localState: {
    sending: { type: 'boolean', initial: false },
    // For the first steps: the new-channel dialog, and the composer's own focus once it is ready.
    newChannelOpen: { type: 'boolean', initial: false },
    focusLine: { type: 'function', initial: null },
  },
  children: [
    viewBar([{ $: CHANNEL_TITLE }], 'hash', [channelModes]),
    firstSteps,
    newChannelDialog('newChannelOpen'),
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', px: '500', py: '300' },
      children: [{ type: '$part', props: { id: 'transcribe.transcriptFeed', subject: CHANNEL } }],
    },
    {
      type: 'Column',
      props: { px: '500', pb: CLEAR_OF_THE_BAR, pt: '200', gap: '100', transition: LIFT },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: "modules.transcribe.replyingTo.surface == 'transcript'" },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-muted', flex: '1', minWidth: '0', truncate: true },
                  children: [{ $: "'Replying to: ' + modules.transcribe.replyingTo.text" }],
                },
                {
                  type: 'we-button',
                  props: { size: 'xs', variant: 'ghost', onClick: { $invoke: 'modules.transcribe.cancelReply' } },
                  children: ['Cancel'],
                },
              ],
            },
          },
        },
        lineComposer({
          placeholder: 'Write a message…',
          sendLabel: 'Send',
          onSubmit: sendLine,
          focusLocal: 'focusLine',
        }),
      ],
    },
  ],
};

/**
 * A channel as a canvas: what is in it, where people put it. Double-click empty space to make
 * something there; drop anything from Pocket or another space onto it; double-click a card to open it.
 */
const canvasRoute: RouteSchema = {
  path: '/canvas',
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $queries: channelQueries,
  children: [
    viewBar([{ $: CHANNEL_TITLE }], 'hash', [channelModes]),
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0' },
      children: [
        {
          type: 'GraphView',
          props: {
            width: '100%',
            height: '100%',
            seeds: {
              source: 'canvas',
              options: { canvas: CHANNEL, members: { id: CHANNEL, via: 'children' }, connections: 'Relationship' },
            },
            layout: { type: 'manual', options: { size: { width: 200, height: 140 } } },
            // A dot grid, as d12's canvas has: it moves with the canvas, so a pan reads as a pan.
            backdrop: { pattern: 'dots', gap: 24 },
            nodeStyle: [{ style: { shape: 'card', width: 200, height: 140, content: 'record', contentMinZoom: 0.4 } }],
            behaviours: [
              'node-double-click',
              'canvas-double-click',
              'select',
              { type: 'drag-node', options: { pin: true } },
              'pan-zoom',
            ],
            empty: 'Nothing here yet. Double-click to make something, or drop something in from Pocket.',
            emptyIcon: 'squares-four',
            onNodeDragEnd: { $invoke: 'recordStore.dragOnCanvas', args: [CHANNEL, { $: 'event' }] },
            onDrop: { $invoke: 'recordStore.dropOnCanvas', args: [CHANNEL, { $: 'event' }] },
            onCanvasDoubleClick: {
              $invoke: 'recordStore.createOnCanvas',
              args: [CHANNEL, { $: 'event.x' }, { $: 'event.y' }],
            },
            onNodeDoubleClick: {
              $invoke: 'routeStore.navigate',
              args: [{ $: "spaceStore.spacePath + '/record/' + event.recordType + '?id=' + event.recordId" }],
            },
          },
        },
      ],
    },
    recordFormModal(),
  ],
};

/**
 * The space's workflows: WE's own Workflows page — every workflow down the left, the one chosen beside it with
 * the records going through it, and the editor for a new or changed one. `?new=1` opens the new-flow
 * dialog, which is what the + on the tree's Workflows row goes to.
 */
const workflowsRoute: RouteSchema = {
  path: '/workflows',
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $localState: { ...FLOWS_LOCALS },
  children: [
    viewBar([{ $: "workflowStore.open ? workflowStore.open.label : 'Workflows'" }], 'flow-arrow'),
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', overflowY: 'auto' },
      children: [workflowsPage({ pt: '500', pb: '600' })],
    },
  ],
};

export const spaceRoutes: RouteSchema[] = [
  chatRoute,
  canvasRoute,
  workflowsRoute,
  ...groupRoutes,
  personRoute,
  { path: '*', redirect: './' },
];

/** The call on its own page is the record the address names. */
const CALL_ID = 'routeStore.params.id';
const MINE = `modules.call.callRecordId == ${CALL_ID}`;

/**
 * A call, as its own page: the people in it and what is being said.
 *
 * The space template's page for a call's record (`meta.recordViews`), so wherever a call is linked —
 * the tree, a message, a search — it opens here rather than as a generic record. The tiles are the
 * call module's; the transcript is the transcribe module's, pointed at this call. The controls are
 * not here: the call module's bar holds them on every page, this one included, so a second set
 * would be the same buttons twice.
 */
export const callPage: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', bg: 'page' },
  $queries: {
    callRecord: { entity: 'CollectionBlock', where: { id: { $: CALL_ID } }, limit: 1, when: { $: CALL_ID } },
  },
  children: [
    viewBar(
      [{ $: "first(local.callRecord).title ? first(local.callRecord).title : 'Call'" }],
      'phone',
      [
        {
          type: '$if',
          props: {
            condition: { $: `find(modules.call.liveCalls, { recordId: ${CALL_ID} })` },
            then: { type: 'we-badge', props: { tone: 'success' }, children: [liveDot, 'Live'] },
          },
        },
      ],
      [
        // Renaming is the call module's, so it is the same here as anywhere a call's name is drawn.
        { type: '$part', props: { id: 'call.renameCallButton', subject: { $: CALL_ID } } },
      ],
    ),
    {
      type: '$if',
      props: {
        condition: { $: MINE },
        then: {
          type: 'Column',
          props: { p: '500' },
          children: [
            {
              type: 'Grid',
              props: { minChildWidth: '220px', gap: '300', childAspect: '16 / 9', maxHeight: '50vh' },
              children: [
                {
                  type: '$each',
                  props: { items: { $: 'modules.call.tiles' }, as: 'tile' },
                  children: [{ type: '$part', props: { id: 'call.tile' } }],
                },
              ],
            },
          ],
        },
        else: {
          type: 'Row',
          props: { gap: '300', p: '500', ay: 'center' },
          children: [
            {
              type: 'we-text',
              props: { color: 'text-muted', flex: '1' },
              children: [
                {
                  $: `find(modules.call.liveCalls, { recordId: ${CALL_ID} }) ? 'This call is happening now.' : 'This call has ended. Its transcript is below.'`,
                },
              ],
            },
            {
              type: 'we-button',
              props: { variant: 'solid', onClick: { $invoke: 'modules.call.continueCall', args: [{ $: CALL_ID }] } },
              children: [
                { type: 'we-icon', props: { name: 'phone' } },
                { $: `find(modules.call.liveCalls, { recordId: ${CALL_ID} }) ? 'Join' : 'Pick it back up'` },
              ],
            },
          ],
        },
      },
    },
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', px: '500', pb: CLEAR_OF_THE_BAR, transition: LIFT },
      children: [{ type: '$part', props: { id: 'transcribe.transcriptFeed', subject: { $: CALL_ID } } }],
    },
  ],
};
