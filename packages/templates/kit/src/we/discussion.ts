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

import { commentThread, descendantCount, foldToggle } from '../lists/commentThread.ts';
import { agentByline } from './agentByline.ts';
import { signalsSection } from './signals.ts';

/** The reply the composer is open on, or empty. Holds the answer rather than a flag — see above. */
const REPLY_TO = 'discussionReplyTo';
/** The reply the thread is currently rooted at, or empty for the record itself. */
const ROOT = 'discussionRoot';
/** The reply whose delete is being confirmed, or empty. The same trick `REPLY_TO` uses. */
const DELETING = 'discussionDeleting';
/** The reply being rewritten, or empty. The same trick again — one composer serves every level. */
const EDITING = 'discussionEditing';
/**
 * The reply whose actions are showing, or empty — one at a time.
 *
 * An id rather than a flag per row, for the reason the fold is a set of ids: rows come from a
 * subscription, so a boolean on the row is lost the moment anybody replies anywhere and the query
 * answers again. One at a time rather than a set, because the row is about what you are answering
 * and a thread with six of them open is the furniture this hides in the first place.
 */
const OPEN = 'discussionOpen';

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
      onClick: { $setLocal: REPLY_TO, value: { $: `${as}.id` } },
    },
    children: [{ type: 'we-icon', props: { name: 'arrow-bend-up-left' } }, 'Reply'],
  };
}

/**
 * One reply, as it is drawn wherever it appears — in the thread, and above it once re-rooted.
 *
 * ## Quiet until it is asked
 *
 * A thread is read far more often than it is acted on, and a reaction row plus a Reply under every
 * reply is a column of furniture between one sentence and the next. So the actions arrive in two
 * steps, and each is drawn to cost what it is worth:
 *
 * - **Edit and delete fade in with the pointer**, anywhere on the comment. They live in a row that is
 *   already there, so nothing moves as they appear — the transcript's pencil, and its `focusProps`,
 *   without which tabbing lands on something invisible.
 * - **The reactions and Reply are not drawn at all until the comment is pressed.** Mounting them on
 *   the press is what keeps a quiet thread quiet; it changes the row's height, which is why it is a
 *   deliberate press rather than a hover. A second press puts them away, and pressing another
 *   comment moves them there — one open at a time, because the row is about what you are answering.
 *
 * The press is on the words rather than on a button around them: a button cannot contain the links a
 * composition may hold. The cost is that a click ending a text selection also toggles the row, which
 * is worth knowing and cheaper than the alternatives.
 */
