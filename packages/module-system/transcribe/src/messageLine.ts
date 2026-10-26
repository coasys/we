/**
 * One line of a conversation — what the transcript and the Feed both draw a message with.
 *
 * Who said it, when, how it arrived (typed, or corrected after it was heard), the line it answers,
 * and the words with their marks. Reply and Edit sit on the row and show on hover or focus, so a
 * long conversation reads as words rather than as a column of buttons.
 *
 * ## One line, two lists
 *
 * The Feed used to draw its own, written beside this one, and the two drifted: a text badge where
 * this has an icon, a Reply always showing, no Edit. Every fix had to be made twice. Now both lists
 * draw this, and what differs is passed in:
 *
 * - `as` — the name the list binds each line to.
 * - `surface` — which composer a reply started here belongs to. Both panels can be open at once, and
 *   a reply started in one must not be offered, or sent, by the other's box.
 * - `relative` — whether the time reads "2 min ago" or as a clock time.
 * - `extra` — anything a surface says beside the time; the Feed names the call a line came from.
 *
 * What it reads off a line: `id`, `author`, `text`, `marks` (as `content`), `source`, `createdAt`,
 * `updatedAt` and `replyTo` — the shape `threadLines` gives a transcript's rows, and the Feed's
 * lines carry the same.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

export function messageLine(opts: {
  /** The name each line is bound to by the list drawing it. */
  as: string;
  /** Where a reply started on this line is answered from. */
  surface: 'transcript' | 'feed';
  /** Whether the time reads relative to now. */
  relative: SchemaProp;
  /** Shown after the time. */
  extra?: SchemaNode;
}): SchemaNode {
  const { as } = opts;
  return {
    type: '$agent',
    props: { did: { $: `${as}.author` }, as: 'speaker' },
    children: [
      {
        type: 'Column',
        props: {
          /*
                      No fill, no padding — the gap between rows is what separates them.

                      A card each gave every utterance a box, and a transcript is a hundred of them:
                      the padding pushed the words apart far more than telling one line from the
                      next needs, and the whole feed read as a stack of tiles rather than as a
                      conversation. The gap does that job on its own.

                      It also stops the panel fighting whatever is behind it. A docked panel can be
                      floating over the content on a translucent ground, and a column of opaque
                      sunken rectangles cancels that out — the glass shows through the gaps and
                      nowhere else.
                    */
          gap: '100',
          /*
                      The row knows whether the pointer is on it, so its pencil can keep out of the
                      way until it is wanted.

                      Held here rather than by the button, which is the whole point: an affordance
                      that only appears once you are already on it cannot be found. `hoverProps` on
                      the button answers for the button, and there is no way to say "when my parent
                      is hovered" in props, so the parent says it instead — the same shape the
                      break-out grip uses in `PanelLane`, written with a local rather than a signal.
                    */
          onMouseEnter: { $setLocal: 'pointerOnRow', value: true },
          onMouseLeave: { $setLocal: 'pointerOnRow', value: false },
        },
        /*
                    Per row, which is what makes this a local rather than store state.

                    `$localState` on a node inside `$each` is created per row, so each line owns
                    whether it is being mended and the words being typed into it — no id to compare
                    against, and no way for two rows to disagree. The proposal editor needed a store
                    draft because *which fields exist* comes from the model; here the field is
                    `text` and nothing else, which is exactly the case locals are for.
                  */
        $localState: {
          mending: { type: 'boolean', initial: false },
          draft: { type: 'string', initial: '' },
          pointerOnRow: { type: 'boolean', initial: false },
        },
        children: [
          {
            /*
                        Somebody has to give up the space, and it is the name.

                        A row that overflows is a row where nobody said who yields: a flex item's
                        automatic minimum size is its content, so the deficit comes out of whichever
                        sibling *can* shrink. Here that was the marks — and worse than usual,
                        because the design system defaults typography to `overflow-wrap: anywhere`,
                        which reduces a word's min-content width to a single glyph. "(edited)" could
                        therefore shrink to nearly nothing and broke mid-word onto two lines.

                        The name is the one thing on the row with a sensible narrower form, and it
                        already asks to be truncated — which needs `minWidth: 0` to happen at all,
                        since without it the item is never asked to be narrower than its text.
                      */
            type: 'Row',
            props: { gap: '200', ay: 'center' },
            children: [
              {
                type: 'we-avatar',
                props: {
                  // `xs`, not `xxs`. A transcript is a list of people talking, so who is
                  // speaking is the second thing on the row after the words — at the
                  // smallest size on the scale a face is a coloured dot and the run of
                  // them stops being scannable.
                  size: 'xs',
                  image: { $: 'speaker.avatar' },
                  // Always alongside `image`, never instead of it: a stable
                  // generated avatar keeps somebody whose profile has not
                  // arrived visually distinct from everybody else whose
                  // profile has not arrived.
                  hash: { $: `${as}.author` },
                },
              },
              {
                type: 'we-text',
                // `label` rather than `footnote` — one step up the scale, and the weight
                // that comes with it is wanted here: a name is what the eye lands on when
                // skimming a transcript for who said something.
                props: {
                  variant: 'label',
                  color: 'text-muted',
                  truncate: true,
                  /*
                              Shrink, but never grow — `0 1 auto`, not `1 1 auto`.

                              A grow factor made the name take every spare pixel on the row, which
                              pushed the clock, the marks and the pencil to the far edge. Nothing
                              here wants to be right-aligned; the name only ever needed permission
                              to *give up* space, which is the shrink half. `minWidth: 0` is what
                              lets it, since a flex item is otherwise never asked to be narrower
                              than its own text.
                            */
                  flex: '0 1 auto',
                  minWidth: '0',
                },
                children: [{ $: 'speaker.name' }],
              },
              {
                /*
                            How long ago while it is still happening; what time it was once it is not.

                            Relative time answers "how fresh is this?", which is a question about a
                            feed of unrelated items. A transcript is not one: every row came out of
                            the same conversation, so on a call recorded last Tuesday all two hundred
                            of them read "6 days ago" — the same string on every line, carrying no
                            information and taking the width that made the row wrap. What a reader
                            wants from a line of a finished meeting is where in it the line was, and
                            that is the clock.

                            On the live call relative earns its place: the tail is minutes old, the
                            numbers differ row to row, and they move on their own.

                            `narrow` for the live side because a transcript stamp is a *coordinate* —
                            something skimmed past to find a moment, not read — and a coordinate wants
                            to be terse at any width. That is a fact about the row rather than about
                            the panel, so it is not conditional on how much room there is.

                            One node rather than an `$if` on the two: `relative` short-circuits inside
                            the primitive, so `timeStyle` simply goes unread while it is true. A
                            branch here would unmount and rebuild the row every time a call ended.

                            ## Last on the row, after the marks

                            It used to sit before them, and in `en-US` that put "Aa" hard against
                            "PM" — two letterforms beside two letterforms in the same faint grey,
                            reading as one word. Moving the marks up to the name fixes it by
                            separation rather than by decoration, which is what makes it hold: an
                            `en-GB` reader sees "14:32" and never had the collision, so an
                            icon-level or colour-level fix would have been treating one locale's
                            symptom. The mark is about the line and the time is about the moment;
                            they were only ever neighbours by accident.
                          */
                type: 'we-timestamp',
                props: {
                  value: { $: `${as}.createdAt` },
                  relative: opts.relative,
                  relativeStyle: 'narrow',
                  timeStyle: 'short',
                  fontSize: '100',
                  color: 'text-faint',
                },
              },
              // What a surface says about a line beyond the transcript's own — the Feed
              // names the call it came from.
              ...(opts.extra ? [opts.extra] : []),
              /*
                          What this line is, where it is not simply what somebody said.

                          Only ever shown for the two that are not plain speech, and `spoken` stays
                          silent. That is the whole economy of the thing: a transcript is speech
                          almost all the way down, so marking it would put furniture on every row to
                          restate the panel's own title, and a mark that appears everywhere is one
                          people stop reading. The reader's default assumption is already right; the
                          mark exists for where it would not be.

                          Which is also why neither of these is a sparkle. Machine-heard is the
                          assumption here, so "this came from a model" is not news — that icon earns
                          its place on an extraction card, where a record stands for something
                          inferred and the reader would otherwise have no way to tell.
                        */
              {
                /*
                            Typed: an icon, because it is a provenance nicety rather than a warning.

                            `text-aa` rather than `keyboard`, which was the first guess and the
                            wrong one: a keyboard is a grid of small keys, and at 12px they merge
                            into a grey smudge that reads as "some icon". Two letterforms survive
                            the size and say "text" on sight.

                            And not a pencil, which is the edit button two elements along this same
                            row — one glyph cannot mean both "written rather than spoken" and
                            "change these words". `translate` means language and `key-return` means
                            submit; both are the wrong claim rather than an unclear one.
                          */
                type: '$if',
                props: {
                  condition: { $: `${as}.source == 'typed'` },
                  then: {
                    type: 'we-tooltip',
                    // No `flexShrink` here: the tooltip generates no box, so the badge
                    // inside it is the flex item and its own refusal to shrink is what
                    // counts. That is the whole point of the wrapper being boxless.
                    props: { content: 'Typed, not spoken', placement: 'top' },
                    children: [
                      {
                        /*
                                    A chip, not a bare icon — because bare it read as part of the
                                    clock beside it.

                                    In `en-US` the time ends "AM" or "PM", and two letterforms in
                                    the same faint grey immediately after two more letterforms are
                                    one word to the eye. Moving the mark to the other side of the row
                                    was tried first and did not help: what separates them is a
                                    *ground*, not a gap, so the mark stops being loose text on the
                                    row and becomes a thing sitting on it.

                                    `control-surface` is a step away from both `surface` and
                                    `surface-sunken` in either polarity, which is the whole reason
                                    the neutral badge is painted with it — see
                                    BADGE_VARIANT_DEFAULTS, where this same transcript row is the
                                    case that argued it. The row carried a sunken fill when that was
                                    written and carries none now, and the choice survives the change
                                    precisely because it was made against both grounds.
                                  */
                        type: 'we-badge',
                        props: { size: 'xs' },
                        /*
                                    A keyboard, because this marks *how the line arrived* rather than
                                    that it is text — everything on this row is text.

                                    It was `text-aa`, which is the glyph the record button in this
                                    panel's own header now uses for transcription, as the call bar
                                    always did. One surface cannot spend the same letterform on "this
                                    module makes text" at the top and "somebody typed this" a few
                                    rows down, so the more literal mark takes this one. It also stays
                                    clear of "(edited)", which is the other provenance signal on
                                    these rows.

                                    Sized between the badge's own xxs (12px) and xs (16px). The
                                    badge's height is fixed per size, so a larger glyph fills it
                                    rather than stretching it.
                                  */
                        children: [{ type: 'we-icon', props: { name: 'keyboard', size: '14px' } }],
                      },
                    ],
                  },
                },
              },
              {
                /*
                            Corrected: words, not an icon behind a hover.

                            This one is a claim about whether the line is still a verbatim quote, and
                            `editUtterance`'s own note is the reason it cannot be hover-only — a
                            mended line reading as something somebody said is a claim nobody checked.
                            A tooltip is invisible on a touchscreen and to anyone not poking at rows,
                            which is exactly the wrong property for a trust signal.

                            "(edited)" rather than a badge or an asterisk: it is lighter than the
                            badge it replaces, needs no legend, and is the convention every reader
                            already holds from chat. An asterisk needs learning, and a star reads as
                            a rating.

                            The tooltip is then the upgrade rather than the message — it says *when*,
                            which is worth having and worth nothing if it is the only channel.
                          */
                type: '$if',
                props: {
                  condition: { $: `${as}.source == 'corrected'` },
                  then: {
                    type: 'we-tooltip',
                    props: { placement: 'top' },
                    children: [
                      {
                        type: 'we-text',
                        // `nowrap` because this is one atomic phrase with no narrower
                        // form, and the `anywhere` default would otherwise let it break
                        // between any two letters rather than not at all.
                        props: { variant: 'footnote', color: 'text-faint', whiteSpace: 'nowrap' },
                        children: ['(edited)'],
                      },
                      {
                        /*
                                    A formatted time, which is why this is slotted content rather
                                    than the `title` string: a schema has no way to format a date,
                                    and `updatedAt` arrives as epoch milliseconds. `we-timestamp`
                                    already knows how, so the tooltip holds one.

                                    `updatedAt` comes back on every fetch beside `author` and
                                    `createdAt` — no field to declare. What it cannot say is *who*:
                                    `author` stays the original speaker, and anybody may mend a line.
                                  */
                        type: 'Row',
                        props: { gap: '100', ay: 'center' },
                        slot: 'content',
                        children: [
                          { type: 'we-text', props: { variant: 'footnote' }, children: ['Edited'] },
                          {
                            type: 'we-timestamp',
                            props: {
                              value: { $: `${as}.updatedAt` },
                              relative: opts.relative,
                              relativeStyle: 'narrow',
                              timeStyle: 'short',
                              fontSize: '100',
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              },
              /*
                          The correction affordance, on the row it corrects.

                          Offered on every line rather than only your own: a recogniser mishears
                          names and jargon, and whoever notices is usually not the speaker. See
                          `editUtterance` for what that costs and what is recorded about it.
                        */
              // Answer this line — the composer below then says so, and sends a reply.
              {
                type: 'we-tooltip',
                props: { content: 'Reply' },
                children: [
                  {
                    type: 'we-button',
                    props: {
                      label: 'Reply',
                      size: 'xs',
                      variant: 'bare',
                      color: 'text-faint',
                      opacity: { $: 'local.pointerOnRow ? 1 : 0' },
                      onClick: {
                        $invoke: 'modules.transcribe.startReply',
                        args: [
                          {
                            $: `{ id: ${as}.id, text: ${as}.text, author: ${as}.author, surface: '${opts.surface}' }`,
                          },
                        ],
                      },
                    },
                    children: [{ type: 'we-icon', props: { name: 'arrow-bend-up-left' } }],
                  },
                ],
              },
              {
                type: '$if',
                props: {
                  condition: { $: '!local.mending' },
                  then: {
                    type: 'we-tooltip',
                    props: { content: 'Edit text' },
                    children: [
                      {
                        type: 'we-button',
                        props: {
                          label: 'Edit text',
                          size: 'xs',
                          variant: 'bare',
                          color: 'text-faint',
                          /*
                                      Out of the way until the row is pointed at — and back the
                                      moment it is focused.

                                      A pencil on all two hundred rows is furniture on the ordinary
                                      case, which is reading. Faded rather than unmounted, so the
                                      row does not change width as the pointer crosses it, and so
                                      the button keeps its place in the tab order.

                                      `focusProps` is the half that stops this being a mouse-only
                                      affordance: it fires on `:focus-visible`, so tabbing to the
                                      pencil brings it back into view even though nothing is
                                      hovering it. Without that pair, a keyboard user would be
                                      moving focus onto something invisible.
                                    */
                          opacity: { $: 'local.pointerOnRow ? 1 : 0' },
                          focusProps: { opacity: 1 },
                          transition: 'opacity 200 ease-in-out',
                          onClick: [
                            // Seeded on the press rather than at mount, so a row reopened
                            // after a cancel starts from the words as they now stand.
                            { $setLocal: 'draft', value: { $: `${as}.text` } },
                            { $setLocal: 'mending', value: true },
                          ],
                        },
                        children: [{ type: 'we-icon', props: { size: 'xs', name: 'pencil-simple' } }],
                      },
                    ],
                  },
                },
              },
            ],
          },
          {
            // Reading, or mending. The field replaces the words rather than sitting under
            // them, so what is being changed is the thing on screen.
            type: '$if',
            props: {
              condition: { $: 'local.mending' },
              then: {
                type: 'Column',
                props: { gap: '200' },
                children: [
                  {
                    /*
                                One row, growing — and reading at the size of the words it replaces.

                                Two rows was half a box of empty space under a line that is usually
                                one line long. `autoGrow` starts it at the height of the text it is
                                standing in for and takes the room only when there is something to
                                put in it, which is the same behaviour the composer at the foot of
                                the panel has.

                                `fontSize` is pinned because `size: 'sm'` carries one: the size
                                presets set padding *and* type, so a compact control also shrank the
                                words — mending a line made it visibly smaller than the line beside
                                it, and switching to `md` would have fixed the type by making the box
                                bigger. The two are separable, so they are separated here.
                              */
                    type: 'we-textarea',
                    props: {
                      size: 'sm',
                      fontSize: '300',
                      rows: 1,
                      autoGrow: true,
                      maxRows: 6,
                      submitOnEnter: true,
                      value: { $: 'local.draft' },
                      onInput: { $setLocal: 'draft', value: { $: 'event.detail' } },
                      'on:submit': {
                        $invoke: 'modules.transcribe.editUtterance',
                        args: [{ $: `${as}.id` }, { $: 'local.draft' }, { $: `${as}.source` }],
                        onSuccess: [{ $setLocal: 'mending', value: false }],
                      },
                    },
                  },
                  {
                    type: 'Row',
                    props: { gap: '200', ay: 'center' },
                    children: [
                      {
                        type: 'we-button',
                        props: {
                          size: 'xs',
                          /*
                                      Primary, not success. Green is the palette for an *outcome* —
                                      it says something went well — and this button is a plain
                                      submit that has not done anything yet. The Keep/Discard pair on
                                      a proposal card is the case that earns success and danger,
                                      because there the colour IS the decision being offered.
                                    */
                          variant: 'solid',
                          disabled: { $: '!trim(local.draft)' },
                          onClick: {
                            $invoke: 'modules.transcribe.editUtterance',
                            args: [{ $: `${as}.id` }, { $: 'local.draft' }, { $: `${as}.source` }],
                            // Closed on success only: a failed write leaves the words on
                            // screen to try again with, rather than discarding them and
                            // showing the line unchanged as though nothing was attempted.
                            // `pointerOnRow` for the reason Cancel sets it — the row
                            // reflows out from under the pointer either way out.
                            onSuccess: [
                              { $setLocal: 'mending', value: false },
                              { $setLocal: 'pointerOnRow', value: false },
                            ],
                          },
                        },
                        children: ['Save'],
                      },
                      {
                        type: 'we-button',
                        props: {
                          size: 'xs',
                          // Secondary rather than ghost: ghost has no edge until it is
                          // hovered, so beside a filled Save it read as a word somebody
                          // had left next to a button rather than the other half of a
                          // pair.
                          variant: 'soft',
                          /*
                                      Both, and the second is what stops the pencil flashing.

                                      Leaving the editor makes the row shorter — a field and two
                                      buttons become one line of text — so it reflows out from under
                                      a pointer that was on the Cancel button. The read view mounts
                                      with `pointerOnRow` still true, so the pencil fades in, and the
                                      pointer is then outside the shrunken row, so it fades straight
                                      back out. Two hundred milliseconds each way, which is exactly
                                      long enough to read as a glitch.

                                      Saying the pointer has left is a small lie when it has not,
                                      and it corrects itself on the next mouse move — where the
                                      flash corrects itself by being wrong twice.
                                    */
                          onClick: [
                            { $setLocal: 'mending', value: false },
                            { $setLocal: 'pointerOnRow', value: false },
                          ],
                        },
                        children: ['Cancel'],
                      },
                    ],
                  },
                ],
              },
              else: {
                type: 'Column',
                props: { gap: '100' },
                children: [
                  /*
                              What this answers, first: its speaker's line, one line of it. A reply to a
                              reply quotes its direct parent only, and a parent since removed says so
                              rather than leaving a quote of nothing.
                            */
                  {
                    type: '$if',
                    props: {
                      condition: { $: `${as}.replyTo` },
                      then: {
                        type: 'we-text',
                        props: { variant: 'footnote', color: 'text-muted', truncate: true },
                        children: [
                          {
                            $: `'↳ ' + (${as}.replyTo.text ? ${as}.replyTo.text : 'original message removed')`,
                          },
                        ],
                      },
                    },
                  },
                  {
                    // Marks — a mention, a link, emphasis — drawn the way a post draws them; plain text as text.
                    type: '$if',
                    props: {
                      condition: { $: `${as}.content` },
                      then: {
                        type: 'Column',
                        props: { width: '100%' },
                        children: [
                          {
                            type: 'BlockRenderer',
                            props: {
                              editorState: { $: `${as}.content` },
                              rootClass: 'we-block-content--compact',
                            },
                          },
                        ],
                      },
                      else: {
                        type: 'we-text',
                        props: { color: 'text' },
                        children: [{ $: `${as}.text` }],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    ],
  };
}
