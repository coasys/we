import type { RouteSchema, SchemaNode, SchemaProp } from '@we/schema-shared';
import { FLOWS_LOCALS, lineComposer, workflowsPage } from '@we/template-kit';

import { viewBar } from './bar.ts';
import { groupRoutes } from './groups.ts';
import { exportTranscriptButton, liveDot } from './marks.ts';
import { CHANNEL, CHAT_COVERS, groupPath, IN_ROOT_EXPR, ROOT_KNOWN_EXPR } from './paths.ts';
import { personRoute } from './person.ts';
import { dnaRoute } from './socialDna.ts';
import { LATEST_CALLS } from './tree.ts';

/**
 * The pages beside the tree: the Feed, the space's workflows, and — as its own page — a call. Each is
 * what a row of the tree shows in Page mode; Canvas mode is `canvas.ts`.
 */

/** The channel record, for its title. The root channel is the space's own collection: the Feed. */
const CHANNEL_TITLE = `${IN_ROOT_EXPR} ? 'Feed' : (first(local.channelRecord).title ? first(local.channelRecord).title : 'Channel')`;

/** Go to an address, an expression. */
export const navigateTo = (path: string): SchemaProp => ({ $invoke: 'routeStore.navigate', args: [{ $: path }] });

const channelQueries = {
  channelRecord: {
    entity: 'CollectionBlock',
    where: { id: CHANNEL },
    limit: 1,
    // Only a channel that is not the root — which cannot be told until the root is known.
    when: { $: `${ROOT_KNOWN_EXPR} && !(${IN_ROOT_EXPR})` },
  },
};

/**
 * Where to start, in a space with nothing in it yet: a card for each first thing worth doing, which
 * does it when pressed. Shown above the Feed until the space has held a call.
 *
 * Each card is a bare button around the card itself, so it is reachable from the keyboard and
 * announced as what it does. It lights under the pointer — an accent border and a glow, as a
 * highlighted card is in Nico's design; how bright the glow is, is the theme's.
 */
const hint = (icon: string, title: string, body: string, onClick?: SchemaProp, disabled?: SchemaProp): SchemaNode => {
  const card: SchemaNode = {
    type: 'Card',
    props: {
      bg: 'surface',
      gap: '200',
      width: '100%',
      height: '100%',
      border: '1px solid transparent',
      ...(onClick ? { hoverProps: { border: '1px solid accent-border', shadow: 'glow' } } : {}),
    },
    children: [
      { type: 'we-icon', props: { name: icon, color: 'accent-text', size: 'md' } },
      { type: 'we-text', props: { fontWeight: 'semibold' }, children: [title] },
      { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [body] },
    ],
  };
  // Without something to do it is a card to read, not a button: nothing lights that does nothing.
  if (!onClick) return { type: 'Column', props: { flex: '1 1 200px' }, children: [card] };
  return {
    type: 'we-button',
    props: { variant: 'bare', label: title, flex: '1 1 200px', onClick, ...(disabled ? { disabled } : {}) },
    children: [card],
  };
};

const firstSteps: SchemaNode = {
  type: '$if',
  props: {
    condition: {
      $: `(${IN_ROOT_EXPR}) && local.anyCallLoaded && !count(local.anyCall)`,
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
            hint('chat-circle', 'Say hello', 'Write in the box below. Everyone in the space reads the Feed.'),
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
/**
 * The root channel is the space's Feed: everything said and written here and what was found in it,
 * the Feed module's own view, with its own box to write in. The first steps sit above it until the
 * space has held a call.
 */
const rootFeed: SchemaNode = {
  type: 'Column',
  props: { flex: '1', minHeight: '0', width: '100%' },
  children: [
    firstSteps,
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', px: '500', pt: '300', pb: '500' },
      children: [{ type: '$part', props: { id: 'feed.feedView' } }],
    },
  ],
};

/**
 * A sub-channel, as chat: its lines and a box to write into it. No sub-channel is made while a space is
 * one integrated conversation, but one that exists still opens here by its address.
 */
const subChannelChat: SchemaNode = {
  type: 'Column',
  props: { flex: '1', minHeight: '0', width: '100%' },
  children: [
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
          sending: { $: 'local.sending' },
          onSubmit: sendLine,
          focusLocal: 'focusLine',
        }),
      ],
    },
  ],
};