function replyBody(
  as: string,
  collapsed: string,
  opts: DiscussionSectionOptions,
  /**
   * Whether this reply may be folded. False for the reply the thread has been re-rooted at: it is
   * the thing being continued, so folding it would leave the panel showing a caret and nothing else
   * — and its branch is the thread below, whose folded ids live in a scope this copy is outside of.
   */
  foldable = true,
): SchemaNode[] {
  const fractal = opts.fractal;
  /** The controls this reply shows: while the pointer is on it, or while it is the open one. */
  const roused = `local.pointerOnReply || local.${OPEN} == ${as}.id`;
  return [
    {
      /*
        The whole comment, and whether the pointer is on it.

        On this column rather than on the byline's row, so crossing the words or the reactions counts
        as being on the comment — `hoverProps` answers for the element it is on, and an affordance
        that appeared only once you were over the exact row that holds it could not be found. The
        nested thread is a SIBLING of this column rather than a child (see `commentThread`'s row), so
        hovering a reply does not light up every ancestor it hangs from.

        Per reply: `$localState` on a node inside `$each` is created per row, so two replies cannot
        disagree about which one the pointer is on.
      */
      type: 'Column',
      props: {
        width: '100%',
        gap: '100',
        py: '100',
        onMouseEnter: { $setLocal: 'pointerOnReply', value: true },
        onMouseLeave: { $setLocal: 'pointerOnReply', value: false },
      },
      $localState: {
        pointerOnReply: { type: 'boolean', initial: false },
        // Set by a control in the byline, read and cleared by the row it sits in — see that row.
        pressedControl: { type: 'boolean', initial: false },
      },
      children: [
        /*
          Who, when — and, for your own words, what you may do to them.

          Compact: a reply's byline sits above two lines of text and under another reply, so at a
          post's weight it competes with the words it introduces. The name takes `text-muted` from
          the transcript's speaker line, which is the other place in WE where a name heads a line of
          conversation rather than a piece of content.
        */
        {
          /*
            The byline row, and a press on it opens the comment.

            Pressing the words does too, so the whole comment answers the same gesture — a reader who
            aims at the name rather than the sentence means the same thing by it. What must not
            answer it is a control *inside* the row: a schema cannot stop an event propagating, so
            the button marks the press as its own and the row reads the mark, which is the shape the
            kanban route uses to tell a press on a card from a press on the page.
          */
          type: 'Row',
          props: {
            ay: 'center',
            gap: '200',
            width: '100%',
            cursor: 'pointer',
            onClick: {
              $if: {
                condition: { $: 'local.pressedControl' },
                then: { $setLocal: 'pressedControl', value: false },
                else: { $setLocal: OPEN, value: { $: `local.${OPEN} == ${as}.id ? '' : ${as}.id` } },
              },
            },
          },
          children: [
            /*
              The caret, at the head of the line and before the face.

              Here rather than under the byline, which is where the rail starts: a caret on a row of
              its own is a whole row of chrome for one glyph, and on a folded branch it was the only
              row left. A reply with nothing under it keeps the width and draws no caret, so every
              byline in a thread starts at the same place.
            */
            /*
              Left out entirely where it cannot fold, rather than gated on a condition that is always
              false: the validator walks both branches of a `$if`, and rightly — a node referencing a
              local nothing declares is a mistake whether or not it draws. The slot stays, so a byline
              with no caret starts where its siblings do.
            */
            ...(foldable
              ? [
                  {
                    type: '$if',
                    props: {
                      condition: { $: `count(${as}.comments)` },
                      else: { type: 'Column', props: { width: '24px', flexShrink: '0' } },
                      then: {
                        type: 'we-tooltip',
                        props: { content: { $: `(${collapsed}) ? 'Show this branch' : 'Hide this branch'` } },
                        children: [
                          {
                            type: 'we-button',
                            props: {
                              variant: 'bare',
                              size: 'xs',
                              square: true,
                              color: 'text-faint',
                              label: 'Fold this branch',
                              onClick: [{ $setLocal: 'pressedControl', value: true }, foldToggle(as)],
                            },
                            children: [
                              {
                                type: 'we-icon',
                                props: { name: { $: `(${collapsed}) ? 'caret-right' : 'caret-down'` } },
                              },
                            ],
                          },
                        ],
                      },
                    },
                  } as SchemaNode,
                ]
              : [{ type: 'Column', props: { width: '24px', flexShrink: '0' } } as SchemaNode]),
            agentByline({
              did: { $: `${as}.author` },
              timestamp: { $: `${as}.createdAt` },
              compact: true,
              nameColor: 'text-muted',
            }),
            /*
              What a folded branch says instead of itself.

              Direct replies, not descendants: `count` reads the relation this reply holds, and the
              query language cannot walk a subtree — so "3 replies" is true where "3" as a total
              would be a guess. Beside the time, where the rest of the line's facts are.
            */
            {
              type: '$if',
              props: {
                condition: { $: `(${collapsed}) && count(${as}.comments)` },
                then: {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint' },
                  children: [
                    { type: 'we-number', props: { value: { $: descendantCount(as) } } },
                    { $: `plural(${descendantCount(as)}, ' reply', ' replies')` },
                  ],
                },
              },
            },
            /*
              Your own words, and what you may do to them.

              One gate over both: they are the same permission and it is yours alone. That is
              narrower than the rule `EdgeDetail` applies to a drawn connection, where anybody may
              retract a claim the community's records carry and the retraction being authored is what
              holds it accountable. A reply is not a claim about the records; it is somebody's
              sentence, and a neighbourhood being writable by every member is a fact about the
              protocol rather than an invitation to rewrite each other's speech.

              Faded rather than unmounted, so the row does not change width as the pointer crosses it
              and the buttons keep their place in the tab order.
            */
            {
              type: '$if',
              props: {
                condition: { $: `${as}.author == me.did` },
                then: {
                  type: 'Row',
                  props: {
                    gap: '100',
                    ay: 'center',
                    flexShrink: '0',
                    opacity: { $: `(${roused}) ? 1 : 0` },
                    focusProps: { opacity: 1 },
                    transition: 'opacity 200 ease-in-out',
                  },
                  children: [
                    {
                      type: 'we-tooltip',
                      props: { content: 'Edit this reply' },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            variant: 'ghost',
                            size: 'sm',
                            square: true,
                            // The transcript's pencil ink: a control on a line of conversation is a
                            // footnote until it is wanted, and it brightens under the pointer.
                            color: 'text-faint',
                            hoverProps: { color: 'text' },
                            label: 'Edit this reply',
                            onClick: [
                              { $setLocal: 'pressedControl', value: true },
                              { $setLocal: EDITING, value: { $: `${as}.id` } },
                            ],
                          },
                          children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
                        },
                      ],
                    },
                    {
                      type: 'we-tooltip',
                      props: { content: 'Delete this reply' },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            variant: 'ghost',
                            size: 'sm',
                            square: true,
                            color: 'danger-text',
                            /*
                              Red, and redder — not white.

                              `ghost`'s hover sets the foreground back to `text`, which turned the one
                              control that should look dangerous into the same grey as the rest at
                              the exact moment somebody was about to press it. Stating the colour in
                              `hoverProps` keeps it, and the tinted fill is what acknowledges the
                              pointer instead.
                            */
                            hoverProps: { color: 'danger-text', bg: 'danger-surface' },
                            label: 'Delete this reply',
                            onClick: [
                              { $setLocal: 'pressedControl', value: true },
                              { $setLocal: DELETING, value: { $: `${as}.id` } },
                            ],
                          },
                          children: [{ type: 'we-icon', props: { name: 'trash' } }],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
        /*
          The words and the actions, folded away together.

          `$animate` rather than `$if` for the same reason the branch below uses one: what is closed
          keeps its place rather than being rebuilt, and a fold is a thing you undo.
        */
        {
          type: '$animate',
          props: {
            condition: { $: `!(${collapsed})` },
            enterTransition: { type: 'reveal', duration: 200 },
          },
          children: [
            {
              type: 'Column',
              props: { width: '100%', gap: '100' },
              children: [
                /*
                  The words, flush with the face above them — and the press that opens the actions.

                  `rootClass` rather than a wrapper: `.we-block-content` pads every paragraph on all
                  four sides, which is a *document's* padding — it is what makes the hover highlight a
                  comfortable block in a composer. In a thread it insets the text from the byline and
                  puts a blank band over and under every line. The compact variant takes the
                  horizontal padding off and quarters the vertical; see `blocks.scss`, where the graph
                  card's equivalent lives beside it.
                */
                {
                  type: 'Column',
                  props: {
                    width: '100%',
                    cursor: 'pointer',
                    onClick: {
                      $setLocal: OPEN,
                      value: { $: `local.${OPEN} == ${as}.id ? '' : ${as}.id` },
                    },
                  },
                  children: [
                    {
                      type: 'BlockRenderer',
                      props: {
                        editorState: { $: `${as}.editorState` },
                        rootClass: 'we-block-content--compact',
                      },
                    },
                  ],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: `local.${OPEN} == ${as}.id` },
                    then: {
                      type: 'Row',
                      props: { gap: '300', ay: 'center', wrap: true, width: '100%' },
                      children: [
                        /*
                          Every reaction the community offers, on the reply itself.

                          The same controls the record gets, `inline` so they share the line with
                          "Reply" rather than taking it, and `xs` because a reaction is drawn at the
                          weight of the thing it is about. This was a read-only summary, which was the
                          wrong half of the pair: a count you cannot add to is a scoreboard, and a
                          thread is the one place where the thing being answered is somebody's
                          sentence. It costs nothing new — the types come from the subscription the
                          section already hoists, and each reply's signals from the `include` the
                          thread's own query already carries.
                        */
                        signalsSection({ record: as, as: `${as}Sig`, inline: true, size: 'xs' }),
                        // Whether this reply may be answered. Unconditional where the caller named no
                        // rule: a `$if` that can only ever be true is a node to build, resolve and
                        // walk on every reply at every level, for an answer the expansion already
                        // knows.
                        ...(fractal
                          ? [
                              {
                                type: '$if',
                                props: { condition: { $: fractal }, then: replyButton(as) },
                              } as SchemaNode,
                            ]
                          : [replyButton(as)]),
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
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
      [EDITING]: { type: 'string', initial: '' },
      [OPEN]: { type: 'string', initial: '' },
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
      /*
        The reply being rewritten, for the composer to open on.

        A composer at the section level cannot read a row bound inside the thread, and one *per* reply
        would be a modal per reply in the tree — so the id travels in a local and the record is
        fetched back by it, exactly as the re-rooted reply is. `when` keeps it asleep until somebody
        presses the pencil.
      */
      discussionEdit: {
        entity: 'CollectionBlock',
        where: { id: { $: `local.${EDITING}` } },
        when: { $: `local.${EDITING}` },
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
                    children: replyBody('focused', 'false', opts, false),
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
        collapsible: true,
        // The reply's own box is `replyBody`'s now — it holds whether the pointer is on the comment,
        // which is a fact about the whole comment rather than about any row inside it.
        reply: (as, collapsed) => replyBody(as, collapsed, opts),
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
            { type: 'we-number', props: { value: { $: descendantCount(as) } } },
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
      /*
        Rewriting one, seeded from what it says.

        Behind a `$if` on the record having arrived, which is not belt and braces: `composerModal`
        mounts on its own local, the local is set on the click, and the query answers a round trip
        later — so without the gate the composer opens **empty**, and Save would write that emptiness
        over somebody's words. Gated, it opens once there is something to open it with.
      */
      {
        type: '$if',
        props: {
          condition: { $: `count(local.discussionEdit) && local.${EDITING}` },
          then: composerModal({
            openLocal: EDITING,
            clearTo: '',
            title: 'Edit reply',
            saveLabel: 'Save',
            editorState: { $: 'first(local.discussionEdit).editorState' },
            saveAction: {
              $action: 'spaceStore.updatePost',
              // The id first: `updatePost(postId, json)` takes the tree second, which is why the
              // fragment asks a caller to place `arg` rather than appending it.
              args: [{ $: `local.${EDITING}` }, { $: 'arg' }],
            },
          }),
        },
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
