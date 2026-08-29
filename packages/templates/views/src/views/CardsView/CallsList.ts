import type { SchemaNode } from '@we/schema-shared';
import { expr } from '@we/schema-shared';
import {
  agentByline,
  cardList,
  cardShell,
  confirmModal,
  emptyState,
  field,
  formModal,
  peopleRow,
} from '@we/template-kit';

/**
 * Recorded calls in this space.
 *
 * A call's record is a `CollectionBlock` with `kind: 'call'` — its utterances are the children, its
 * roster is `participants`, and it hangs off whatever node the call was about via `WeNode.calls`.
 * So this is an ordinary entity list like every other section here; no new machinery.
 *
 * The shape is `docs/architecture/transcripts.md`. `'call'` is spelled here rather than imported
 * because `templates → modules` is a sideways edge; that page lists everyone else who spells it.
 *
 * **A record exists if and only if somebody spoke while transcription was on.** It is created on the
 * first utterance rather than when a call starts, so this list is not call history — a call nobody
 * recorded leaves nothing, by design. Call history for every call is a separate feature with a
 * different creation policy, and smuggling it in through this one would produce a lot of empty rows.
 *
 * `kind` is queried rather than a tag: it is a scalar, so `eq` pushes down to the backend and
 * composes with `order` and `limit`. A tag relation would need a traversal in the direction the
 * query layer does not go.
 */
/**
 * This call's utterances — the transcript, and nothing extraction wrote.
 *
 * A scoped drill-down rather than a filter over `children`, because children arrive as bare ids and
 * the ids alone cannot say which are utterances.
 */
const utterancesQuery = {
  entity: 'TextBlock',
  scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: 'call.id' } },
};
/** Hoisted on each call's card as `utterances`. */
const utterances = { $: 'local.utterances' };

/** What a call's card subscribes to. The findings are per-model and hoisted below. */
const callQueries = { utterances: utterancesQuery };

/**
 * Records of one model that extraction wrote onto this call — for whichever models this space has.
 *
 * `entity` is an expression reading the row of the `$each` above it, which is what lets one query
 * serve a list nobody knew at authoring time. It used to be two hardcoded queries, `TaskBlock` and
 * `EventBlock`, so a community that defined a `Sighting` and had one extracted saw the record land
 * in the space and never appear on the call it came out of.
 *
 * A drill-down through `children` rather than an `include`, for the reason the transcript below
 * gives: `CollectionBlock.children` is an *untyped* `@HasMany`, so `include` has no target class to
 * resolve and dies on it. `scope` is the supported traversal and it takes the child type, which is
 * exactly the thing being varied here.
 */
const findingsQuery = {
  entity: { $: 'target' },
  scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: 'call.id' } },
  order: { createdAt: 'asc' },
};

/**
 * What extraction wrote onto this call, one group per model this space can extract into.
 *
 * The list of models comes from `shapeStore.extractionCandidates` — everything that *could* be
 * extracted here, rather than what this call is currently looking for. Deliberately the widest of
 * the three layers: a record found an hour ago is still on this call after its target is switched
 * off, and a card that hid it would be reporting the setting rather than the conversation.
 *
 * Each group hoists its own subscription and renders only when it has members, so a call nobody
 * extracted from looks exactly as it did before, and a space with no extractable models grows
 * nothing at all.
 *
 * How a record is drawn comes from its own declaration (`recordStore.displays`), with the entity
 * name and a neutral icon where a model has no display — an extraction target need not be one of
 * the models a person can create by hand. `title` is all this shows: the point is "this came out of
 * this conversation", not a task manager, and anything richer belongs in the card for that type.
 *
 * The fold this used to sit behind is gone with the hardcoded queries. It counted tasks and events
 * in its own label ("Show what was found · 2 tasks"), and a total across a set of models nobody
 * knows in advance is not something a schema can compute — the counts live inside the groups, one
 * query each. No loss: `cardShell` already folds the whole card, and the note on the transcript
 * below records what happened the last time this route had two disclosures in a row.
 */
