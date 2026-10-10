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

import { TIMELINE_ORIENTATION } from './Panel.schema';

const FROM_START = 'modules.transcribe.feedFromStart';

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
 * Where a line came from, beside its time: the call, which opens it, or what kind of message it is.
 * A message WE did not write carries no `source` — a bot's — and says so.
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
    else: {
      type: 'we-badge',
      props: { size: 'sm', variant: 'neutral' },
      children: [{ $: "row.source == '' ? 'bot' : 'typed'" }],
    },
  },
};

/** One message: who, when, where from, the quote of what it answers, and the words. */
const line: SchemaNode = {
  type: '$agent',
  props: { did: { $: 'row.author' }, as: 'speaker' },
  children: [
    {
      type: 'Column',
      props: { gap: '100', width: '100%' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', width: '100%' },
          children: [
            { type: 'we-avatar', props: { image: { $: 'speaker.avatar' }, hash: { $: 'row.author' }, size: 'xs' } },
            {
              type: 'we-text',
              props: { variant: 'label', truncate: true, minWidth: '0' },
              children: [{ $: 'speaker.name' }],
            },
            { type: 'we-timestamp', props: { value: { $: 'row.at' }, timeStyle: 'short', color: 'text-faint' } },
            origin,
            {
              type: 'we-button',
              props: {
                size: 'xs',
                variant: 'ghost',
                ml: 'auto',
                label: 'Reply',
                onClick: { $setLocal: 'replyingTo', value: { $: 'row' } },
              },
              children: [{ type: 'we-icon', props: { name: 'arrow-bend-up-left' } }],
            },
          ],
        },
        // The line this answers, first line only — a reply to a reply quotes its direct parent.
        {
          type: '$if',
          props: {
            condition: { $: 'row.replyTo' },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted', truncate: true, pl: '600' },
              children: [{ $: "'↳ ' + (row.replyTo.text ? row.replyTo.text : 'original message removed')" }],
            },
          },
        },
        {
          // Marks — a mention, a link, emphasis — drawn the way a post draws them; plain text as text.
          type: '$if',
          props: {
            condition: { $: 'row.content' },
            then: {
              type: 'Column',
              props: { width: '100%', pl: '600' },
              children: [
                {
                  type: 'BlockRenderer',
                  props: { editorState: { $: 'row.content' }, rootClass: 'we-block-content--compact' },
                },
              ],
            },
            else: { type: 'we-text', props: { color: 'text', pl: '600' }, children: [{ $: 'row.text' }] },
          },
        },
      ],
    },
  ],
};

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
        condition: { $: 'local.replyingTo' },
        then: {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted', flex: '1', minWidth: '0', truncate: true },
              children: [{ $: "'Replying to: ' + local.replyingTo.text" }],
            },
            {
              type: 'we-button',
              props: { size: 'xs', variant: 'ghost', onClick: { $setLocal: 'replyingTo', value: null } },
              children: ['Cancel'],
            },
          ],
        },
      },
    },
    // The block composer in its one-line mode, as the transcript's — see `compact` on its props.
    {
      type: 'BlockComposer',
      props: {
        compact: true,
        autoFocus: false,
        handles: false,
        placeholder: 'Write to the space…',
        onSubmit: {
          $if: {
            condition: { $: '!local.sending' },
            then: [
              { $setLocal: 'sending', value: true },
              {
                $if: {
                  condition: { $: 'local.replyingTo' },
                  then: {
                    $action: 'modules.transcribe.reply',
                    args: [{ $: 'local.replyingTo.id' }, { $: 'event.text' }, { $: 'event.marks' }],
                    onSuccess: [{ $setLocal: 'replyingTo', value: null }],
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
      },
    },
  ],
};

export const feedPanel: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $localState: {
    // Messages only, or messages and what was found — the reader's own, kept on this device.
    feedActivity: { type: 'boolean', initial: true, persist: 'feed.activity' },
    // The line a reply is being written to, set by the line's reply button.
    replyingTo: { type: 'object', initial: null },
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
          {
            type: 'we-button',
            props: {
              size: 'xs',
              variant: 'ghost',
              label: 'Newest at the top or the bottom',
              onClick: {
                $action: 'spaceStore.setAgentModuleSetting',
                args: [
                  'transcribe',
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
