/**
 * The Feed: everything said and written in a space, in one stream.
 *
 * Every call's lines, what was typed outside any call, and bot replies, merged by time — with a row,
 * grouped, for what extraction found or somebody made. Separate from the transcript panel: no record
 * button and no extraction controls. It shows bots, because what extraction reads (people's words
 * only) is a different question from what a conversation contains.
 *
 * Read through the store's window (`feedRows`, see `feed.ts`), drawn with the shared `timeline`, so
 * it scrolls, pages and re-anchors exactly as the transcript does, which way round its reader chose.
 * Two placements of one stream: the module's panel, and a view a template places as a page.
 *
 * ## Two scopes, one Feed
 *
 * The same stream scoped to one call (`callFeedView`): the same line, the same three choices and the
 * same box, read from and written into the call's collection (`callFeedRows`, `sendToCallFeed`). In
 * a call, Everything is every line said, typed or answered there; Messages is what people typed; Bots
 * is what bots wrote. The space's transcripts switch is not there — a call's own Feed is where its
 * spoken lines are read. Each scope below is a `FeedScope`; the panel, the view and the call's view
 * are the same body drawn over one.
 */
import { messageLine, SPOKEN, TYPED } from '@we/messages';
import { lineComposer, panelShell, timeline, timelineMoreAt, timelineOrder } from '@we/schema-kit';
import type { SchemaNode } from '@we/schema-shared';

/**
 * What a Feed body is drawn over: where its rows, its window and its box are in the store, and the
 * words that name what it is the Feed of.
 */
interface FeedScope {
  /** Which composer a reply started on one of its lines belongs to — see `replyingTo`. */
  surface: 'feed' | 'callFeed';
  /** The rows drawn under Everything — an expression over the store's window. */
  visible: string;
  /** Which of those are Messages — a condition on `r`. */
  message: string;
  hasMore: string;
  loaded: string;
  fromStart: string;
  showMore: string;
  readLive: string;
  readFromStart: string;
  send: string;
  /** What the window is of, for the words around it — "the space", "the call". */
  of: string;
  /** What an empty Everything says. */
  empty: string;
  /** The space's choice to draw its calls' spoken lines — not a call's to make. */
  transcriptsSwitch: boolean;
}

/** The space's Feed. */
const SPACE: FeedScope = {
  surface: 'feed',
  /*
    The lines a call spoke, kept out until this reader asks for them in this space — the per-space
    `showCallTranscripts` setting, off by default. Only `source == 'spoken'` goes: a heard line
    somebody corrected is no longer verbatim speech, and a line with no source is a bot's or a call's
    own item — all still drawn.
  */
  visible:
    'modules.feed.showCallTranscripts ? modules.feed.feedRows : ' +
    `modules.feed.feedRows.filter(r, !(r.kind == 'line' && r.source == '${SPOKEN}'))`,
  // Every line the space's window holds — a call's spoken lines are already out unless asked for.
  message: "r.kind == 'line'",
  hasMore: 'modules.feed.feedHasMore',
  loaded: 'modules.feed.feedLoaded',
  fromStart: 'modules.feed.feedFromStart',
  showMore: 'modules.feed.showMoreFeed',
  readLive: 'modules.feed.readFeedLive',
  readFromStart: 'modules.feed.readFeedFromStart',
  send: 'modules.feed.sendToFeed',
  of: 'the space',
  empty: 'Nothing said here yet. Calls, messages and what is found in them appear here.',
  transcriptsSwitch: true,
};

/** The Feed of one call: every line in it, whatever the space's transcripts choice. */
const CALL: FeedScope = {
  surface: 'callFeed',
  visible: 'modules.feed.callFeedRows',
  // What people typed: not what the call heard (spoken, or heard and then mended), and not a bot's.
  message: `r.kind == 'line' && r.source == '${TYPED}' && !(r.author in modules.feed.botAuthors)`,
  hasMore: 'modules.feed.callFeedHasMore',
  loaded: 'modules.feed.callFeedLoaded',
  fromStart: 'modules.feed.callFeedFromStart',
  showMore: 'modules.feed.showMoreCallFeed',
  readLive: 'modules.feed.readCallFeedLive',
  readFromStart: 'modules.feed.readCallFeedFromStart',
  send: 'modules.feed.sendToCallFeed',
  of: 'the call',
  empty: 'Nothing said or written in this call yet. What is said, typed and found in it appears here.',
  transcriptsSwitch: false,
};

