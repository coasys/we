/**
 * A call's messages — the lines people typed into it, read and written without the speech around them.
 *
 * ## The same record, a narrower view
 *
 * A message in a call is already a record: `addMessage` writes a `TextBlock` with `source: typed`
 * into the call's `CollectionBlock`, among the utterances. The transcript draws it there, in time
 * with what was said. This draws the same lines and only those — `where: { source: 'typed' }` — so a
 * person can follow what was typed without reading a transcript, and can write into it the way the
 * Feed writes into the space. Nothing new is stored, so a message sent here is in the transcript, in
 * the Feed's call card and in an export, exactly as one sent from the transcript's own box.
 *
 * Lines with no `source` — a bot writing straight into a call — are not WE's typed lines and are not
 * drawn here; the transcript still shows them.
 *
 * ## Drawn the way the Feed draws a line
 *
 * Each row is `messageLine`, the line the transcript and the Feed share, with replies flattened in by
 * `threadLines`. Reply and Edit act on this module's store, as they do in the transcript, so the reply
 * a person starts here is the transcript's `replyingTo` — one conversation, one reply in progress.
 *
 * ## Whose call
 *
 * The subject is `modules.transcribe.callId`, the live call's own record from the moment it starts,
 * and empty while that call is in another space: the query reads the space on screen, and a pane in
 * one space drawing an empty list for a call in another would say the call has no messages. A
 * placement points it at any call by its record — the Coasys call page names the call in its address,
 * which is what lets somebody who is not in the call, or reads it after it ended, write into it.
 */
import { messageLine, repliesInclude } from '@we/messages';
import { emptyState, lineComposer, panelScroll, panelShell } from '@we/schema-kit';
import { type SchemaNode } from '@we/schema-shared';

import { TIMELINE_ORIENTATION } from './Panel.schema';

/** Which call's messages — the token a placement's `subject` replaces. Kept bare; see `transcriptLines`. */
export const MESSAGES_SUBJECT_EXPR = 'modules.transcribe.callId';
const SUBJECT = { $: MESSAGES_SUBJECT_EXPR };

/**
 * How many of the newest messages are drawn.
 *
 * Bounded, because the query re-runs on every change while it is followed, and a fixed page rather
 * than the transcript's growing window, because a call's typed lines are a short conversation beside
 * it rather than a document. A call with more says so above the oldest one shown.
 */
export const MESSAGES_SHOWN = 200;

/** A reply started from a line in this module — the pane's lines and the transcript's alike. */
const REPLYING = "modules.transcribe.replyingTo.surface == 'transcript'";

/** Newest at the bottom, as a chat reads, unless the reader asked for newest at the top. */
const NEWEST_AT_TOP = `${TIMELINE_ORIENTATION} == 'newestTop'`;

/**
 * The messages, oldest first unless the reader turned the timeline round, with the sentence for none.
 */
const messageRows: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  /*
    Hoisted, so "are there none" can be asked of the list. `when` is not optional: without a subject
    the scope would be pruned and the query would widen to every typed line in the space.
  */
  $queries: {
    messages: {
      entity: 'TextBlock',
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: SUBJECT },
      where: { source: 'typed' },
      order: { createdAt: 'desc' },
      limit: MESSAGES_SHOWN,
      include: repliesInclude(),
      when: SUBJECT,
      // Followed whatever the call's state: anybody may still write into a call that has ended.
      subscribe: true,
    },
  },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: `count(local.messages) >= ${MESSAGES_SHOWN}` },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint', textAlign: 'center' },
          children: [`Showing the latest ${MESSAGES_SHOWN} messages. The transcript holds all of them.`],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: 'count(local.messages)' },
        then: {
          type: '$each',
          props: {
            items: {
              $: `${NEWEST_AT_TOP} ? threadLines({ rows: local.messages, newestFirst: true }) : reverse(threadLines({ rows: local.messages, newestFirst: true }))`,
            },
            as: 'message',
          },
          children: [
            messageLine({ as: 'message', actions: 'modules.transcribe', surface: 'transcript', relative: false }),
          ],
        },
        else: {
          type: '$if',
          props: {
            condition: { $: 'local.messagesLoaded' },
            then: emptyState({
              icon: 'chat-circle-text',
              label: 'messages',
              message: 'No messages yet. Write the first one below.',
            }),
          },
        },
      },
    },
  ],
};