const findings: SchemaNode = {
  type: '$each',
  props: { items: { $: 'shapeStore.extractionCandidates' }, as: 'target' },
  children: [
    {
      type: 'Column',
      props: { gap: '200' },
      $queries: { found: findingsQuery },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: 'count(local.found)' },
            then: {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center' },
                  children: [
                    {
                      type: 'we-icon',
                      props: { name: { $: "recordStore.displays[target].icon ?? 'cube'" }, color: 'accent-text' },
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-muted', uppercase: true },
                      children: [{ $: 'recordStore.displays[target].label ?? target' }],
                    },
                  ],
                },
                {
                  type: '$each',
                  props: { items: { $: 'local.found' }, as: 'found' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '200', ay: 'center', bg: 'surface-sunken', r: '300', px: '300', py: '200' },
                      children: [
                        // Indexed by whichever property the model calls its title, falling back to
                        // the name core blocks use — a record with neither shows an empty row rather
                        // than the word "undefined".
                        { type: 'we-text', children: [{ $: "found[recordStore.displays[target].title ?? 'title']" }] },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
  ],
};

export const callsList: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "local.contentType == 'calls'" },
    then: cardList({
      query: {
        entity: 'CollectionBlock',
        where: { kind: 'call' },
        limit: 20,
        order: { createdAt: { $: 'local.sortDirection' } },
        // No `include` for the utterances, deliberately. `CollectionBlock.children` is an
        // *untyped* `@HasMany` — it has to be, since children are heterogeneous (TextBlock,
        // ImageBlock, …) and there is no single target class to name. `include` resolves the
        // target class to hydrate it, so on an untyped relation it resolves to '' and the
        // query dies with "No SHACL shape stored for class ''". A scope drill-down is the
        // supported traversal for this, and it is what the body below uses.
      },
      as: 'call',
      // Not search-aware: the header's search box filters the other lists, but this query ignores
      // it, so an empty result here always means there are no records.
      empty: emptyState({
        icon: 'phone',
        label: 'recorded calls',
        message:
          "No calls have been recorded in this space yet. A call's record is created when somebody starts a call.",
      }),
      children: [
        /*
          A call nobody said anything in, folded away.

          The record now exists from the moment a call starts, so opening a call and closing it
          leaves one behind. Nothing deletes it — see `showEmptyCalls` in the view's own state for
          why deleting would be unsafe rather than merely unhelpful — so the list hides it and the
          header offers it back.

          The utterance subscription is hoisted here rather than onto the card, because the question
          "did anybody speak" has to be answered before the card is built. It stays one subscription:
          `$queries` and `$localState` share a namespace and an inner scope reads an outer one, so
          everything inside the card still reads `local.utterances` unchanged.
        */
        {
          $queries: callQueries,
          // `display: contents` so the gate is layout-transparent — the card stays the grid item it
          // was. The subscription has to hang off an ancestor rather than off the `$if` itself:
          // `then` is a prop, and a node's own `$queries` are not in scope for its own props.
          type: 'div',
          styles: { display: 'contents' },
          children: [
            {
              type: '$if',
              props: {
                condition: { $: 'local.showEmptyCalls || count(local.utterances)' },
                then: cardShell({
                  localState: {
                    confirmDeleteOpen: { type: 'boolean', initial: false },
                    deleting: { type: 'boolean', initial: false },
                    editOpen: { type: 'boolean', initial: false },
                    titleDraft: { type: 'string', initial: { $: 'call.title' } },
                    descriptionDraft: { type: 'string', initial: { $: 'call.description' } },
                    /*
                The findings behind a fold, closed.

                Closed by default, and that is a judgement rather than a default: what a finished call
                owes a reader at a glance is who was in it, how much was said and what came out — all
                of which the header already carries.

                Neither the findings nor the transcript has a fold of its own. `cardShell` already
                collapses the whole card, and a fold inside a collapsed card is two nested disclosures
                wrapping the same text — which reads as a mistake rather than as two choices.
              */
                  },
                  header: [
                    {
                      type: 'Row',
                      props: { ay: 'center', gap: '300' },
                      children: [
                        { type: 'we-icon', props: { name: 'phone', color: 'accent-text' } },
                        {
                          type: 'Column',
                          props: { gap: '100' },
                          children: [
                            {
                              type: 'Row',
                              props: { ay: 'center', gap: '200' },
                              children: [
                                {
                                  type: 'we-text',
                                  props: { fontWeight: 'semibold' },
                                  // The name someone gave it, falling back to the noun. Tested on the field
                                  // rather than shown blank, because an untitled call is the ordinary case:
                                  // the record is created by the first utterance, and nothing on that path
                                  // knows what the call was about.
                                  children: [{ $: "call.title ? call.title : 'Call'" }],
                                },
                                /*
                            Which of these is happening right now.

                            Without it the list is a row of cards that all look finished, and the one
                            the reader is *currently in* is indistinguishable from a meeting last
                            month — so the button beside it, which now offers something different for
                            exactly that card, appears to be behaving at random.

                            Compared against the transcript's live record rather than against a flag,
                            because "in a call" and "in *this* call" are different questions and only
                            the second one belongs on a card. A space-wide call publishes one call id
                            derived from the space, so it names the place calls happen and could never
                            tell this morning's from this afternoon's; the record can.

                            Its own words, not only a colour: `danger` is the app's word for something
                            being wrong, and a live conversation is not. A tag reads correctly for
                            somebody who cannot separate the hues, and needs no motion — a theme's
                            reduced-motion setting zeroes the animation tokens, so anything relying on
                            a pulse to be noticed is invisible to those users.
                          */
                                {
                                  type: '$if',
                                  props: {
                                    condition: { $: 'call.id == modules.transcribe.liveCollectionId' },
                                    then: {
                                      type: 'we-badge',
                                      props: { variant: 'success', size: 'xs' },
                                      children: ['Live'],
                                    },
                                  },
                                },
                              ],
                            },
                            {
                              type: 'we-text',
                              props: { fontSize: '200', color: 'text' },
                              // Relative, because what matters about a call is how long ago it was. The
                              // end is not stored — it is the last utterance's timestamp, derived rather
                              // than written so nobody has to remember to close the record and it cannot
                              // go wrong when the agent who started it is the first to leave.
                              children: [
                                { type: 'we-timestamp', props: { value: { $: 'call.createdAt' }, relative: true } },
                              ],
                            },
                          ],
                        },
                        /*
                      Who was in the call, alongside how much was said.

                      Both, because the gap between them is the point: transcription captures only the
                      speaker's own microphone, so a partial record is always reachable. Less common
                      now that joining a transcript somebody else started happens on its own — the gap
                      left is somebody who left it, or whose node has no speech model — but the reading
                      matters more rather than less for being rarer, since a record nobody expects to
                      be partial is one nobody checks. A transcript that shows it is partial is worth
                      far more than one that quietly is.
                    */
                        {
                          type: 'Row',
                          props: { ay: 'center', gap: '300', ml: 'auto' },
                          children: [
                            // Just the faces here, not the utterance count beside them: that number is
                            // about how much was said, not about who was there, so it is not part of the
                            // same statement the way a member count is.
                            peopleRow({ items: { $: 'call.participants' }, dids: true, as: 'participant' }),
                            /*
                          How much was said — counted from the utterances, not from the children.

                          `children` used to be the count and stopped being the right one the moment
                          extraction started parenting records onto the call: five utterances and
                          three extracted records read as "8 utterances". That is not a cosmetic
                          slip. This number exists to sit beside the faces and show *coverage* — the
                          gap between who was present and how much of them was captured, which is the
                          thing a partial transcript most needs to admit. Inflating it with
                          machine-written records destroys exactly that reading.

                          A scoped drill-down rather than a filter over `children`, because children
                          arrive as bare ids: the ids alone cannot tell you which are utterances.
                        */
                            {
                              // The whole label in a **prop**, not split across children. A `$query` is a
                              // subscription, so it is hoisted into a signal at component setup — which is
                              // safe for a prop and not for a child, where rendering happens inside a memo.
                              // Written as children, the count silently resolved to 0 and the card reported
                              // no utterances with the transcript sitting directly beneath it.
                              type: 'we-text',
                              props: {
                                fontSize: '200',
                                color: 'text',
                                /*
                            What was said. What was *found* used to be totalled here too — "2 tasks ·
                            1 event" — and that phrasing was right while extraction could only ever
                            produce those two kinds.

                            It cannot be built any more, and the reason is worth recording rather than
                            re-attempting: the models a space extracts into are its own, so the counts
                            are one subscription per model, and a schema cannot sum a set of queries
                            it does not know the size of. The groups below carry their own counts, one
                            query each, which is where a count and the rows it describes belong.
                          */
                                text: expr`count(${utterances}) + plural(count(${utterances}), ' utterance', ' utterances')`,
                              },
                            },
                            /*
                          That extraction is running by itself, when it is.

                          Auto-extraction is otherwise completely invisible: a pass runs on somebody's
                          node, writes records, and announces nothing — so a call with nothing found
                          yet looks identical to a space where the setting was never turned on. That
                          ambiguity cost a full day of debugging, and it would cost a user the same
                          question with no way to answer it.

                          Reads the space setting rather than the engine's own progress. The engine
                          does emit per-pass steps, and surfacing those ("last pass 2 minutes ago")
                          would be better — but they arrive on the backend port, and carrying them to a
                          template means new port surface, so it stays a follow-up. What this answers
                          is the question people actually have: is this on?
                        */
                            {
                              type: '$if',
                              props: {
                                condition: { $: 'spaceStore.autoInterpret' },
                                then: {
                                  type: 'Row',
                                  props: { gap: '100', ay: 'center' },
                                  children: [
                                    { type: 'we-icon', props: { name: 'sparkle', color: 'text-faint', size: 'xs' } },
                                    {
                                      type: 'we-text',
                                      props: { variant: 'footnote', color: 'text-faint' },
                                      children: ['Extracting automatically'],
                                    },
                                  ],
                                },
                              },
                            },
                            /*
                          Pick this call back up — or, if one is already running, go to that instead.

                          A transcript's record is reachable only while somebody who was in the call
                          is still publishing a claim to it, so once everyone has left it can never be
                          added to again. That is the right default — the next conversation in a space
                          is a different meeting, and a call that resumed itself would swallow it — but
                          it leaves no way back into one that ended because the network dropped, or
                          because everyone stepped out for five minutes.

                          Offered to everyone, unlike edit and delete: continuing a call is joining a
                          conversation, not editing somebody's record of one.

                          ## Why it stops meaning "continue" the moment you are in a call

                          It used to be the two actions below unconditionally, and mid-call each one
                          did something nobody asked for. `goToCall` is a no-op on the call you
                          are already in and a silent teardown of any other — the same hazard the
                          module rail's launcher had. `resume` is worse, because it does not fail
                          quietly: it re-points the live transcript at *this* record and announces the
                          claim, and peers adopt an announced record in preference to their own. One
                          stray click on last month's card moved everybody's live transcript into last
                          month's meeting.

                          ## Why a card that is not the live one offers nothing at all

                          The first fix was to make every card say "Go to the call" mid-call, and it
                          was wrong for a reason that only shows up on a list: this button sits beside
                          one particular conversation, so "the call" reads as *this* card's call. A
                          row of finished meetings all offering to take you to a call, none of them
                          the call in question, is a worse answer than no button.

                          So the control is offered in exactly the two states where it has an
                          unambiguous subject: no call running, where it continues this one; and this
                          card *being* the running call, where "go to the call" can only mean the one
                          it is attached to. Anything else is absent.

                          Absent rather than disabled. A disabled `we-button` sets the native
                          attribute, and a disabled control does not reliably deliver hover to the
                          tooltip that would explain it — so the explanation is the part that goes
                          missing, leaving an inert button that cannot say why. There is nothing to
                          explain here anyway: the call bar is on screen and the rail tab is lit, so
                          "you are in a call" is already said twice.
                        */
                            {
                              type: '$if',
                              props: {
                                condition: {
                                  $: 'modules.call.canCall && (!modules.call.active || call.id == modules.transcribe.liveCollectionId)',
                                },
                                // A real tooltip rather than the button's `title`, which the browser draws
                                // itself: unthemed, after its own delay, and never on a keyboard focus.
                                // Rejoining a call from a card is the one control here whose effect is not
                                // guessable from its icon, so it is the one worth saying out loud — and now
                                // it has two effects to tell apart.
                                then: {
                                  type: 'we-tooltip',
                                  props: {
                                    title: { $: "modules.call.active ? 'Go to the call' : 'Continue this call'" },
                                    placement: 'top',
                                  },
                                  children: [
                                    {
                                      type: 'we-button',
                                      props: {
                                        variant: 'ghost',
                                        size: 'sm',
                                        square: true,
                                        /*
                                    Branched in the handler rather than in the node, so one button is
                                    rendered either way — a `$if` around the whole control would
                                    rebuild it on every join and leave, and the tooltip with it.

                                    Handler arrays resolve lazily at call time, so these conditions
                                    read the store as it is when the button is pressed rather than as
                                    it was when the card painted. That is the difference between this
                                    working and it baking in whichever state the list happened to
                                    render in.
                                  */
                                        onClick: [
                                          {
                                            $if: {
                                              condition: { $: 'modules.call.active' },
                                              then: { $action: 'modules.call.goToCall' },
                                            },
                                          },
                                          {
                                            $if: {
                                              condition: { $: '!modules.call.active' },
                                              // Two actions rather than one with an `onSuccess`, because
                                              // `goToCall` returns nothing for a lifecycle key to hang
                                              // off. `resume` is built for that: it holds the record until
                                              // there is a call to attach it to, so the order these resolve
                                              // in does not matter.
                                              then: [
                                                { $action: 'modules.call.goToCall' },
                                                { $action: 'modules.transcribe.resume', args: [{ $: 'call.id' }] },
                                              ],
                                            },
                                          },
                                        ],
                                      },
                                      // Sized past what the button would give it (16px at `sm`), because
                                      // this is the affordance on the card rather than one of a set — the
                                      // edit and delete beside it act on the record, this one takes you
                                      // into the call.
                                      children: [{ type: 'we-icon', props: { name: 'phone-call', size: '20px' } }],
                                    },
                                  ],
                                },
                              },
                            },
                            /*
                          Read this call and write down what was decided in it.

                          On the card rather than only in the transcript panel, and that is what makes
                          it reach anything. The panel's button can only ever mean "the call I am in
                          and transcribing" — the live collection id is cleared the moment the call
                          ends — so a finished call, or one somebody else recorded, had no way to be
                          extracted. Here the id comes from the card, so any record in the space can be
                          picked up, by anyone, whenever.

                          Offered to everyone rather than to the author, on the same reasoning as
                          rejoining: extraction adds to a shared record of a shared event, it does not
                          edit somebody's account of one.

                          Hidden rather than disabled when the node has no LLM. Unlike a missing
                          transcription model there is nothing a user can install from here, so a
                          disabled button explaining itself would be permanent furniture on every card.
                        */
                            {
                              type: '$if',
                              props: {
                                condition: { $: 'modules.transcribe.extractable' },
                                then: {
                                  type: 'we-tooltip',
                                  props: { title: 'Find the tasks and events in this call', placement: 'top' },
                                  children: [
                                    {
                                      type: 'we-button',
                                      props: {
                                        variant: 'ghost',
                                        size: 'sm',
                                        square: true,
                                        // Keyed on *this* card's id, not on a global flag. A shared status
                                        // would spin every call in the list while one of them worked, and
                                        // would hang the finished count on whichever card the eye landed on.
                                        loading: { $: 'modules.transcribe.extractingId == call.id' },
                                        disabled: { $: "modules.transcribe.extractStatus == 'running'" },
                                        onClick: {
                                          $action: 'modules.transcribe.extractCollection',
                                          args: [{ $: 'call.id' }],
                                        },
                                      },
                                      // The icon steps aside while the spinner is up. `loading` renders the
                                      // spinner *alongside* the slot content, and on a square icon button
                                      // the two together are a cramped smudge rather than a clear state.
                                      children: [
                                        {
                                          type: '$if',
                                          props: {
                                            condition: { $: '!(modules.transcribe.extractingId == call.id)' },
                                            then: { type: 'we-icon', props: { name: 'sparkle' } },
                                          },
                                        },
                                      ],
                                    },
                                  ],
                                },
                              },
                            },
                            /*
                          Take the transcript with you.

                          A read-only copy of what was said — one line per utterance, name, timestamp
                          and text — downloaded as a plain text file. Offered to everyone rather than
                          gated on authorship: it reads the shared record and writes to the reader's own
                          device, so there is no one else's account being edited the way there is with
                          the edit and delete beside it.
                        */
                            {
                              type: 'we-tooltip',
                              props: { title: 'Export the transcript', placement: 'top' },
                              children: [
                                {
                                  type: 'we-button',
                                  props: {
                                    variant: 'ghost',
                                    size: 'sm',
                                    square: true,
                                    onClick: { $action: 'spaceStore.exportCallTranscript', args: [{ $: 'call.id' }] },
                                  },
                                  children: [{ type: 'we-icon', props: { name: 'download' } }],
                                },
                              ],
                            },
                            /*
                          What this call's pass is doing, and — only when it found nothing — that it did.

                          A spinner inside a 32px button is not, on its own, an answer to "did my click
                          land" — the run takes tens of seconds against a remote model, which is long
                          enough to press again, or to conclude it is broken. So the state is also said
                          in words beside it.

                          It used to say `${count} found` on a hit, and that has to go: the count came
                          from `extractCount`, which is *this agent's last press* — so it ignored what
                          auto-extraction wrote, it survived leaving and re-entering the route (the
                          module store outlives navigation), and it sat directly above the findings
                          groups, which count what is actually attached. Two numbers about the same
                          card, disagreeing. The groups are the truthful one, so the press now says
                          nothing on a hit and lets them answer.

                          Zero is the case that still needs words, and is why this is not deleted
                          outright: nothing renders below when nothing was found, so without a sentence
                          "it worked, there was nothing in this conversation" and "it silently failed"
                          look identical. Both remaining states are scoped to this card's id, so
                          nothing ever appears on a card that did not ask for it.
                        */
                            {
                              type: '$if',
                              props: {
                                condition: { $: 'modules.transcribe.extractingId == call.id' },
                                then: {
                                  type: 'we-text',
                                  props: { fontSize: '200', color: 'text' },
                                  children: ['Reading…'],
                                },
                              },
                            },
                            {
                              type: '$if',
                              props: {
                                condition: {
                                  $: "modules.transcribe.extractedId == call.id && modules.transcribe.extractStatus == 'done' && !modules.transcribe.extractCount",
                                },
                                then: {
                                  type: 'we-text',
                                  props: { fontSize: '200', color: 'text-muted' },
                                  children: [
                                    {
                                      $: "modules.transcribe.extractTurns ? `Nothing found in ${modules.transcribe.extractTurns} turns` : 'No transcript to read'",
                                    },
                                  ],
                                },
                              },
                            },
                            /*
                          A pass that failed says so here rather than only in the transcript panel.

                          Without this the card had two outcomes and three states: a count, or silence
                          that meant either "still running" or "it threw" — and a run against a backend
                          that cannot answer looks exactly like one that has not finished. The message
                          is the backend's own, because at this distance a rewritten one would only be
                          vaguer.
                        */
                            {
                              type: '$if',
                              props: {
                                condition: {
                                  $: "modules.transcribe.extractedId == call.id && modules.transcribe.extractStatus == 'error'",
                                },
                                then: {
                                  type: 'we-tooltip',
                                  props: { title: { $: 'modules.transcribe.extractError' }, placement: 'top' },
                                  children: [
                                    {
                                      type: 'we-text',
                                      props: { fontSize: '200', color: 'danger-text' },
                                      children: ['Extraction failed'],
                                    },
                                  ],
                                },
                              },
                            },
                            /*
                          Naming the record, and deleting it — both for whoever made it.

                          Gated on authorship the same way a post is. It is a weaker claim here than
                          there — a call is a shared event and the record belongs to it as much as to
                          the agent whose transcription created it — but a shared space is a
                          neighbourhood every member can write to, so this is an affordance rather
                          than enforcement either way. Offering it to the author only is the narrower
                          of the two honest options.
                        */
                            {
                              type: '$if',
                              props: {
                                condition: { $: 'call.author == me.did' },
                                then: {
                                  type: 'Row',
                                  props: { gap: '100' },
                                  children: [
                                    {
                                      type: 'we-button',
                                      props: {
                                        variant: 'ghost',
                                        size: 'sm',
                                        square: true,
                                        /*
                                      Re-seed the drafts from the record on the way in, so a modal
                                      that was opened, edited and cancelled does not reopen holding
                                      the abandoned edit. The `initial` values only run at mount.

                                      `from` rather than `value`, and the difference is the whole
                                      thing: `value` sets a **literal**, so `value: '$call.title'`
                                      puts that string itself into the input, verbatim. Only `from`
                                      is resolved — against the event, or against context when the
                                      path does not start with `$event`. Same trap as the `$concat`
                                      wrapper on the avatar hash above.
                                    */
                                        onClick: [
                                          { $setLocal: 'titleDraft', value: { $: 'call.title' } },
                                          { $setLocal: 'descriptionDraft', value: { $: 'call.description' } },
                                          { $setLocal: 'editOpen', value: true },
                                        ],
                                      },
                                      children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
                                    },
                                    {
                                      type: 'we-button',
                                      props: {
                                        variant: 'ghost',
                                        size: 'sm',
                                        square: true,
                                        onClick: { $setLocal: 'confirmDeleteOpen', value: true },
                                      },
                                      children: [{ type: 'we-icon', props: { name: 'trash' } }],
                                    },
                                  ],
                                },
                              },
                            },
                            /*
                        Editing writes the two fields straight onto the CollectionBlock with
                        `record.update` — no store action, because there is nothing for one to do.
                        `title` and `description` are plain scalars on the model, so this is the
                        whole of saving them.

                        No validation and no precondition: an empty title is a meaningful value here,
                        since it returns the card to the plain "Call" it started as. A required rule
                        would make clearing a name impossible.
                      */
                            formModal({
                              open: { $: 'local.editOpen' },
                              close: { $setLocal: 'editOpen', value: false },
                              title: 'Edit call',
                              size: 'sm',
                              /*
                          The drafts stay on the card shell rather than moving onto the modal, unlike
                          the composers elsewhere: the pencil above seeds them from `$call` *before*
                          opening, so they have to be declared by an ancestor of the button, not of
                          the modal. Seeding is also what stands in for the reset a remount gives the
                          blank forms — the fields are overwritten every time the modal opens.
                        */
                              children: [
                                field({ name: 'titleDraft', label: 'Title', placeholder: 'What was this call about?' }),
                                field({
                                  name: 'descriptionDraft',
                                  label: 'Description',
                                  control: 'textarea',
                                  placeholder: 'Anything worth remembering about it',
                                }),
                              ],
                              /*
                          Dirty means *changed*, not *non-empty* — the fields arrive seeded from the
                          record, so a form nobody has touched is already full. This is the shape any
                          edit form wants, as against the blank ones elsewhere that can ask whether
                          anything is filled in at all.
                        */
                              discardWhen: {
                                $: 'local.titleDraft != call.title || local.descriptionDraft != call.description',
                              },
                              submit: {
                                $action: 'record.update',
                                args: [
                                  'CollectionBlock',
                                  { $: 'call.id' },
                                  { title: { $: 'local.titleDraft' }, description: { $: 'local.descriptionDraft' } },
                                ],
                              },
                            }),
                            confirmModal({
                              open: { $: 'local.confirmDeleteOpen' },
                              close: { $setLocal: 'confirmDeleteOpen', value: false },
                              title: 'Delete call?',
                              body: 'This will permanently delete the recording and every utterance in it. This cannot be undone.',
                              confirmLabel: 'Delete',
                              // The delete walks the collection and removes every utterance under it, so a
                              // long transcript takes a visible moment. Without the spinner the button
                              // absorbs the click and appears to have failed, inviting a second click at a
                              // delete already running.
                              busyLocal: 'deleting',
                              // A call record is a CollectionBlock like a post, and the recursive delete
                              // does not care which kind it is holding.
                              confirm: { $action: 'spaceStore.deleteCollection', args: [{ $: 'call.id' }] },
                            }),
                          ],
                        },
                      ],
                    },
                  ],
                  body: [
                    {
                      type: 'Column',
                      props: { gap: '400' },
                      children: [
                        // Above the transcript, and only when there is one — the description is context
                        // for what follows, which is no use underneath it.
                        {
                          type: '$if',
                          props: {
                            condition: { $: 'call.description' },
                            then: {
                              type: 'we-text',
                              props: { color: 'text' },
                              children: [{ $: 'call.description' }],
                            },
                          },
                        },
                        /*
                      What was found in the conversation, above what was said in it.

                      Above, because it is the part someone opening a finished call actually wants —
                      the transcript is the evidence, and evidence belongs under the finding. It is
                      also the only place the result of pressing Extract is visible as *records*
                      rather than as a count.

                      Grouped by type rather than filtered by one, because two or three items make a
                      filter more chrome than content. When a real meeting yields fifteen, this is the
                      shape a filter grows out of.
                    */
                        /*
                      The findings themselves.

                      Inline rather than behind a disclosure of their own, which is a change forced by
                      the same thing that made the list dynamic: a trigger has to say what is inside it
                      to be worth pressing, and "Show what was found" with no counts is a button that
                      could open onto nothing. The counts cannot be totalled across a set of models
                      nobody knows in advance, so they live inside the groups — and each group renders
                      only when it has rows, which leaves a call nobody extracted from looking exactly
                      as it did before. `cardShell` still folds the whole card.
                    */
                        findings,
                        /*
                      The transcript, in full.

                      No fold of its own. A recorded meeting is long, so this was behind a
                      `CollapsedContent` — but `cardShell` already folds the whole card with the same
                      primitive, and with both in play an expanded card opened onto a second identical
                      disclosure wrapping the only thing left in it. One gesture, applied at the level
                      that covers the header and the findings too, is what the route already teaches.
                    */
                        {
                          type: 'Column',
                          props: { gap: '300' },
                          children: [
                            {
                              type: '$each',
                              // Drilled down from the call rather than hydrated with `include` — see the note
                              // on the outer query. `children` still arrives as an array of ids, but the ids
                              // alone cannot render the text.
                              // Oldest first, because a transcript read backwards is not a transcript.
                              props: {
                                items: {
                                  $query: {
                                    entity: 'TextBlock',
                                    scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: 'call.id' } },
                                    order: { createdAt: 'asc' },
                                  },
                                },
                                as: 'utterance',
                              },
                              children: [
                                /*
                            Attribution is free here and needs no diarization: each agent transcribes only
                            their own microphone, so the block's author *is* the speaker.

                            `$agent` turns that DID into a profile and demand-fetches it, which is what
                            puts a real picture and a name on the line rather than a generated blob. The
                            same idiom `PostsList` uses for a post's author — and it reaches anyone, not
                            only the current space's members.
                          */
                                agentByline({
                                  did: { $: 'utterance.author' },
                                  as: 'speaker',
                                  stacked: true,
                                  nameColor: 'text-muted',
                                  // When each utterance was written — which is when it was *said*, since a
                                  // block is flushed as the speaker finishes.
                                  timestamp: { $: 'utterance.createdAt' },
                                  children: [
                                    { type: 'we-text', props: { color: 'text' }, children: [{ $: 'utterance.text' }] },
                                  ],
                                }),
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                }),
              },
            },
          ],
        },
      ],
    }),
  },
};