const chatRoute: RouteSchema = {
  path: '/',
  type: 'Column',
  props: {
    width: '100%',
    height: '100%',
    /*
      A phone's thread is the whole window once the tree is folded — the app's bar included, so the
      conversation has the whole screen. Marked `"window"` rather than `"true"`: that asks for the
      chrome with the page, and the host answers by taking its own furniture away — the frame holds
      no bands and the app's bar is not drawn — so the cover fills the window from inside the
      surface that holds it. The rest of the cover's work is the host's either way: everything else
      inert, Tab inside, focus back to the row that opened it. `position`/`zIndex` do the covering
      and are dead properties while the column is static; the lane's fold, not this, says when — so
      Back unfolding it is also what uncovers the window.
    */
    position: { $: `${CHAT_COVERS} ? 'fixed' : 'static'` },
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    zIndex: 'modal',
    bg: 'page',
    'data-we-covers-window': { $: `${CHAT_COVERS} ? 'window' : 'false'` },
  },
  $queries: {
    ...channelQueries,
    // Whether the space has a call yet: the sidebar's question, so one subscription answers both.
    anyCall: LATEST_CALLS,
  },
  $localState: {
    sending: { type: 'boolean', initial: false },
    focusLine: { type: 'function', initial: null },
  },
  children: [
    viewBar(
      [
        // The Feed is the space's own; a channel under it is one of the Channels. Like the view below,
        // neither the crumb nor the glyph is chosen before the root is known (`ROOT_KNOWN_EXPR`): until
        // then General's own address reads as a sub-channel's, and the bar drew one, then swapped it.
        {
          label: 'Channels',
          onClick: navigateTo(groupPath('channels')),
          when: `(${ROOT_KNOWN_EXPR}) && !(${IN_ROOT_EXPR})`,
        },
        { label: { $: CHANNEL_TITLE } },
      ],
      { $: `!(${ROOT_KNOWN_EXPR}) ? '' : (${IN_ROOT_EXPR}) ? 'chats-circle' : 'hash'` },
      [],
      [],
      { $: CHAT_COVERS },
    ),
    {
      // One mount: which of the two this channel is, is decided once the root is known — see
      // `ROOT_KNOWN_EXPR`.
      type: '$if',
      props: {
        condition: { $: ROOT_KNOWN_EXPR },
        then: {
          type: '$if',
          props: {
            condition: { $: IN_ROOT_EXPR },
            then: rootFeed,
            else: subChannelChat,
          },
        },
      },
    },
  ],
};

/**
 * The space's workflows: WE's own Workflows page — every workflow down the left, the one chosen beside it with
 * the records going through it, and the editor for a new or changed one. `?new=1` opens the new-flow
 * dialog, which is what the + on the tree's Flows row, under Social DNA, goes to. Its crumb says Flows, as
 * the tree does.
 */
const workflowsRoute: RouteSchema = {
  path: '/workflows',
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $localState: { ...FLOWS_LOCALS },
  children: [
    viewBar(
      [
        {
          label: 'Flows',
          onClick: [{ $invoke: 'workflowStore.closeWorkflow' }, navigateTo(groupPath('workflows'))],
        },
        { label: { $: 'workflowStore.open.label' }, when: 'workflowStore.open' },
      ],
      'flow-arrow',
    ),
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', overflowY: 'auto' },
      children: [workflowsPage({ pt: '500', pb: '600' })],
    },
  ],
};

export const spaceRoutes: RouteSchema[] = [
  chatRoute,
  workflowsRoute,
  ...groupRoutes,
  dnaRoute,
  personRoute,
  { path: '*', redirect: './' },
];

/** The call on its own page is the record the address names. */
const CALL_ID = 'routeStore.params.id';

/**
 * The conversation the interpretation panel shows — its own subject, written out as the panel writes
 * it (`INTERPRETATION_SUBJECT_EXPR` in `@we/module-transcribe`), so the count on the button is what
 * opening the panel will list. Copied rather than imported, because a cartridge is data and depends
 * on no module package — so a change to the panel's subject has to be made here as well.
 */
const INTERPRETATION_SUBJECT =
  'routeStore.params.call ? routeStore.params.call : (modules.transcribe.callId ? modules.transcribe.callId : ' +
  'spaceStore.root)';

/**
 * Whether the space has transcription on. The panel the button opens belongs to the transcribe
 * module, and `launchModule` opens nothing for a module the space has turned off, so the button is
 * not offered there.
 */
const TRANSCRIBE_ON = "'transcribe' in spaceStore.activeModules";

/** How many suggestions on it nobody has kept or dropped yet. */
const WAITING = `count(modules.transcribe.proposalsFor[${INTERPRETATION_SUBJECT}])`;

