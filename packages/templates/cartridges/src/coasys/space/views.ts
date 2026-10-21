import type { RouteSchema, SchemaNode, SchemaProp } from '@we/schema-shared';
import { lineComposer, recordFormModal } from '@we/template-kit';

import { callPath, CHANNEL, CHANNEL_EXPR, channelPath, IN_ROOT_EXPR, PAGE_EXPR } from './paths.ts';

/**
 * What the view beside the tree draws: a channel as chat or as a canvas, the space's flows, and — as
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
      variant: { $: `(${PAGE_EXPR}) == '${page}' ? 'secondary' : 'ghost'` },
      onClick: {
        $action: 'routeStore.navigate',
        args: [
          {
            $: page
              ? `spaceStore.spacePath + '/${page}' + ((${IN_ROOT_EXPR}) ? '' : '?channel=' + (${CHANNEL_EXPR}))`
              : channelPath(CHANNEL_EXPR),
          },
        ],
      },
    },
    children: [{ type: 'we-icon', props: { name: icon } }, label],
  })),
};

/** The way back to a folded tree, where the tree's own button cannot be. */
const showTree: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "'tree' in shellStore.collapsedLanes" },
    then: {
      type: 'we-tooltip',
      props: { content: 'Show the tree', placement: 'bottom' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            square: true,
            label: 'Show the tree',
            onClick: { $action: 'shellStore.setLaneCollapsed', args: ['tree', false] },
          },
          children: [{ type: 'we-icon', props: { name: 'sidebar-simple' } }],
        },
      ],
    },
  },
};

/** A view's bar: the way back to the tree, what this is, and whatever the view offers. */
const viewBar = (title: SchemaNode['children'], icon: string, aside: SchemaNode[] = []): SchemaNode => ({
  type: 'Row',
  props: { gap: '300', ay: 'center', px: '500', py: '300', borderBottom: '1px solid border', minHeight: '56px' },
  children: [
    showTree,
    { type: 'we-icon', props: { name: icon, color: 'text-muted' } },
    {
      type: 'we-text',
      props: { variant: 'heading-sm', fontWeight: 'semibold', truncate: true, flex: '1', minWidth: '0' },
      children: title,
    },
    ...aside,
  ],
});

const channelQueries = {
  channelRecord: {
    entity: 'CollectionBlock',
    where: { id: CHANNEL },
    limit: 1,
    when: { $: `!(${IN_ROOT_EXPR})` },
  },
};

/** "You are in a call" over the chat, with the way to it — the call's own page. */
const inCallStrip: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.call.active && !modules.call.elsewhere' },
    then: {
      type: 'Row',
      props: { gap: '300', ay: 'center', px: '500', py: '200', bg: 'success-surface' },
      children: [
        { type: 'we-icon', props: { name: 'phone-call', color: 'success-text' } },
        { type: 'we-text', props: { flex: '1', color: 'success-text' }, children: ['You are in a call'] },
        {
          type: 'we-button',
          props: {
            size: 'sm',
            variant: 'secondary',
            onClick: { $action: 'routeStore.navigate', args: [{ $: callPath('modules.call.callRecordId') }] },
          },
          children: ['Open the call'],
        },
      ],
    },
  },
};

/**
 * Where to start, in a space with nothing in it yet: a hint for each first thing worth doing. Shown in
 * the root channel until the space has a call or a channel of its own.
 */