/** Which way round this reader draws the Feed — their own setting (`timelineOrder`). */
const TIMELINE_ORIENTATION = 'modules.feed.timelineOrientation';

/** Newest at the top or the bottom, pressed where the list is. */
const timelineOrderButton: SchemaNode = {
  type: 'we-tooltip',
  props: { content: 'Newest at the top or the bottom' },
  children: [
    {
      type: 'we-button',
      props: {
        size: 'xs',
        variant: 'ghost',
        label: 'Newest at the top or the bottom',
        onClick: {
          $invoke: 'spaceStore.setAgentModuleSetting',
          args: [
            'feed',
            'timelineOrder',
            { $: `${TIMELINE_ORIENTATION} == 'newestTop' ? 'newestBottom' : 'newestTop'` },
          ],
        },
      },
      children: [
        {
          type: 'we-icon',
          props: { name: { $: `${TIMELINE_ORIENTATION} == 'newestTop' ? 'sort-descending' : 'sort-ascending'` } },
        },
      ],
    },
  ],
};

/** A reply is being written to one of this list's lines — the Feed's own `replyingTo`, started here. */
const replyHere = (scope: FeedScope) => `modules.feed.replyingTo.surface == '${scope.surface}'`;

/** A line whose author's own profile says it is a bot — see the store's `botAuthors`. */
const BOT_LINE = 'row.author in modules.feed.botAuthors';

/** What the window draws: everything, only messages, or only bots' messages — the reader's choice. */
const rowsOf = (scope: FeedScope) =>
  `local.feedShow == 'bots' ? (${scope.visible}).filter(r, r.kind == 'line' && r.author in modules.feed.botAuthors) ` +
  `: local.feedShow == 'messages' ? (${scope.visible}).filter(r, ${scope.message}) : (${scope.visible})`;

/**
 * Where a line came from, beside its time: the call, which opens it, and whether a bot wrote it.
 *
 * A bot is known by its own profile, never by how the line was written: a line with no `source` is
 * every app's but WE's, and a bot answering in a call writes into the call. So the mark shows in a
 * call too, beside the call's name.
 */
const origin: SchemaNode = {
  type: 'Row',
  props: { gap: '100', ay: 'center' },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: 'row.call' },
        then: {
          type: 'we-button',
          props: {
            size: 'xs',
            variant: 'ghost',
            // Into the call it was said in — the address the transcript and the space's views follow.
            onClick: { $invoke: 'routeStore.setParam', args: ['call', { $: 'row.call' }] },
          },
          children: [{ $: 'row.callTitle' }],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: BOT_LINE },
        /*
          The typed mark's shape (an icon in an xs badge, with a tooltip saying how the line came to be), so the row's marks read as
          one set. The accent tint is what keeps it apart from the grey typed mark beside it.
        */
        then: {
          type: 'we-tooltip',
          props: { content: 'Written by a bot', placement: 'top' },
          children: [
            {
              type: 'we-badge',
              props: { size: 'xs', tone: 'accent' },
              children: [{ type: 'we-icon', props: { name: 'robot', size: '14px' } }],
            },
          ],
        },
      },
    },
  ],
};

/** One message, drawn exactly as the transcript draws one — see `messageLine`. */
const line = (scope: FeedScope): SchemaNode =>
  messageLine({
    as: 'row',
    actions: 'modules.feed',
    surface: scope.surface,
    relative: false,
    extra: origin,
  });

/**
 * What extraction found, or somebody made, grouped — "3 tasks and 1 event, from Monday sync" — with
 * whether it has been kept yet, and the records it is about a press away.
 */