/**
 * The end of a call's bar: the way into the call, Live while it runs, the way to the interpretation
 * panel, and the transcript to take away.
 *
 * The way in is for somebody not in the call: Join while it runs, Pick it back up once it has ended.
 * Somebody in it has the call's own controls instead. The button and the badge are `sm` so they
 * stand the height of the Page / Canvas switch beside them rather than over it. The export is
 * offered whether the call is running or over, to everyone — see `exportTranscriptButton`.
 *
 * The Interpretation button does what the panel's rail entry does in WE — `launchModule` on the
 * panel's dock id, so a press toggles it and an open-but-hidden one is brought forward rather than
 * closed — because this interface has no rail for it to live on. The panel opens only by hand, so
 * without it there would be no way to it at all.
 *
 * So the button says what the panel holds: a badge counting the suggestions waiting on somebody, and
 * none at zero, and a spinner in place of its glyph while a pass runs, as the rail's button has. The
 * badge sits beside the glyph rather than over it, so the button gives up being square while it has
 * one rather than covering its own icon.
 */
export const callBarAside = (callId: string): SchemaNode[] => {
  const live = `find(modules.call.liveCalls, { recordId: ${callId} })`;
  return [
    {
      type: '$if',
      props: {
        condition: { $: `modules.call.callRecordId != ${callId}` },
        then: {
          type: 'we-button',
          props: {
            variant: 'solid',
            size: 'sm',
            onClick: { $invoke: 'modules.call.continueCall', args: [{ $: callId }] },
          },
          children: [{ type: 'we-icon', props: { name: 'phone' } }, { $: `${live} ? 'Join' : 'Pick it back up'` }],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: live },
        then: { type: 'we-badge', props: { tone: 'success', size: 'sm' }, children: [liveDot, 'Live'] },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: TRANSCRIBE_ON },
        then: {
          type: 'we-tooltip',
          props: { content: 'Interpretation', placement: 'bottom' },
          children: [
            {
              type: 'we-button',
              props: {
                variant: 'ghost',
                size: 'md',
                square: { $: `!${WAITING}` },
                label: {
                  $: `${WAITING} ? \`Interpretation, \${${WAITING}} \${plural(${WAITING}, 'suggestion', 'suggestions')} to review\` : 'Interpretation'`,
                },
                expanded: { $: 'modules.transcribe.interpretationOpen' },
                onClick: { $invoke: 'spaceStore.launchModule', args: ['transcribe:interpretation'] },
              },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: { $: 'modules.transcribe.passRunning' },
                    then: { type: 'we-animated-icon', props: { name: 'spinner' } },
                    else: { type: 'we-icon', props: { name: 'sparkle' } },
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: WAITING },
                    then: {
                      type: 'we-badge',
                      props: { size: 'xs', variant: 'solid', tone: 'accent' },
                      children: [{ $: WAITING }],
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    },
    exportTranscriptButton(callId),
  ];
};

/**
 * A call, as its own page: what is being said and written in it.
 *
 * The space template's page for a call's record (`meta.recordViews`), so wherever a call is linked —
 * the tree, a message, a search — it opens here rather than as a generic record. Its body is the
 * Feed, pointed at this call: every line said, typed and answered in it, with the space Feed's own
 * Everything / Messages / Bots and its box, which writes into the call. Neither the controls nor the
 * people in the call are here: the call module's bar holds the controls on every page and its panel
 * draws everyone in the call, connecting and all, so a second set of either would be the same thing
 * twice. What the page adds, for somebody not in the call, is the way into it, in its bar.
 */
export const callPage: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', bg: 'page' },
  $queries: {
    callRecord: { entity: 'CollectionBlock', where: { id: { $: CALL_ID } }, limit: 1, when: { $: CALL_ID } },
  },
  children: [
    viewBar(
      [
        { label: 'Calls', onClick: navigateTo(groupPath('calls')) },
        { label: { $: "first(local.callRecord).title ? first(local.callRecord).title : 'Call'" } },
      ],
      'phone',
      callBarAside(CALL_ID),
      [
        // Renaming is the call module's, so it is the same here as anywhere a call's name is drawn.
        { type: '$part', props: { id: 'call.renameCallButton', subject: { $: CALL_ID } } },
      ],
    ),
    /*
      The call's Feed, pointed at the call the address names — the same for somebody in the call,
      somebody outside it and somebody reading it after it ended: anybody here can write into it.
      One column, so a phone holds it as a desk does.
    */
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', minWidth: '0', px: '500', pb: '500' },
      children: [{ type: '$part', props: { id: 'feed.callFeed', subject: { $: CALL_ID } } }],
    },
  ],
};