/** Send what is in the box: a reply when one is being written, a message into the call otherwise. */
const send = [
  { $setLocal: 'sending', value: true },
  {
    $if: {
      condition: { $: REPLYING },
      then: {
        $invoke: 'modules.transcribe.reply',
        args: [{ $: 'modules.transcribe.replyingTo.id' }, { $: 'event.text' }, { $: 'event.marks' }],
        onFinally: [{ $setLocal: 'sending', value: false }],
      },
      else: {
        $invoke: 'modules.transcribe.addMessage',
        args: [SUBJECT, { $: 'event.text' }, { $: 'event.marks' }],
        onFinally: [{ $setLocal: 'sending', value: false }],
      },
    },
  },
];

/**
 * The Feed's composer, worded for a call: the line a reply answers, with a way to put it down, over
 * the one-line block composer — Enter sends, Shift+Enter breaks the line, `@` names a person.
 */
const composer: SchemaNode = {
  type: 'Column',
  props: { gap: '100', width: '100%', flex: '0 0 auto' },
  // In flight, so Enter pressed twice during a slow write is one message, not two.
  $localState: { sending: { type: 'boolean', initial: false } },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: REPLYING },
        then: {
          type: 'Row',
          props: { gap: '200', ay: 'center', width: '100%' },
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
      placeholder: 'Message the call…',
      sendLabel: 'Send',
      onSubmit: { $if: { condition: { $: '!local.sending' }, then: send } },
    }),
  ],
};

/**
 * The messages and the box under them, filling whatever it is placed in.
 *
 * Gated on the bare subject token, so a placement's substitution reaches the gate too.
 */
export const callMessages: SchemaNode = {
  type: '$if',
  props: {
    condition: SUBJECT,
    then: {
      type: 'Column',
      props: { flex: '1', minHeight: '0', gap: '300', width: '100%' },
      children: [
        panelScroll({
          pin: { $: `${NEWEST_AT_TOP} ? '' : 'end'` },
          children: [messageRows],
        }),
        composer,
      ],
    },
    else: emptyState({
      icon: 'chat-circle-text',
      label: 'messages',
      message: 'This call is in another space. Go back to it to read and send its messages.',
      delay: 0,
    }),
  },
};

/** The pane the call bar's Messages button opens. */
export const messagesPanel: SchemaNode = panelShell({
  title: 'Messages',
  help:
    'What people type into the call. Everyone in the space can read and add to it, during the call ' +
    'and after it ends. Messages are also in the transcript, in time with what was said.',
  children: [{ type: '$part', props: { id: 'transcribe.callMessages' } }],
});

/**
 * The Messages button, contributed into the call's control bar beside the record toggle — see
 * `CallControl.schema.ts` for why the bar is extended through its anchor rather than by name.
 *
 * Shows how many messages arrived since the pane last showed them, and nothing while there are none.
 */
export const messagesControl: SchemaNode = {
  type: 'we-tooltip',
  props: {
    content: {
      $: "modules.transcribe.messagesOpen ? 'Hide messages' : modules.transcribe.unreadMessages ? 'Messages (' + modules.transcribe.unreadMessages + ' new)' : 'Messages'",
    },
    placement: 'bottom',
  },
  children: [
    {
      // A frame for the count to sit on the button's corner — the button itself holds only its glyph.
      type: 'Row',
      props: { position: 'relative' },
      children: [
        {
          type: 'we-button',
          props: {
            square: true,
            label: 'Messages',
            variant: { $: "modules.transcribe.messagesOpen ? 'soft' : 'ghost'" },
            onClick: { $invoke: 'modules.transcribe.toggleMessages' },
          },
          children: [{ type: 'we-icon', props: { name: 'chat-circle-text' } }],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'modules.transcribe.unreadMessages > 0 && !modules.transcribe.messagesOpen' },
            then: {
              type: 'we-badge',
              props: {
                size: 'xs',
                variant: 'solid',
                tone: 'danger',
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                pointerEvents: 'none',
              },
              children: [
                { $: "modules.transcribe.unreadMessages > 9 ? '9+' : '' + modules.transcribe.unreadMessages" },
              ],
            },
          },
        },
      ],
    },
  ],
};