const hint = (icon: string, title: string, body: string): SchemaNode => ({
  type: 'Card',
  props: { bg: 'surface', gap: '200', flex: '1 1 200px' },
  children: [
    { type: 'we-icon', props: { name: icon, color: 'accent-text', size: 'md' } },
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: [title] },
    { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [body] },
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
        { type: 'we-text', props: { variant: 'heading-sm' }, children: ['A space starts with a conversation'] },
        {
          type: 'Row',
          props: { gap: '300', wrap: true },
          children: [
            hint(
              'phone',
              'Start a call',
              'Everyone here can join. What is said is written down, and what is decided becomes work you can see.',
            ),
            hint('hash', 'Make a channel', 'A place for one subject, from the menu beside the space’s name.'),
            hint('chat-circle', 'Say hello', 'Write below. Everyone in the space reads General.'),
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
            $action: 'modules.transcribe.reply',
            args: [{ $: 'modules.transcribe.replyingTo.id' }, { $: 'event.text' }, { $: 'event.marks' }],
            onFinally: [{ $setLocal: 'sending', value: false }],
          },
          else: {
            $action: 'modules.transcribe.addMessage',
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
    anyChannel: { entity: 'CollectionBlock', where: { kind: 'channel' }, limit: 1 },
  },
  $localState: { sending: { type: 'boolean', initial: false } },
  children: [
    viewBar([{ $: CHANNEL_TITLE }], 'hash', [channelModes]),
    inCallStrip,
    firstSteps,
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', px: '500', py: '300' },
      children: [{ type: '$part', props: { id: 'transcribe.transcriptFeed', subject: CHANNEL } }],
    },
    {
      type: 'Column',
      props: { px: '500', pb: '500', pt: '200', gap: '100' },
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
                  props: { size: 'xs', variant: 'ghost', onClick: { $action: 'modules.transcribe.cancelReply' } },
                  children: ['Cancel'],
                },
              ],
            },
          },
        },
        lineComposer({ placeholder: 'Write a message…', sendLabel: 'Send', onSubmit: sendLine }),
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
            onNodeDragEnd: { $action: 'recordStore.dragOnCanvas', args: [CHANNEL, { $: 'event' }] },
            onDrop: { $action: 'recordStore.dropOnCanvas', args: [CHANNEL, { $: 'event' }] },
            onCanvasDoubleClick: {
              $action: 'recordStore.createOnCanvas',
              args: [CHANNEL, { $: 'event.x' }, { $: 'event.y' }],
            },
            onNodeDoubleClick: {
              $action: 'routeStore.navigate',
              args: [{ $: "spaceStore.spacePath + '/record/' + event.recordType + '?id=' + event.recordId" }],
            },
          },
        },
      ],
    },
    recordFormModal(),
  ],
};