const activity: SchemaNode = {
  type: 'Column',
  props: { gap: '100', width: '100%' },
  $localState: { expanded: { type: 'boolean', initial: false } },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', width: '100%' },
      children: [
        { type: 'we-icon', props: { name: { $: "row.origin ? 'sparkle' : 'plus-circle'" }, color: 'text-muted' } },
        {
          type: 'we-text',
          props: { variant: 'body', flex: '1', minWidth: '0', truncate: true },
          children: [
            {
              $: "row.origin ? row.summary + ' found in ' + row.originTitle : row.summary + ' added'",
            },
          ],
        },
        {
          type: 'we-badge',
          props: { size: 'sm', tone: { $: "row.suggested ? 'warning' : 'success'" } },
          children: [{ $: "row.suggested ? row.suggested + ' suggested' : 'kept'" }],
        },
        {
          type: 'we-button',
          props: {
            size: 'xs',
            variant: 'ghost',
            label: 'Show what was added',
            onClick: { $setLocal: 'expanded', value: { $: '!local.expanded' } },
          },
          children: [{ type: 'we-icon', props: { name: { $: "local.expanded ? 'caret-down' : 'caret-right'" } } }],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'local.expanded' },
        then: {
          type: 'Column',
          props: { gap: '100', pl: '600' },
          children: [
            {
              type: '$each',
              props: { items: { $: 'row.items' }, as: 'item' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center', opacity: { $: 'item.pending ? 0.6 : 1' } },
                  children: [
                    { type: 'we-badge', props: { size: 'sm' }, children: [{ $: 'item.entity' }] },
                    { type: 'we-text', props: { variant: 'body', truncate: true }, children: [{ $: 'item.title' }] },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  ],
};

/** The box at the foot: a message into the space or the call, or a reply to the line chosen in this list. */
const composer = (scope: FeedScope): SchemaNode => ({
  type: 'Column',
  props: { gap: '100', width: '100%', mt: '100' },
  $localState: { sending: { type: 'boolean', initial: false } },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: replyHere(scope) },
        then: {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted', flex: '1', minWidth: '0', truncate: true },
              children: [{ $: "'Replying to: ' + modules.feed.replyingTo.text" }],
            },
            {
              type: 'we-button',
              props: { size: 'xs', variant: 'ghost', onClick: { $invoke: 'modules.feed.cancelReply', args: [] } },
              children: ['Cancel'],
            },
          ],
        },
      },
    },
    // The block composer in its one-line mode, as the transcript's — see `lineComposer`.
    lineComposer({
      placeholder: `Write to ${scope.of}…`,
      sendLabel: `Send to ${scope.of}`,
      onSubmit: {
        $if: {
          condition: { $: '!local.sending' },
          then: [
            { $setLocal: 'sending', value: true },
            {
              $if: {
                condition: { $: replyHere(scope) },
                then: {
                  $invoke: 'modules.feed.reply',
                  args: [{ $: 'modules.feed.replyingTo.id' }, { $: 'event.text' }, { $: 'event.marks' }],
                  onFinally: [{ $setLocal: 'sending', value: false }],
                },
                else: {
                  $invoke: scope.send,
                  args: [{ $: 'event.text' }, { $: 'event.marks' }],
                  onFinally: [{ $setLocal: 'sending', value: false }],
                },
              },
            },
          ],
        },
      },
    }),
  ],
});

/** The stream itself: every line and activity row, in the window, which way round the reader chose. */
const feedTimeline = (scope: FeedScope): SchemaNode => {
  const rows = rowsOf(scope);
  return timeline({
    fromStart: scope.fromStart,
    orientation: TIMELINE_ORIENTATION,
    onLoadOlder: { $invoke: scope.showMore },
    onLoadNewer: { $invoke: scope.showMore },
    onJumpNewest: { $invoke: scope.readLive },
    onJumpOldest: { $invoke: scope.readFromStart },
    children: [
      {
        type: 'Column',
        props: {
          gap: '400',
          /*
            The end with rows beyond it that are not loaded, for the scroller's jump button there to ask
            for them rather than scroll (see `data-we-more` on `we-scroll-area`). Only the edge away from
            the anchor can have more, so one marker on the list says it, and nothing is drawn for it.
          */
          'data-we-more': {
            $: `${scope.hasMore} ? (${timelineMoreAt('start', scope.fromStart, TIMELINE_ORIENTATION)} ? 'start' : 'end') : ''`,
          },
        },
        children: [
          {
            type: '$if',
            props: {
              condition: { $: `count(${rows})` },
              then: {
                type: '$each',
                props: { items: { $: timelineOrder(rows, scope.fromStart, TIMELINE_ORIENTATION) }, as: 'row' },
                children: [
                  {
                    type: '$if',
                    props: { condition: { $: "row.kind == 'line'" }, then: line(scope), else: activity },
                  },
                ],
              },
              else: {
                type: '$if',
                props: {
                  condition: { $: scope.loaded },
                  then: {
                    type: 'we-text',
                    props: { variant: 'footnote', color: 'text-muted' },
                    children: [
                      {
                        $: `local.feedShow == 'bots' ? 'No bot has written in this part of ${scope.of}.' : local.feedShow == 'messages' ? 'Nobody has written in this part of ${scope.of}.' : '${scope.empty}'`,
                      },
                    ],
                  },
                  else: { type: 'we-animated-icon', props: { name: 'spinner', size: 'sm' } },
                },
              },
            },
          },
        ],
      },
    ],
  });
};

