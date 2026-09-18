/**
 * The conversation about one record — read, replied to, at any depth.
 *
 * ## What was missing, and what was already there
 *
 * Almost all of this existed. `WeNode.comments` (`we://comment`) hangs a reply off *anything* — a
 * post, an image inside it, a task, a drawn connection, another reply — and `commentThread` has
 * drawn those nested for as long as it has existed. What was missing was the other half: **there was
 * no way to write one below the top.** Every surface offered a single "Reply" button against the
 * record, so a thread could be rendered three levels deep and never reach two. Nested threads were a
 * rendering of data nothing could produce.
 *
 * The reason is a real constraint rather than an oversight: `$localState` names are fixed when a
 * template is written and the replies come from a query, so "is the composer open on *this* reply"
 * has no name to be stored under. The way round it is to store the **answer** instead of a flag —
 * one local holding the id of whatever is being replied to, one composer reading it. That is what
 * `composerModal`'s `clearTo` exists for.
 *
 * ## Depth is bounded, and the conversation is not
 *
 * `commentThread` expands into nested copies of itself at authoring time, because a schema is a
 * finite tree and cannot recurse at render time. Three levels is the practical limit — a panel is
 * 320px wide and the indent budget runs out long before a conversation does.
 *
 * So the limit re-roots rather than stopping: the deepest row carries "N more in this thread", and
 * pressing it makes that reply the thread's root. Reddit does the same, and it is what makes a
 * bounded expansion answer an unbounded conversation. Going back is one press, and the reply the
 * thread is rooted at is drawn above it so the context is not lost.
 *
 * ## Fractal or flat, as a reading rather than a shape
 *
 * `mode` decides whether a *reply* may be replied to. It does not decide how replies are **stored**,
 * which is always a tree: a space that switches to flat still shows the nesting it already has,
 * rather than a hierarchy silently reading as a list, and a space that switches back loses nothing.
 * Flat is a policy about what may be added — the GitHub-issue reading of a discussion — and it is an
 * expression, so a community can hold the answer where communities hold their other decisions.
 *
 * What it is *not* is a flattening. Drawing a stored tree as one list, Slack-style with "replying to
 * @x", needs a walk to any depth, and the query language has one hop; it is not expressible and is
 * not worth the entity it would take.
 *
 * ## Ambient scope — what this reads from the tree
 *
 * - **`local.signalTypes`**, for the counts on each reply. See `signals.ts`, which documents why the
 *   subscription belongs to the surface rather than to the fragment.
 * - Its own locals are declared here, prefixed `discussion*`, so a panel holding one needs to
 *   declare nothing. Two discussions in one tree would share them — put the second one behind a
 *   route or a modal, which is where a second conversation belongs anyway.
 */
import { composerModal, confirmModal, emptyNote } from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import { commentThread } from '../lists/commentThread.ts';
import { agentByline } from './agentByline.ts';
import { activitySummary } from './signals.ts';

/** The reply the composer is open on, or empty. Holds the answer rather than a flag — see above. */
const REPLY_TO = 'discussionReplyTo';
/** The reply the thread is currently rooted at, or empty for the record itself. */
const ROOT = 'discussionRoot';
/** The reply whose delete is being confirmed, or empty. The same trick `REPLY_TO` uses. */
const DELETING = 'discussionDeleting';

export interface DiscussionSectionOptions {
  /** Context key of the record being discussed — `'row'`, `'link'`, `'card'`. */
  record: string;
  /** Whether a reply may itself be replied to, as an expression. Defaults to always. */
  fractal?: string;
  /** Levels drawn before the thread offers to re-root. Defaults to 3, as `commentThread` does. */
  depth?: number;
  /** What the composer's heading says. Defaults to "Reply". */
  title?: string;
}

/** The button that opens the composer on one reply — the thing flat mode withholds. */
function replyButton(as: string): SchemaNode {
  return {
    type: 'we-button',
    props: {
      variant: 'ghost',
      size: 'xs',
      ml: 'auto',
      onClick: { $setLocal: REPLY_TO, value: { $: `${as}.id` } },
    },
    children: [{ type: 'we-icon', props: { name: 'arrow-bend-up-left' } }, 'Reply'],
  };
}

