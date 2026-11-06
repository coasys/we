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
 */
import { messageLine } from '@we/messages';
import { lineComposer, panelShell, timeline, timelineMoreAt, timelineOrder } from '@we/schema-kit';
import type { SchemaNode } from '@we/schema-shared';

const FROM_START = 'modules.feed.feedFromStart';

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

/** A reply is being written to one of the Feed's lines — the Feed's own `replyingTo`. */
const FEED_REPLY = 'modules.feed.replyingTo';

/** A line whose author's own profile says it is a bot — see the store's `botAuthors`. */
const BOT_LINE = 'row.author in modules.feed.botAuthors';

/** What the window draws: everything, only messages, or only bots' messages — the reader's choice. */
const ROWS =
  "local.feedShow == 'bots' ? modules.feed.feedRows.filter(r, r.kind == 'line' && r.author in modules.feed.botAuthors) " +
  ": local.feedShow == 'messages' ? modules.feed.feedRows.filter(r, r.kind == 'line') : modules.feed.feedRows";

/** The words on the "more is coming" line, by which way the window grows. */
const MORE_WORDS = { $: `${FROM_START} ? 'Later in the space…' : 'Earlier in the space…'` };

const more = (end: 'start' | 'end'): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: `modules.feed.feedHasMore && ${timelineMoreAt(end, FROM_START, TIMELINE_ORIENTATION)}` },
    then: {
      type: 'Row',
      props: { 'data-we-more': end, ay: 'center', gap: '300', py: '200' },
      children: [
        { type: 'we-animated-icon', props: { name: 'spinner', size: 'xs', color: 'text-faint' } },
        { type: 'we-text', props: { variant: 'footnote', color: 'text-faint' }, children: [MORE_WORDS] },
      ],
    },
  },
});

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
          The typed mark's shape (an icon in an xs badge, with a tooltip), so the row's marks read as
          one set. The accent tint is what keeps it apart from the grey typed mark beside it.
        */
        then: {
          type: 'we-tooltip',
          props: { content: 'Bot', placement: 'top' },
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
const line: SchemaNode = messageLine({
  as: 'row',
  actions: 'modules.feed',
  surface: 'feed',
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
              $: "row.origin ? row.summary + ' extracted from ' + row.originTitle : row.summary + ' added'",
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

/** The box at the foot: a message into the space, or a reply to the line chosen. */
const composer: SchemaNode = {
  type: 'Column',
  props: { gap: '100', width: '100%', mt: '100' },
  $localState: { sending: { type: 'boolean', initial: false } },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: FEED_REPLY },
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
      placeholder: 'Write to the space…',
      sendLabel: 'Send to the space',
      onSubmit: {
        $if: {
          condition: { $: '!local.sending' },
          then: [
            { $setLocal: 'sending', value: true },
            {
              $if: {
                condition: { $: FEED_REPLY },
                then: {
                  $invoke: 'modules.feed.reply',
                  args: [{ $: 'modules.feed.replyingTo.id' }, { $: 'event.text' }, { $: 'event.marks' }],
                  onFinally: [{ $setLocal: 'sending', value: false }],
                },
                else: {
                  $invoke: 'modules.feed.sendToFeed',
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
};

/** The stream itself: every line and activity row, in the window, which way round the reader chose. */
const feedTimeline: SchemaNode = timeline({
  fromStart: FROM_START,
  orientation: TIMELINE_ORIENTATION,
  onLoadOlder: { $invoke: 'modules.feed.showMoreFeed' },
  onLoadNewer: { $invoke: 'modules.feed.showMoreFeed' },
  onJumpNewest: { $invoke: 'modules.feed.readFeedLive' },
  onJumpOldest: { $invoke: 'modules.feed.readFeedFromStart' },
  children: [
    {
      type: 'Column',
      props: { gap: '400' },
      children: [
        more('start'),
        {
          type: '$if',
          props: {
            condition: { $: `count(${ROWS})` },
            then: {
              type: '$each',
              props: { items: { $: timelineOrder(ROWS, FROM_START, TIMELINE_ORIENTATION) }, as: 'row' },
              children: [
                {
                  type: '$if',
                  props: { condition: { $: "row.kind == 'line'" }, then: line, else: activity },
                },
              ],
            },
            else: {
              type: '$if',
              props: {
                condition: { $: 'modules.feed.feedLoaded' },
                then: {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-muted' },
                  children: [
                    {
                      $: "local.feedShow == 'bots' ? 'No bot has written in this part of the space.' : 'Nothing said here yet. Calls, messages and what is found in them appear here.'",
                    },
                  ],
                },
                else: { type: 'we-animated-icon', props: { name: 'spinner', size: 'sm' } },
              },
            },
          },
        },
        more('end'),
      ],
    },
  ],
});

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

/** What the Feed shows — everything, messages, or bots' messages — and which way round: the reader's own. */
const feedControls: SchemaNode = {
  type: 'Row',
  props: { gap: '100', ay: 'center' },
  children: [
    showButton('all', 'Everything'),
    showButton('messages', 'Messages'),
    showButton('bots', 'Bots'),
    timelineOrderButton,
  ],
};

/** The reader's choice of what the Feed shows, kept on this device — declared where the controls and the list meet. */
const FEED_LOCALS = {
  feedShow: { type: 'string', initial: 'all', persist: 'feed.show' },
} as const;

/**
 * The Feed as a panel, beside whatever is on screen — the module's own placement, with its help.
 */
export const feedPanel: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $localState: FEED_LOCALS,
  children: [
    panelShell({
      title: 'Feed',
      aside: feedControls,
      help: 'Everything said and written in this space — every call, messages typed outside calls, and replies — with what was found in it as it is found. Newest at the top or the bottom is yours to choose.',
      children: [feedTimeline, composer],
    }),
  ],
};

/**
 * The Feed as a view: the same stream and the same box, for a template to place as a page — a space
 * whose main view is its Feed. The template draws its own header; the reader's two choices sit at the
 * top of the stream.
 *
 * Kept live while it is drawn, as the panel is while open: the part declares `whileShown`, and the
 * host tells the store as it is drawn and taken down.
 */
export const feedView: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', gap: '200' },
  $localState: FEED_LOCALS,
  children: [
    { type: 'Row', props: { ax: 'end' }, children: [feedControls] },
    { type: 'Column', props: { flex: '1', minHeight: '0' }, children: [feedTimeline] },
    composer,
  ],
};
