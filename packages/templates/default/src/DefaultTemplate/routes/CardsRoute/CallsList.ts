import type { SchemaNode } from '@we/schema-shared';

import { emptyState } from '../../EmptyState.ts';
import { peopleTooltip } from '../../PeopleTooltip.ts';
import { cardList, cardShell } from './CardShell.ts';

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
                    peopleTooltip({
                      items: '$call.participants',
                      image: {
                        $find: {
                          items: { $store: 'profileStore.profiles' },
                          where: { did: '$person' },
                          select: 'avatar',
                        },
                      },
                      hash: { $concat: ['$person'] },
                      name: {
                        $find: {
                          items: { $store: 'profileStore.profiles' },
                          where: { did: '$person' },
                          select: 'name',
                        },
                      },
                      children: [
                        {
                          type: 'AvatarStack',
                          props: {
                            /*
                                `participants` is a list of DIDs, so each one is joined to the
                                profile that carries a picture.

                                The lookup is inside the `select` rather than a filter over the
                                cache, because the ordering has to follow the *call's* roster — and
                                because `$filter` has no set-membership operator to express
                                "profiles whose did is in this list" with.

                                `hash` is set unconditionally, never as a fallback for a missing
                                `image`: it seeds a generated avatar that is stable per agent, so
                                somebody whose profile has not arrived is still visually distinct
                                from everybody else whose profile has not arrived. A real picture
                                wins where there is one.
                              */
                            avatars: {
                              $map: {
                                items: '$call.participants',
                                select: {
                                  image: {
                                    $find: {
                                      items: { $store: 'profileStore.profiles' },
                                      where: { did: '$item' },
                                      select: 'avatar',
                                    },
                                  },
                                  // Wrapped rather than written as a bare '$item': a plain string
                                  // in a `select` is treated as a literal, and only a token object
                                  // is resolved against the item context.
                                  hash: { $concat: ['$item'] },
                                },
                              },
                            },
                            max: 5,
                            size: 'sm',
                          },
                        },
                      ],
                    }),
                    {
                      type: 'we-text',
                      props: { fontSize: '200', color: 'neutral-700' },
                      children: [
                        { type: 'we-number', props: { value: { $count: { items: '$call.children' } } } },
                        {
                          $plural: {
                            count: { $count: { items: '$call.children' } },
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
                            {
                              type: 'we-form-field',
                              props: { label: 'Title' },
                              children: [
                                {
                                  type: 'we-input',
                                  props: {
                                    value: { $local: 'titleDraft' },
                                    placeholder: 'What was this call about?',
                                    onInput: { $setLocal: 'titleDraft', from: '$event.detail' },
                                  },
                                },
                              ],
                            },
                            {
                              type: 'we-form-field',
                              props: { label: 'Description' },
                              children: [
                                {
                                  type: 'we-textarea',
                                  props: {
                                    value: { $local: 'descriptionDraft' },
                                    rows: 3,
                                    placeholder: 'Anything worth remembering about it',
                                    onInput: { $setLocal: 'descriptionDraft', from: '$event.detail' },
                                  },
                                },
                              ],
                            },
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
                    {
                      type: '$if',
                      props: {
                        condition: { $local: 'confirmDeleteOpen' },
                        then: {
                          type: 'we-modal',
                          props: { close: { $setLocal: 'confirmDeleteOpen', value: false } },
                          children: [
                            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Delete call?'] },
                            {
                              type: 'we-text',
                              children: [
                                'This will permanently delete the recording and every utterance in it. This cannot be undone.',
                              ],
                            },
                            {
                              type: 'Row',
                              props: { ax: 'end', gap: '200' },
                              children: [
                                {
                                  type: 'we-button',
                                  props: {
                                    variant: 'ghost',
                                    onClick: { $setLocal: 'confirmDeleteOpen', value: false },
                                  },
                                  children: ['Cancel'],
                                },
                                {
                                  type: 'we-button',
                                  props: {
                                    variant: 'danger',
                                    /*
                                        The delete is not instant — it walks the collection and
                                        removes every utterance under it, so a long transcript
                                        takes a visible moment. Without a spinner the button
                                        absorbs the click and nothing happens, which reads as a
                                        failure and invites a second click at a delete that is
                                        already running.

                                        `deleting` is cleared in `onFinally` rather than
                                        `onError`: on the success path the card unmounts with the
                                        record, so the only state worth restoring is the one where
                                        it did not, and a failure that left the button spinning
                                        forever would be the worse end of that trade.
                                      */
                                    loading: { $local: 'deleting' },
                                    disabled: { $local: 'deleting' },
                                    // The generic collection delete: a call record is a
                                    // CollectionBlock like a post, and the recursive delete does
                                    // not care which kind it is holding.
                                    onClick: [
                                      { $setLocal: 'deleting', value: true },
                                      {
                                        $action: 'spaceStore.deleteCollection',
                                        args: ['$call.id'],
                                        onSuccess: [{ $setLocal: 'confirmDeleteOpen', value: false }],
                                        onFinally: [{ $setLocal: 'deleting', value: false }],
                                      },
                                    ],
                                  },
                                  children: ['Delete'],
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
                {
                  type: '$each',
                  // Drilled down from the call rather than hydrated with `include` — see the note
                  // on the outer query. `children` still arrives as an array of ids (which is what
                  // the utterance count above reads), but the ids alone cannot render the text.
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
                    {
                      type: '$agent',
                      props: { did: '$utterance.author', as: 'speaker' },
                      children: [
                        {
                          type: 'Row',
                          props: { gap: '300', ay: 'start' },
                          children: [
                            {
                              type: 'we-avatar',
                              props: { size: 'sm', image: '$speaker.avatar', hash: '$speaker.did' },
                            },
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
                                      props: { fontWeight: 'semibold', color: 'neutral-600' },
                                      children: ['$speaker.name'],
                                    },
                                    {
                                      // When each utterance was written — which is when it was
                                      // *said*, since a block is flushed as the speaker finishes.
                                      type: 'we-timestamp',
                                      props: { value: '$utterance.createdAt', relative: true, color: 'neutral-500' },
                                    },
                                  ],
                                },
                                {
                                  type: 'we-text',
                                  props: { color: 'neutral-900' },
                                  children: ['$utterance.text'],
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
          ],
        }),
      ],
    }),
  },
};