/** One reply, as it is drawn wherever it appears — in the thread, and above it once re-rooted. */
function replyBody(as: string, opts: DiscussionSectionOptions): SchemaNode[] {
  const fractal = opts.fractal;
  return [
    /*
      Who, when — and the one control that is about the reply rather than about answering it.

      Compact: a reply's byline sits above two lines of text and under another reply, so at a post's
      weight it competes with the words it introduces. The delete rides in the byline's `children`
      with an auto margin, which puts it at the right end of that line — the row already exists, and
      a control that removes the thing is better placed beside its author than beside "Reply", where
      the two read as a pair of answers.

      Your own only, which is narrower than the rule `EdgeDetail` applies to a drawn connection —
      there, anybody may retract a claim the community's records carry, and the deletion being
      authored is what holds it accountable. A reply is not a claim about the records; it is
      somebody's sentence, and a neighbourhood being writable by every member is a fact about the
      protocol rather than an invitation to edit each other's speech.
    */
    {
      /*
        The byline and the delete on one line, in a row this fragment owns.

        Rather than passing the control as the byline's `children`, which would need that fragment's
        row to be full width for an auto margin to reach the edge — and it is used at seventeen other
        call sites, several of them inside rows of their own, where growing it would push a sibling.
        A caller that wants the edge can hold the line itself; the byline stays as wide as its words.
      */
      type: 'Row',
      props: { ay: 'center', gap: '300', width: '100%' },
      children: [
        agentByline({ did: { $: `${as}.author` }, timestamp: { $: `${as}.createdAt` }, compact: true }),
        {
          type: '$if',
          props: {
            condition: { $: `${as}.author == me.did` },
            then: {
              type: 'we-tooltip',
              props: { content: 'Delete this reply', ml: 'auto' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'ghost',
                    size: 'xs',
                    square: true,
                    color: 'danger-text',
                    label: 'Delete this reply',
                    onClick: { $setLocal: DELETING, value: { $: `${as}.id` } },
                  },
                  children: [{ type: 'we-icon', props: { name: 'trash' } }],
                },
              ],
            },
          },
        },
      ],
    },
    /*
      The words, flush with the face above them.

      `rootClass` rather than a wrapper: `.we-block-content` pads every paragraph on all four sides,
      which is a *document's* padding — it is what makes the hover highlight a comfortable block in a
      composer. In a thread it insets the text from the byline and puts a blank band over and under
      every line. The compact variant takes the horizontal padding off and quarters the vertical; see
      `blocks.scss`, where the graph card's equivalent lives beside it.
    */
    {
      type: 'BlockRenderer',
      props: { editorState: { $: `${as}.editorState` }, rootClass: 'we-block-content--compact' },
    },
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', width: '100%' },
      children: [
        /*
          What this reply has collected, read-only.

          Counts rather than the controls the record itself gets: a thread is a column of replies and
          a row of buttons under each one is more furniture than conversation. Reacting to a reply is
          a gap and is named as one in the PR — it wants a control that appears on attention, which
          is the same thing `signalRow` is waiting on.
        */
        activitySummary({ record: as, replies: false, as: `${as}Sum` }),
        // Whether this reply may be answered. Unconditional where the caller named no rule, rather
        // than gated on a literal `true`: a bare boolean in an expression is a *name* to the parser,
        // and the node this would wrap is cheaper to leave out than to guard.
        ...(fractal
          ? [
              {
                type: '$if',
                props: {
                  condition: { $: fractal },
                  then: replyButton(as),
                },
              } as SchemaNode,
            ]
          : [replyButton(as)]),
      ],
    },
    /*
      The question, per reply, gated on this reply's id — so one local serves every level of the
      thread, exactly as the composer's does.

      It says what goes with it. A reply carries its own replies, and `deleteBlocks` follows
      `we://comment` now, so deleting one three people answered takes those three answers too: a
      dialog that said only "this cannot be undone" would be telling the truth and hiding the part
      that matters. The sentence names the number, and says nothing about responses where there are
      none rather than reading "and its 0 responses".
    */
    confirmModal({
      open: { $: `local.${DELETING} == ${as}.id` },
      close: { $setLocal: DELETING, value: '' },
      title: 'Delete this reply?',
      body: {
        $: `count(${as}.comments) ? \`This reply, and the \${count(${as}.comments)} \${plural(count(${as}.comments), 'response', 'responses')} under it, will be permanently deleted.\` : 'This reply will be permanently deleted.'`,
      },
      confirmLabel: 'Delete',
      confirm: { $action: 'spaceStore.deleteCollection', args: [{ $: `${as}.id` }] },
    }),
  ];
}

