/**
 * The Feed: everything said and written in a space, in one stream.
 *
 * Every call's lines, what was typed outside any call, and bot replies, merged by time — with a row,
 * grouped, for what extraction found or somebody made. Separate from the transcript panel: no record
 * button and no extraction controls. It shows bots, because what extraction reads (people's words
 * only) is a different question from what a conversation contains.
 *
 * Read through the store's window (`feedRows`, see `feed.ts`), drawn with the shared `timeline`, so
 * it scrolls, pages and re-anchors exactly as the transcript does, and follows the same per-viewer
 * orientation.
 */
import { panelShell, timeline, timelineMoreAt, timelineOrder } from '@we/schema-kit';
import type { SchemaNode } from '@we/schema-shared';

import { lineComposer } from './lineComposer';
import { messageLine } from './messageLine';
import { TIMELINE_ORIENTATION, timelineOrderButton } from './Panel.schema';

const FROM_START = 'modules.transcribe.feedFromStart';

/** A reply started from the Feed's own lines — see `replyingTo`'s surface. */
const FEED_REPLY = "modules.transcribe.replyingTo.surface == 'feed'";

/** What the window draws: everything, or only messages when the reader put activity away. */
const ROWS =
  "local.feedActivity ? modules.transcribe.feedRows : modules.transcribe.feedRows.filter(r, r.kind == 'line')";

/** The words on the "more is coming" line, by which way the window grows. */
const MORE_WORDS = { $: `${FROM_START} ? 'Later in the space…' : 'Earlier in the space…'` };

const more = (end: 'start' | 'end'): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: `modules.transcribe.feedHasMore && ${timelineMoreAt(end, FROM_START, TIMELINE_ORIENTATION)}` },
    then: {
      type: 'Row',
      props: { 'data-we-more': end, ay: 'center', gap: '300', py: '200' },
      children: [
        { type: 'we-spinner', props: { size: 'xs', color: 'text-faint' } },
        { type: 'we-text', props: { variant: 'footnote', color: 'text-faint' }, children: [MORE_WORDS] },
      ],
    },
  },
});

/**
 * Where a line came from, beside its time: the call, which opens it. A message WE did not write
 * carries no `source` — a bot's — and says so.
 */
const origin: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'row.call' },
    then: {
      type: 'we-button',
      props: {
        size: 'xs',
        variant: 'ghost',
        // Into the call it was said in — the address the transcript and the space's views follow.
        onClick: { $action: 'routeStore.setParam', args: ['call', { $: 'row.call' }] },
      },
      children: [{ $: 'row.callTitle' }],
    },
    // How a line arrived — typed, corrected — is the line's own mark. A bot's carries no source at all.
    else: {
      type: '$if',
      props: {
        condition: { $: "row.source == ''" },
        then: { type: 'we-badge', props: { size: 'sm', variant: 'neutral' }, children: ['bot'] },
      },
    },
  },
};

/** One message, drawn exactly as the transcript draws one — see `messageLine`. */
const line: SchemaNode = messageLine({ as: 'row', surface: 'feed', relative: false, extra: origin });

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
          props: { size: 'sm', variant: { $: "row.suggested ? 'warning' : 'success'" } },
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
                    { type: 'we-badge', props: { size: 'sm', variant: 'neutral' }, children: [{ $: 'item.entity' }] },
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
              children: [{ $: "'Replying to: ' + modules.transcribe.replyingTo.text" }],
            },
            {
              type: 'we-button',
              props: { size: 'xs', variant: 'ghost', onClick: { $action: 'modules.transcribe.cancelReply', args: [] } },
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
                  $action: 'modules.transcribe.reply',
                  args: [{ $: 'modules.transcribe.replyingTo.id' }, { $: 'event.text' }, { $: 'event.marks' }],
                  onFinally: [{ $setLocal: 'sending', value: false }],
                },
                else: {
                  $action: 'modules.transcribe.sendToFeed',
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

export const feedPanel: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $localState: {
    // Messages only, or messages and what was found — the reader's own, kept on this device.
    feedActivity: { type: 'boolean', initial: true, persist: 'feed.activity' },
  },
  children: [
    panelShell({
      title: 'Feed',
      aside: {
        type: 'Row',
        props: { gap: '100', ay: 'center' },
        children: [
          {
            type: 'we-button',
            props: {
              size: 'xs',
              variant: { $: "local.feedActivity ? 'secondary' : 'ghost'" },
              onClick: { $setLocal: 'feedActivity', value: { $: '!local.feedActivity' } },
            },
            children: [{ $: "local.feedActivity ? 'Messages and activity' : 'Messages only'" }],
          },
          timelineOrderButton,
        ],
      },
      help: 'Everything said and written in this space — every call, messages typed outside calls, and replies — with what was found in it as it is found. Newest at the top or the bottom is yours to choose, and applies to transcripts too.',
      children: [
        timeline({
          fromStart: FROM_START,
          orientation: TIMELINE_ORIENTATION,
          onLoadOlder: { $action: 'modules.transcribe.showMoreFeed' },
          onLoadNewer: { $action: 'modules.transcribe.showMoreFeed' },
          onJumpNewest: { $action: 'modules.transcribe.readFeedLive' },
          onJumpOldest: { $action: 'modules.transcribe.readFeedFromStart' },
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
                        condition: { $: 'modules.transcribe.feedLoaded' },
                        then: {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-muted' },
                          children: ['Nothing said here yet. Calls, messages and what is found in them appear here.'],
                        },
                        else: { type: 'we-spinner', props: { size: 'sm' } },
                      },
                    },
                  },
                },
                more('end'),
              ],
            },
          ],
        }),
        composer,
      ],
    }),
  ],
};