/** One of the reader's three choices of what the Feed shows. */
const showButton = (value: string, label: string): SchemaNode => ({
  type: 'we-button',
  props: {
    size: 'xs',
    variant: { $: `local.feedShow == '${value}' ? 'soft' : 'ghost'` },
    onClick: { $setLocal: 'feedShow', value },
  },
  children: [label],
});

/*
  Whether the lines a call spoke are in the stream at all — the same per-space answer the setting
  keeps, pressed where the list they hide in is.
*/
const transcriptsSwitch: SchemaNode = {
  type: 'Row',
  props: { gap: '100', ay: 'center', ml: 'auto' },
  children: [
    { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: ['Show call transcripts'] },
    {
      type: 'we-switch',
      props: {
        size: 'sm',
        label: 'Show call transcripts',
        checked: { $: 'modules.feed.showCallTranscripts' },
        onChange: {
          $invoke: 'spaceStore.setMyModuleSetting',
          args: ['feed', 'showCallTranscripts', { $: 'event.detail' }],
        },
      },
    },
  ],
};

/** What the Feed shows — everything, messages, or bots' messages — and which way round: the reader's own. */
const feedControls = (scope: FeedScope): SchemaNode => ({
  type: 'Row',
  props: { gap: '100', ay: 'center' },
  children: [
    showButton('all', 'Everything'),
    showButton('messages', 'Messages'),
    showButton('bots', 'Bots'),
    timelineOrderButton,
    ...(scope.transcriptsSwitch ? [transcriptsSwitch] : []),
  ],
});

/**
 * The reader's choice of what the Feed shows, kept on this device — declared where the controls and
 * the list meet. A call's is kept apart: Messages there is a narrower thing than in the space.
 */
const feedLocals = (scope: FeedScope) =>
  ({
    feedShow: { type: 'string', initial: 'all', persist: scope.surface === 'feed' ? 'feed.show' : 'feed.callShow' },
  }) as const;

/** The stream and its box, under its reader's choices — a view's body, for either scope. */
const feedBody = (scope: FeedScope): SchemaNode[] => [
  { type: 'Row', props: { ax: 'end' }, children: [feedControls(scope)] },
  { type: 'Column', props: { flex: '1', minHeight: '0' }, children: [feedTimeline(scope)] },
  composer(scope),
];

/**
 * The Feed as a panel, beside whatever is on screen — the module's own placement, with its help.
 */
export const feedPanel: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $localState: feedLocals(SPACE),
  children: [
    panelShell({
      title: 'Feed',
      aside: feedControls(SPACE),
      help: 'Everything said and written in this space — every call, messages typed outside calls, and replies — with what was found in it as it is found. Newest at the top or the bottom is yours to choose.',
      children: [feedTimeline(SPACE), composer(SPACE)],
    }),
  ],
};

/**
 * The Feed as a view: the same stream and the same box, for a template to place as a page — a space
 * whose main view is its Feed. The template draws its own header; the reader's choices sit at the
 * top of the stream.
 *
 * Kept live while it is drawn, as the panel is while open: the part declares `whileShown`, and the
 * host tells the store as it is drawn and taken down.
 */
export const feedView: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', gap: '200' },
  $localState: feedLocals(SPACE),
  children: feedBody(SPACE),
};

/**
 * The Feed of one call, for a page to place: the same stream and box, read from and written into the
 * call the part is pointed at — its subject, `routeStore.params.call` unless the placement points it
 * elsewhere. The host hands that call to the store as the part is drawn and takes it back as it goes
 * (`whileShown`), so this reads only while it is on screen, and only that call.
 */
export const callFeedView: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'routeStore.params.call' },
    then: {
      type: 'Column',
      props: { width: '100%', height: '100%', gap: '200' },
      $localState: feedLocals(CALL),
      children: feedBody(CALL),
    },
    else: {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-muted' },
      children: ['No call is chosen.'],
    },
  },
};
