import type { SchemaNode } from '@we/schema-shared';
import { agentByline, cardList, cardShell, confirmModal, emptyState, field, peopleRow } from '@we/template-kit';

/**
 * Recorded calls in this space.
 *
 * A call's record is a `CollectionBlock` with `kind: 'call'` — its utterances are the children, its
 * roster is `participants`, and it hangs off whatever node the call was about via `WeNode.calls`.
 * So this is an ordinary entity list like every other section here; no new machinery.
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
 * One group of records extraction wrote onto this call.
 *
 * A drill-down through `children` for the same reason the transcript below uses one:
 * `CollectionBlock.children` is an *untyped* `@HasMany`, so `include` has no target class to
 * resolve and dies on it. `scope` is the supported traversal, and it takes the child type — which
 * is exactly what makes this one helper serve both tasks and events.
 *
 * Rendered only when the group has members, so a call nobody extracted from looks the way it always
 * did rather than growing two empty headings.
 *
 * `title` is the one field every extracted class has and the one the model is told to lead with, so
 * it is all this shows. Anything richer belongs in the card for that type, not in a summary hanging
 * off a call — the point here is "this came out of this conversation", not a task manager.
 */
function extracted(entity: string, label: string, icon: string, as: string): SchemaNode {
  const query = {
    $query: {
      entity,
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: '$call.id' },
      order: { createdAt: 'asc' },
    },
  };
  return {
    type: '$if',
    props: {
      condition: { $count: { items: query } },
      then: {
        type: 'Column',
        props: { gap: '200' },
        children: [
          {
            type: 'Row',
            props: { gap: '200', ay: 'center' },
            children: [
              { type: 'we-icon', props: { name: icon, color: 'primary-700' } },
              {
                type: 'we-text',
                props: { variant: 'footnote', color: 'neutral-500', uppercase: true },
                children: [label],
              },
            ],
          },
          {
            type: '$each',
            props: { items: query, as },
            children: [
              {
                type: 'Row',
                props: { gap: '200', ay: 'center', bg: 'neutral-50', r: '300', px: '300', py: '200' },
                children: [{ type: 'we-text', children: [`$${as}.title`] }],
              },
            ],
          },
        ],
      },
    },
  };
}

