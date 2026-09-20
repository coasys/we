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

import { commentThread, descendantCount, foldToggle, railHighlight, resetTopLimit } from '../lists/commentThread.ts';
import { agentByline } from './agentByline.ts';
import { signalsSection } from './signals.ts';

/** The reply the MODAL composer is open on, or empty. Holds the answer rather than a flag. */
const REPLY_TO = 'discussionReplyTo';
/**
 * The inline composer's identity, bumped to throw it away and mount a fresh one.
 *
 * A modal resets by unmounting, which is most of why the composer was one. An inline composer never
 * unmounts, so after a reply is written it would go on holding the words that were just posted. The
 * counter is rendered through a one-item `$each`, which maps to `<For>` — a primitive that changes
 * value is a different item, so the old composer is removed and a new one built. That is the whole
 * reset, and it is a fact about `<For>` rather than a trick: the alternative was a `clear()` on
 * `BlockComposer`, which is a component change to serve one call site.
 */
const COMPOSER_KEY = 'discussionComposerKey';
/** Whether the inline composer holds anything worth posting — from `onDirtyChange`. */
const COMPOSER_DIRTY = 'discussionComposerDirty';
/** The inline composer's save function, handed over once by `onReady`. See `composerModal`. */
const COMPOSER_SAVE = 'discussionComposerSave';
/** A reply written inline is in flight. */
const COMPOSER_BUSY = 'discussionComposerBusy';
/** The reply the thread is currently rooted at, or empty for the record itself. */
const ROOT = 'discussionRoot';
/** The reply whose delete is being confirmed, or empty. The same trick `REPLY_TO` uses. */
const DELETING = 'discussionDeleting';
/** The reply being rewritten, or empty. The same trick again — one composer serves every level. */
const EDITING = 'discussionEditing';
/**
 * The replies whose actions are showing, by id.
 *
 * Ids rather than a flag per row, for the reason the fold is a set of ids: rows come from a
 * subscription, so a boolean on the row is lost the moment anybody replies anywhere and the query
 * answers again.
 *
 * A SET rather than one at a time, which is the change. The single-id version read the row as "what
 * you are answering", and on that reading one open row is right — but it is not what the row turned
 * out to be for. Opening a reply is mostly how you find out what people made of it, and with one
 * slot that is a question you can only ask about one comment at a time: opening the next one closed
 * the counts you were comparing it against. The furniture argument still holds for a thread left
 * wide open, and the answer to that is that every row closes with a second press on itself.
 */
const OPEN = 'discussionOpen';