export function discussionSection(opts: DiscussionSectionOptions): SchemaNode {
  /** What the thread hangs off: the reply it has been re-rooted at, or the record. */
  const anchor = `local.${ROOT} ? local.${ROOT} : ${opts.record}.id`;

  return {
    type: 'Column',
    props: { gap: '300', width: '100%' },
    $localState: {
      [REPLY_TO]: { type: 'string', initial: '' },
      [ROOT]: { type: 'string', initial: '' },
      [DELETING]: { type: 'string', initial: '' },
    },
    $queries: {
      /*
        The reply the thread has been re-rooted at, so it can be shown above its own replies.

        Only while re-rooted — `when` rather than a `where` the pruner would drop, which would widen
        this to every reply in the space and draw whichever came back first. Its own query because it
        is not in the thread below it: the thread asks for that reply's *children*.
      */
      discussionFocus: {
        entity: 'CollectionBlock',
        where: { id: { $: `local.${ROOT}` } },
        when: { $: `local.${ROOT}` },
        include: { signals: true },
        limit: 1,
      },
    },
    children: [
      // Where you are, and the way back — only while the thread is rooted somewhere other than the
      // record. The record's own thread is the top, and a "back" there would point at nothing.
      {
        type: '$if',
        props: {
          condition: { $: `local.${ROOT}` },
          then: {
            type: 'Column',
            props: { gap: '200', width: '100%' },
            children: [
              {
                type: 'we-button',
                props: {
                  variant: 'ghost',
                  size: 'sm',
                  ax: 'start',
                  onClick: { $setLocal: ROOT, value: '' },
                },
                children: [{ type: 'we-icon', props: { name: 'arrow-left' } }, 'Back to the whole thread'],
              },
              {
                type: '$each',
                props: { items: { $: 'local.discussionFocus' }, as: 'focused' },
                children: [
                  {
                    // The reply being continued, drawn as itself and marked as the context it is:
                    // a rule down its left edge, which is what the indent says one level in.
                    type: 'Column',
                    props: { gap: '100', width: '100%', pl: '400', borderLeft: '2px solid border-strong' },
                    children: replyBody('focused', opts),
                  },
                ],
              },
            ],
          },
        },
      },
      commentThread({
        anchorId: { $: anchor },
        ...(opts.depth !== undefined && { depth: opts.depth }),
        reply: (as) => [
          {
            type: 'Column',
            /*
              `py: '100'`, not '200': the blocks inside carry their own vertical padding now (see the
              compact variant), so the old value was that padding twice over and a two-line reply
              stood as tall as a card.
            */
            props: { gap: '100', width: '100%', py: '100' },
            children: replyBody(as, opts),
          },
        ],
        // The limit, made a door — see the docblock. The count is the same one the default sentence
        // shows; what changes is that pressing it goes there.
        more: (as) => ({
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            ax: 'start',
            onClick: { $setLocal: ROOT, value: { $: `${as}.id` } },
          },
          children: [
            { type: 'we-number', props: { value: { $: `count(${as}.comments)` } } },
            ' more in this thread',
            { type: 'we-icon', props: { name: 'arrow-right', size: 'xs' } },
          ],
        }),
        empty: emptyNote('No replies yet.'),
      }),
      /*
        Replying to what the thread is rooted at — the record, or the reply being continued.

        The same anchor the thread reads, so "Reply" always means "reply to the thing above these
        replies" wherever the reader has got to. Below the thread rather than above it, where the
        conversation ends and a new line goes.
      */
      {
        type: 'Row',
        props: { gap: '300', width: '100%' },
        children: [
          {
            type: 'we-button',
            props: {
              variant: 'ghost',
              size: 'sm',
              onClick: { $setLocal: REPLY_TO, value: { $: anchor } },
            },
            children: [{ type: 'we-icon', props: { name: 'chat-circle' } }, 'Reply'],
          },
        ],
      },
      composerModal({
        openLocal: REPLY_TO,
        // The id is the open state, so closing clears it rather than writing a boolean into a field
        // every other read treats as an id.
        clearTo: '',
        title: opts.title ?? 'Reply',
        saveLabel: 'Reply',
        saveAction: {
          $action: 'spaceStore.createPost',
          // The tree first: `createPost(json, options)`. `we://comment` rather than `we://children`
          // — a reply answers the thing rather than becoming part of it, which is what lets a reply
          // be a full composition with children of its own.
          args: [
            { $: 'arg' },
            { kind: 'reply', parentId: { $: `local.${REPLY_TO}` }, predicate: 'we://comment' } as SchemaProp,
          ],
        },
      }),
    ],
  };
}