/** One flow: its steps in order, and what is going through it now. */
const openFlow: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', wrap: true, ay: 'center' },
      children: [
        {
          type: '$each',
          props: { items: { $: 'flowStore.open.lanes[0].steps' }, as: 'step' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: { $: 'index' },
                    then: { type: 'we-icon', props: { name: 'caret-right', color: 'text-faint' } },
                  },
                },
                {
                  type: 'we-tag',
                  props: { variant: { $: "step.final ? 'success' : 'neutral'" } },
                  children: [{ $: 'step.label' }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'count(flowStore.open.records)' },
        then: {
          type: 'Column',
          props: { gap: '200' },
          children: [
            {
              type: '$each',
              props: { items: { $: 'flowStore.open.records' }, as: 'item' },
              children: [
                {
                  type: 'Card',
                  props: { bg: 'surface', gap: '200' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '300', ay: 'center', ax: 'between' },
                      children: [
                        {
                          type: 'we-text',
                          props: { fontWeight: 'semibold', truncate: true, minWidth: '0' },
                          children: [{ $: 'item.title' }],
                        },
                        {
                          type: 'we-badge',
                          props: { variant: { $: "item.stalled ? 'warning' : 'primary'" } },
                          children: [{ $: 'item.stateLabel' }],
                        },
                      ],
                    },
                    {
                      type: 'Row',
                      props: { gap: '100', wrap: true },
                      children: [
                        {
                          type: '$each',
                          props: { items: { $: 'item.walk' }, as: 'stop' },
                          children: [
                            {
                              type: 'we-text',
                              props: {
                                variant: 'footnote',
                                color: {
                                  $: "stop.at == 'current' ? 'accent-text' : stop.at == 'done' ? 'text-muted' : 'text-faint'",
                                },
                                fontWeight: { $: "stop.at == 'current' ? 'semibold' : 'regular'" },
                              },
                              children: [{ $: "(index ? '→ ' : '') + stop.label" }],
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
        else: {
          type: 'we-text',
          props: { color: 'text-muted' },
          children: [{ $: "flowStore.open.recordsLoaded ? 'Nothing is going through this flow yet.' : ''" }],
        },
      },
    },
  ],
};

/** The space's flows: each one, how many things are going through it, and the one chosen, opened. */
const flowsRoute: RouteSchema = {
  path: '/flows',
  type: 'Column',
  props: { width: '100%', height: '100%' },
  children: [
    viewBar([{ $: "flowStore.open ? flowStore.open.label : 'Flows'" }], 'flow-arrow'),
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', overflowY: 'auto', px: '500', py: '500', gap: '500' },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: 'flowStore.available' },
            then: {
              type: 'Column',
              props: { gap: '500' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', wrap: true },
                  children: [
                    {
                      type: '$each',
                      props: { items: { $: 'flowStore.flows.filter(f, !f.archived)' }, as: 'flow' },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            variant: {
                              $: "flowStore.open && flowStore.open.name == flow.name ? 'secondary' : 'outline'",
                            },
                            onClick: { $action: 'flowStore.openFlow', args: [{ $: 'flow.name' }] },
                          },
                          children: [
                            { type: 'we-icon', props: { name: 'flow-arrow' } },
                            { $: 'flow.label' },
                            { type: 'we-badge', props: { size: 'xs' }, children: [{ $: 'flow.records' }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'flowStore.open' },
                    then: openFlow,
                    else: {
                      type: 'we-text',
                      props: { color: 'text-muted' },
                      children: [
                        {
                          $: "flowStore.flowsLoaded && !count(flowStore.flows) ? 'This space has no flows yet.' : 'Choose a flow to see what is going through it.'",
                        },
                      ],
                    },
                  },
                },
              ],
            },
            else: {
              type: 'we-text',
              props: { color: 'text-muted' },
              children: ['Flows are not available in this space.'],
            },
          },
        },
      ],
    },
  ],
};

export const spaceRoutes: RouteSchema[] = [chatRoute, canvasRoute, flowsRoute, { path: '*', redirect: './' }];

/** The call on its own page is the record the address names. */
const CALL_ID = 'routeStore.params.id';
const MINE = `modules.call.callRecordId == ${CALL_ID}`;

const control = (icon: string, onIcon: string, on: string, label: string, action: string): SchemaNode => ({
  type: 'we-tooltip',
  props: { content: label },
  children: [
    {
      type: 'we-button',
      props: {
        square: true,
        label,
        variant: { $: `${on} ? 'secondary' : 'outline'` },
        onClick: { $action: action },
      },
      children: [{ type: 'we-icon', props: { name: { $: `${on} ? '${onIcon}' : '${icon}'` } } }],
    },
  ],
});

/**
 * A call, as its own page: the people in it, the controls, and what is being said.
 *
 * The space template's page for a call's record (`meta.recordViews`), so wherever a call is linked —
 * the tree, a message, a search — it opens here rather than as a generic record. The tiles and
 * controls are the call module's; the transcript is the transcribe module's, pointed at this call.
 */
export const callPage: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', bg: 'page' },
  $queries: {
    callRecord: { entity: 'CollectionBlock', where: { id: { $: CALL_ID } }, limit: 1, when: { $: CALL_ID } },
  },
  children: [
    viewBar([{ $: "first(local.callRecord).title ? first(local.callRecord).title : 'Call'" }], 'phone', [
      {
        type: '$if',
        props: {
          condition: { $: `find(modules.call.liveCalls, { recordId: ${CALL_ID} })` },
          then: { type: 'we-badge', props: { variant: 'success' }, children: ['Live'] },
        },
      },
    ]),
    {
      type: '$if',
      props: {
        condition: { $: MINE },
        then: {
          type: 'Column',
          props: { gap: '300', p: '500' },
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
            {
              type: 'Row',
              props: { gap: '200', ax: 'center', ay: 'center' },
              children: [
                control(
                  'microphone-slash',
                  'microphone',
                  'modules.call.media.audioEnabled',
                  'Microphone',
                  'modules.call.toggleAudio',
                ),
                control(
                  'video-camera-slash',
                  'video-camera',
                  'modules.call.media.videoEnabled',
                  'Camera',
                  'modules.call.toggleVideo',
                ),
                control(
                  'monitor',
                  'monitor-play',
                  'modules.call.media.screenShareEnabled',
                  'Share your screen',
                  'modules.call.toggleScreenShare',
                ),
                {
                  type: 'we-button',
                  props: { variant: 'danger', onClick: { $action: 'modules.call.leave' } },
                  children: [{ type: 'we-icon', props: { name: 'phone-x' } }, 'Leave'],
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
              props: { variant: 'primary', onClick: { $action: 'modules.call.continueCall', args: [{ $: CALL_ID }] } },
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
      props: { flex: '1', minHeight: '0', px: '500', pb: '500' },
      children: [{ type: '$part', props: { id: 'transcribe.transcriptFeed', subject: { $: CALL_ID } } }],
    },
  ],
};