export interface DiscussionSectionOptions {
  /** Context key of the record being discussed — `'row'`, `'link'`, `'card'`. */
  record: string;
  /** Whether a reply may itself be replied to, as an expression. Defaults to always. */
  fractal?: string;
  /** Levels drawn before the thread offers to re-root. Defaults to 3, as `commentThread` does. */
  depth?: number;
  /**
   * How many replies to fetch at each depth, per parent — `[10, 5, 3]` by default.
   *
   * The thread is one question the backend walks depth by depth, so the bound applies at every
   * level rather than to the total: one branch that attracted three hundred replies cannot crowd
   * out the rest of the conversation, and the thread stays the shape of the discussion rather than
   * the shape of its loudest corner.
   */
  perLevel?: number[];
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
  /** The controls this reply shows: while the pointer is on it, or while it is one of the open ones. */
  const roused = `local.pointerOnReply || ${as}.id in local.${OPEN}`;
  /** Show this reply's controls, or hide them again. */
  const openToggle: SchemaProp = { $toggleLocalIn: OPEN, value: { $: `${as}.id` } };
  /*
    What a press on the byline means, which depends on whether the comment is folded.

    Written out here rather than inline because the folded branch names the fold state, and a reply
    that cannot fold is rendered outside the scope declaring it — the validator walks both branches
    of a `$if` and is right to, so the choice is made in TypeScript where the answer is known.
  */
  const unfoldOrOpen: SchemaProp = foldable
    ? { $if: { condition: { $: collapsed }, then: foldToggle(as), else: openToggle } }
    : openToggle;
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
        /*
          No gap between the byline and what is under it, and the gutter puts its own back.

          The words wanted to sit closer to the name than the caret does: a byline is a heading for
          the sentence beneath it, and a gap that reads as right beside a 24px control reads as a
          hole beside a line of text. One gap here could not say both — it is the space above the
          Row, and the caret and the words are in the same Row — so it goes to nothing and the
          gutter column restates it. See `mt` there.
        */
        gap: '0',
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
            /*
              Not dimmed when folded.

              It read as unavailable rather than as closed, which is the opposite of what a folded
              branch is: the stub is the way back in, and the biggest target the row has. The caret
              and the "3 replies" beside it already say the branch is shut, and they say it without
              making the name and the face harder to read — which are the two things somebody scans
              a folded thread FOR.
            */
            onClick: {
              $if: {
                condition: { $: 'local.pressedControl' },
                then: { $setLocal: 'pressedControl', value: false },
                /*
                  Folded, the whole stub is the way back open — the biggest target the row has, and
                  the only one a touchscreen can offer, since there is no hover to reveal anything
                  on. It replaces a caret that sat before the face and moved it sideways every time
                  a branch closed.

                  Open, the same press does what it always did and shows the reply's own controls.
                  One gesture either way: on a folded comment "open it" and "expand it" are not two
                  different things to want.
                */
                else: unfoldOrOpen,
              },
            },
          },
          children: [
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
                  // At the end of the line rather than before the face: nothing is inserted to the
                  // left of the avatar, so folding a branch no longer moves it.
                  type: 'Row',
                  props: { ay: 'center', gap: '100', flexShrink: '0' },
                  children: [
                    {
                      type: 'we-text',
                      props: {
                        variant: 'footnote',
                        color: 'text-faint',
                        // "1 reply" is three words that mean one thing; the wrap default would set
                        // it a letter per line the moment the row ran short.
                        whiteSpace: 'nowrap',
                      },
                      children: [
                        { type: 'we-number', props: { value: { $: descendantCount(as) } } },
                        { $: `plural(${descendantCount(as)}, ' reply', ' replies')` },
                      ],
                    },
                    { type: 'we-icon', props: { name: 'caret-right', size: 'xs', color: 'text-faint' } },
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
          /*
            The comment itself, hung under the face rather than under the caret.

            The gutter is the width of an `xs` avatar and carries the byline's own gap, so the words
            start exactly where the name above them does — a hanging indent from a person, which is
            what a comment is. It holds the caret while the branch is open: the caret is the head of
            the line that runs down past these words and beside the replies, so it belongs at the
            top of that line rather than beside the face.

            Empty but present for a reply with no branch, because the alignment is about the face
            above, not about having something to fold.
          */
          type: 'Row',
          props: { width: '100%', gap: '200', ay: 'stretch' },
          children: [
            {
              type: 'Column',
              // `mt` is the gap the parent gave up so the words could sit closer to the name — the
              // caret keeps the distance it had. See the note on the parent's `gap`.
              props: { width: '24px', flexShrink: '0', ax: 'center', gap: '0', mt: '100' },
              children: foldable
                ? [
                    {
                      /*
                        The caret and its line, as one control.

                        Two buttons, because a caret is a glyph and a line is a column — but one
                        tooltip over both and one highlight across both, so what reads as a single
                        affordance behaves as one. The tooltip wraps them rather than sitting on the
                        caret, which is what let a press on the line say nothing.
                      */
                      type: '$if',
                      props: {
                        condition: { $: `!(${collapsed}) && count(${as}.comments)` },
                        then: {
                          type: 'we-tooltip',
                          props: { content: 'Hide this branch', flex: '1', width: '100%' },
                          children: [
                            {
                              type: 'Column',
                              props: { width: '100%', flex: '1', ax: 'center' },
                              children: [
                                {
                                  type: 'we-button',
                                  props: {
                                    variant: 'bare',
                                    size: 'xs',
                                    width: '100%',
                                    r: '0',
                                    color: 'text-faint',
                                    label: 'Fold this branch',
                                    ...railHighlight(),
                                    onClick: foldToggle(as),
                                  },
                                  children: [{ type: 'we-icon', props: { name: 'caret-down' } }],
                                },
                                {
                                  /*
                                    The rest of the line, beside the words.

                                    `commentThread` draws the rail beside the REPLIES; this is the
                                    segment above it, running from the caret down past however many
                                    paragraphs the comment has. Without it a tall comment left the
                                    caret stranded at the top and the line starting under the text.
                                  */
                                  type: 'we-button',
                                  props: {
                                    variant: 'bare',
                                    width: '100%',
                                    flex: '1',
                                    ax: 'center',
                                    r: '0',
                                    label: 'Fold this branch',
                                    ...railHighlight(),
                                    onClick: foldToggle(as),
                                  },
                                  children: [{ type: 'Column', props: { width: '1px', height: '100%', bg: 'border' } }],
                                },
                              ],
                            },
                          ],
                        },
                      },
                    } as SchemaNode,
                  ]
                : [],
            },
            {
              type: 'Column',
              props: { flex: '1', minWidth: '0' },
              children: [
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
                            onClick: openToggle,
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
                            condition: { $: `${as}.id in local.${OPEN}` },
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
      [OPEN]: { type: 'array', initial: [] },
      [COMPOSER_KEY]: { type: 'number', initial: 0 },
      [COMPOSER_DIRTY]: { type: 'boolean', initial: false },
      [COMPOSER_SAVE]: { type: 'function', initial: null },
      [COMPOSER_BUSY]: { type: 'boolean', initial: false },
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
                  /*
                    No reset here, and not only because this button sits outside the thread's own
                    scope: going back is returning to a list you were already reading, and entering
                    the branch reset it on the way in. Resetting again would be resetting twice for
                    one journey.
                  */
                  onClick: { $setLocal: ROOT, value: '' },
                },
                children: [{ type: 'we-icon', props: { name: 'arrow-left' } }, 'Back to the whole thread'],
              },
              {
                type: '$each',
                props: { items: { $: 'local.discussionFocus' }, as: 'focused' },
                children: [
                  {
                    /*
                      The reply being continued, drawn as itself and marked as the context it is.

                      `accent-muted` rather than `surface-sunken`. Sunken is `page` minus 0.035 of
                      lightness, and the panel this sits in paints `page` — so the card the whole
                      scoped view hangs off was three and a half percent different from its
                      background and read as nothing at all. A tint is also the truer answer: this
                      is the SELECTED thing, which is what `accent-muted` is for, where sunken means
                      a well cut into a surface.

                      The rule down the left edge is back, in the accent and at 3px. It was taken
                      off once because a vertical line beside a comment is the thread's own
                      vocabulary for a foldable branch — but the fold's line is a hairline in a 24px
                      gutter OUTSIDE the comment, and this is a thick coloured edge ON the card.
                      Nobody is going to press it expecting a fold, and the pair together — tint and
                      edge — is what makes the anchor legible above a list of replies that are all
                      the same shape as it.
                    */
                    type: 'Column',
                    props: {
                      gap: '100',
                      width: '100%',
                      p: '300',
                      r: 'surface',
                      bg: 'accent-muted',
                      borderLeft: '3px solid accent',
                    },
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
        /*
          How many replies the thread's anchor has — the record's own, or the reply the thread has
          been re-rooted on, which `discussionFocus` is already fetching for the header. Without it
          the top level cannot tell a full page from a complete one, and would offer more that
          sometimes revealed nothing.
        */
        anchorTotal: `local.${ROOT} ? count(first(local.discussionFocus).comments) : count(${opts.record}.comments)`,
        ...(opts.perLevel !== undefined && { perLevel: opts.perLevel }),
        collapsible: true,
        // The reply's own box is `replyBody`'s now — it holds whether the pointer is on the comment,
        // which is a fact about the whole comment rather than about any row inside it.
        reply: (as, collapsed) => replyBody(as, collapsed, opts),
        // The limit, made a door — see the docblock. The count is the same one the default sentence
        // shows; what changes is that pressing it goes there.
        more: (as) => ({
          type: 'we-button',
          props: {
            /*
              Words, not a button. This is the foot of a list rather than an action beside it, and
              both a fill and a ghost's padding made it a block sitting under the conversation. Bare
              keeps the button — the role, the keyboard, the disabled state — and takes the
              appearance off, so what is left is a line of text that brightens under the pointer.
            */
            variant: 'bare',
            size: 'sm',
            ax: 'start',
            color: 'text-faint',
            hoverProps: { color: 'text' },
            // Asymmetric on purpose: this line belongs to the branch ABOVE it and was sitting on
            // the last reply's words. The space over it is what makes it read as the foot of that
            // branch rather than as another line of it.
            pt: '300',
            pb: '100',
            // Re-rooting shows a different list, so how much of the last one was asked for does
            // not carry across — see `resetTopLimit`.
            onClick: [{ $setLocal: ROOT, value: { $: `${as}.id` } }, resetTopLimit(opts.perLevel)],
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

        The same anchor the thread reads, so a reply written here always answers "the thing above
        these replies" wherever the reader has got to. Below the thread rather than above it, where
        the conversation ends and a new line goes.

        ## Inline here, a modal for a reply to a reply

        Adding to the conversation is the common case and should cost nothing: a button that opens a
        modal to type one sentence is a door in front of a doorway. So the composer is simply here,
        and somebody can start typing.

        Answering one particular reply, four levels down, keeps the modal — and the reason is the
        width rather than the interaction. A nested composer inherits its row's indent, which in a
        320px panel leaves too little to write in; made full-width instead, it is no longer beside
        the thing it answers and needs a label saying what it is replying to, at which point it is a
        modal with worse manners. The modal also lets ONE composer serve every depth, which is why
        `REPLY_TO` holds an id rather than a flag — a composer per reply row is a real editor per
        reply row.
      */
      {
        type: 'Column',
        props: { gap: '200', width: '100%' },
        children: [
          {
            /*
              One item, whose value is the composer's identity — see `COMPOSER_KEY`. `$each` is
              `<For>`, so bumping the number throws this composer away and builds a fresh one, which
              is how an inline composer gets the reset a modal gets by closing.
            */
            type: '$each',
            props: { items: { $: `[local.${COMPOSER_KEY}]` }, as: 'composerKey' },
            children: [
              {
                type: 'Column',
                props: {
                  width: '100%',
                  bg: 'surface',
                  border: '1px solid border',
                  r: 'surface',
                },
                children: [
                  {
                    type: 'BlockComposer',
                    props: {
                      /*
                        No gutter. A reply is a line, not a page: a 50px strip of chrome beside two
                        words was most of what the box had to show, and it made an input that was
                        meant to be unremarkable look like an editor somebody had embedded.

                        What it costs is nearly nothing — `/` still reaches every block type, and
                        reordering matters to a document with sections in a way it does not to a
                        sentence answering somebody. What a reply IS does not change: it is the same
                        composition, and it opens in a full composer, handles and all, when edited.
                      */
                      handles: false,
                      /*
                        And it does not take the cursor. This composer mounts when the thread does,
                        which is whenever a card is selected — so the cursor landed in the reply box
                        a beat after the click, while the conversation above it was still arriving.
                        A modal keeps the focus: it is on screen because somebody asked for it.
                      */
                      autoFocus: false,
                      onDirtyChange: { $setLocal: COMPOSER_DIRTY, value: { $: 'event' } },
                      onReady: { $setLocal: COMPOSER_SAVE, value: { $: 'event.save' } },
                      onSave: [
                        { $setLocal: COMPOSER_BUSY, value: true },
                        {
                          $action: 'spaceStore.createPost',
                          // The tree first: `createPost(json, options)`. `we://comment` rather than
                          // `we://children` — a reply answers the thing rather than becoming part
                          // of it, which is what lets a reply be a composition with children.
                          args: [
                            { $: 'arg' },
                            { kind: 'reply', parentId: { $: anchor }, predicate: 'we://comment' } as SchemaProp,
                          ],
                          onSuccess: [
                            { $setLocal: COMPOSER_KEY, value: { $: `local.${COMPOSER_KEY} + 1` } },
                            { $setLocal: COMPOSER_DIRTY, value: false },
                          ],
                          onFinally: [{ $setLocal: COMPOSER_BUSY, value: false }],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
          {
            type: 'Row',
            props: { gap: '300', ax: 'end', width: '100%' },
            children: [
              {
                type: 'we-button',
                props: {
                  variant: 'primary',
                  size: 'sm',
                  /*
                    Present and refusing, rather than absent until there is something to post.

                    A button that appears once you start typing moves everything under it on the
                    first keystroke, in a panel that is usually already scrolled — and it cannot be
                    found by somebody looking for how to send. Disabled says the same thing without
                    changing the height of the page.
                  */
                  disabled: { $: `!local.${COMPOSER_DIRTY} || local.${COMPOSER_BUSY}` },
                  loading: { $: `local.${COMPOSER_BUSY}` },
                  onClick: { $callLocal: COMPOSER_SAVE },
                },
                children: ['Reply'],
              },
            ],
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