export const callsList: SchemaNode = {
  type: '$if',
  props: {
    condition: { $eq: [{ $local: 'contentType' }, 'calls'] },
    then: cardList({
      query: {
        entity: 'CollectionBlock',
        where: { kind: 'call' },
        limit: 20,
        order: { createdAt: { $local: 'sortDirection' } },
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
          "No calls have been recorded in this space yet. A call's record is created the first time somebody speaks with transcription on.",
      }),
      children: [
        cardShell({
          localState: {
            confirmDeleteOpen: { type: 'boolean', initial: false },
            deleting: { type: 'boolean', initial: false },
            editOpen: { type: 'boolean', initial: false },
            titleDraft: { type: 'string', initial: '$call.title' },
            descriptionDraft: { type: 'string', initial: '$call.description' },
          },
          header: [
            {
              type: 'Row',
              props: { ay: 'center', gap: '300' },
              children: [
                { type: 'we-icon', props: { name: 'phone', color: 'primary-700' } },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontWeight: 'semibold' },
                      // The name someone gave it, falling back to the noun. Tested on the field
                      // rather than shown blank, because an untitled call is the ordinary case:
                      // the record is created by the first utterance, and nothing on that path
                      // knows what the call was about.
                      children: [{ $if: { condition: '$call.title', then: '$call.title', else: 'Call' } }],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '200', color: 'neutral-700' },
                      // Relative, because what matters about a call is how long ago it was. The
                      // end is not stored — it is the last utterance's timestamp, derived rather
                      // than written so nobody has to remember to close the record and it cannot
                      // go wrong when the agent who started it is the first to leave.
                      children: [{ type: 'we-timestamp', props: { value: '$call.createdAt', relative: true } }],
                    },
                  ],
                },
                /*
                    Who was in the call, alongside how much was said.

                    Both, because the gap between them is the point: transcription is opt-in and
                    captures only the speaker's own microphone, so a partial record is the *normal*
                    outcome. A transcript that shows it is partial is worth far more than one that
                    quietly is.
                  */
                {
                  type: 'Row',
                  props: { ay: 'center', gap: '300', ml: 'auto' },
                  children: [
                    // Just the faces here, not the utterance count beside them: that number is
                    // about how much was said, not about who was there, so it is not part of the
                    // same statement the way a member count is.
                    peopleRow({ items: '$call.participants', dids: true, as: 'participant' }),
                    /*
                        How much was said — counted from the utterances, not from the children.

                        `children` used to be the count and stopped being the right one the moment
                        extraction started parenting records onto the call: five utterances and
                        three extracted records read as "8 utterances". That is not a cosmetic
                        slip. This number exists to sit beside the faces and show *coverage* — the
                        gap between who was present and how much of them was captured, which is the
                        normal outcome of opt-in transcription and the thing a partial transcript
                        most needs to admit. Inflating it with machine-written records destroys
                        exactly that reading.

                        A scoped drill-down rather than a filter over `children`, because children
                        arrive as bare ids: the ids alone cannot tell you which are utterances.
                      */
                    {
                      type: 'we-text',
                      props: { fontSize: '200', color: 'neutral-700' },
                      children: [
                        {
                          type: 'we-number',
                          props: {
                            value: {
                              $count: {
                                items: {
                                  $query: {
                                    entity: 'TextBlock',
                                    scope: { anchor: 'CollectionBlock', via: 'children', anchorId: '$call.id' },
                                  },
                                },
                              },
                            },
                          },
                        },
                        {
                          $plural: {
                            count: {
                              $count: {
                                items: {
                                  $query: {
                                    entity: 'TextBlock',
                                    scope: { anchor: 'CollectionBlock', via: 'children', anchorId: '$call.id' },
                                  },
                                },
                              },
                            },
                            one: ' utterance',
                            other: ' utterances',
                          },
                        },
                      ],
                    },
                    /*
                        Pick this call back up.

                        A transcript's record is reachable only while somebody who was in the call
                        is still publishing a claim to it, so once everyone has left it can never be
                        added to again. That is the right default — the next conversation in a space
                        is a different meeting, and a call that resumed itself would swallow it — but
                        it leaves no way back into one that ended because the network dropped, or
                        because everyone stepped out for five minutes.

                        Offered to everyone, unlike edit and delete: continuing a call is joining a
                        conversation, not editing somebody's record of one.
                      */
                    {
                      type: '$if',
                      props: {
                        condition: { $store: 'modules.call.canCall' },
                        // A real tooltip rather than the button's `title`, which the browser draws
                        // itself: unthemed, after its own delay, and never on a keyboard focus.
                        // Rejoining a call from a card is the one control here whose effect is not
                        // guessable from its icon, so it is the one worth saying out loud.
                        then: {
                          type: 'we-tooltip',
                          props: { title: 'Continue this call', placement: 'top' },
                          children: [
                            {
                              type: 'we-button',
                              props: {
                                variant: 'ghost',
                                size: 'sm',
                                square: true,
                                // Two actions rather than one with an `onSuccess`, because
                                // `joinSpaceCall` returns nothing for a lifecycle key to hang off.
                                // `resume` is built for that: it holds the record until there is a
                                // call to attach it to, so the order these resolve in does not
                                // matter.
                                onClick: [
                                  { $action: 'modules.call.joinSpaceCall' },
                                  { $action: 'modules.transcribe.resume', args: ['$call.id'] },
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
                        condition: { $store: 'modules.transcribe.extractable' },
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
                                loading: {
                                  $eq: [{ $store: 'modules.transcribe.extractingId' }, '$call.id'],
                                },
                                disabled: {
                                  $eq: [{ $store: 'modules.transcribe.extractStatus' }, 'running'],
                                },
                                onClick: {
                                  $action: 'modules.transcribe.extractCollection',
                                  args: ['$call.id'],
                                },
                              },
                              // The icon steps aside while the spinner is up. `loading` renders the
                              // spinner *alongside* the slot content, and on a square icon button
                              // the two together are a cramped smudge rather than a clear state.
                              children: [
                                {
                                  type: '$if',
                                  props: {
                                    condition: {
                                      $not: { $eq: [{ $store: 'modules.transcribe.extractingId' }, '$call.id'] },
                                    },
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
                        What this call's pass is doing, or found.

                        A spinner inside a 32px button is not, on its own, an answer to "did my click
                        land" — the run takes tens of seconds against a remote model, which is long
                        enough to press again, or to conclude it is broken. So the state is also said
                        in words beside it.

                        Zero is a real and common answer — a conversation with nothing decided in it
                        — and saying so is the difference between "it worked, there was nothing" and
                        "it silently failed". All three states are scoped to this card's id, so
                        nothing ever appears on a card that did not ask for it.
                      */
                    {
                      type: '$if',
                      props: {
                        condition: { $eq: [{ $store: 'modules.transcribe.extractingId' }, '$call.id'] },
                        then: {
                          type: 'we-text',
                          props: { fontSize: '200', color: 'neutral-700' },
                          children: ['Reading…'],
                        },
                      },
                    },
                    {
                      type: '$if',
                      props: {
                        condition: {
                          $and: [
                            { $eq: [{ $store: 'modules.transcribe.extractedId' }, '$call.id'] },
                            { $eq: [{ $store: 'modules.transcribe.extractStatus' }, 'done'] },
                          ],
                        },
                        then: {
                          type: 'we-text',
                          props: { fontSize: '200', color: 'neutral-700' },
                          children: [
                            {
                              // Whole sentences per branch rather than a count glued to a suffix.
                              // Sharing the tail gave "no found" for the empty case, which is the
                              // sort of thing that reads as a placeholder somebody forgot.
                              //
                              // Three outcomes, not two. "Nothing found" is a fact about the
                              // conversation; "no transcript" means nothing reached the model at
                              // all, and every way that happens — a wrong containment predicate, an
                              // unreadable timestamp, the wrong collection — looks identical to a
                              // quiet meeting unless the turn count is said out loud.
                              $if: {
                                condition: { $store: 'modules.transcribe.extractTurns' },
                                then: {
                                  $if: {
                                    condition: { $store: 'modules.transcribe.extractCount' },
                                    then: {
                                      $concat: [{ $store: 'modules.transcribe.extractCount' }, ' found'],
                                    },
                                    else: {
                                      $concat: [
                                        'Nothing found in ',
                                        { $store: 'modules.transcribe.extractTurns' },
                                        ' turns',
                                      ],
                                    },
                                  },
                                },
                                else: 'No transcript to read',
                              },
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
                          $and: [
                            { $eq: [{ $store: 'modules.transcribe.extractedId' }, '$call.id'] },
                            { $eq: [{ $store: 'modules.transcribe.extractStatus' }, 'error'] },
                          ],
                        },
                        then: {
                          type: 'we-tooltip',
                          props: { title: { $store: 'modules.transcribe.extractError' }, placement: 'top' },
                          children: [
                            {
                              type: 'we-text',
                              props: { fontSize: '200', color: 'danger-600' },
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
                        condition: { $eq: ['$call.author', '$me.did'] },
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
                                  { $setLocal: 'titleDraft', from: '$call.title' },
                                  { $setLocal: 'descriptionDraft', from: '$call.description' },
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
                        `model.update` — no store action, because there is nothing for one to do.
                        `title` and `description` are plain scalars on the model, so this is the
                        whole of saving them.

                        No validation: an empty title is a meaningful value here, since it returns
                        the card to the plain "Call" it started as. A required rule would make
                        clearing a name impossible.
                      */
                    {
                      type: '$if',
                      props: {
                        condition: { $local: 'editOpen' },
                        then: {
                          type: 'we-modal',
                          props: { close: { $setLocal: 'editOpen', value: false } },
                          children: [
                            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Edit call'] },
                            field({ name: 'titleDraft', label: 'Title', placeholder: 'What was this call about?' }),
                            field({
                              name: 'descriptionDraft',
                              label: 'Description',
                              control: 'textarea',
                              placeholder: 'Anything worth remembering about it',
                            }),
                            {
                              type: 'Row',
                              props: { ax: 'end', gap: '200' },
                              children: [
                                {
                                  type: 'we-button',
                                  props: { variant: 'ghost', onClick: { $setLocal: 'editOpen', value: false } },
                                  children: ['Cancel'],
                                },
                                {
                                  type: 'we-button',
                                  props: {
                                    onClick: {
                                      $action: 'model.update',
                                      args: [
                                        'CollectionBlock',
                                        '$call.id',
                                        {
                                          title: { $local: 'titleDraft' },
                                          description: { $local: 'descriptionDraft' },
                                        },
                                      ],
                                      onSuccess: [{ $setLocal: 'editOpen', value: false }],
                                    },
                                  },
                                  children: ['Save'],
                                },
                              ],
                            },
                          ],
                        },
                      },
                    },
                    confirmModal({
                      openLocal: 'confirmDeleteOpen',
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
                      confirm: { $action: 'spaceStore.deleteCollection', args: ['$call.id'] },
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
                    condition: '$call.description',
                    then: {
                      type: 'we-text',
                      props: { color: 'neutral-700' },
                      children: ['$call.description'],
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
                extracted('TaskBlock', 'Tasks', 'check-square', 'task'),
                extracted('EventBlock', 'Events', 'calendar', 'event'),
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
                        scope: { anchor: 'CollectionBlock', via: 'children', anchorId: '$call.id' },
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
                      did: '$utterance.author',
                      as: 'speaker',
                      stacked: true,
                      nameColor: 'neutral-600',
                      // When each utterance was written — which is when it was *said*, since a
                      // block is flushed as the speaker finishes.
                      timestamp: '$utterance.createdAt',
                      children: [{ type: 'we-text', props: { color: 'neutral-900' }, children: ['$utterance.text'] }],
                    }),
                  ],
                },
              ],
            },
          ],
        }),
      ],
    }),
  },
};
