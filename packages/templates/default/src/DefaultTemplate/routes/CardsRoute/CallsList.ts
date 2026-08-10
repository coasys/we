import type { SchemaNode } from '@we/schema-shared';

import { cardShell, gridWrapper } from './CardShell.ts';

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
    then: gridWrapper([
      {
        type: '$each',
        props: {
          items: {
            $query: {
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
          },
          as: 'call',
        },
        children: [
          cardShell({
            header: [
              {
                type: 'Row',
                props: { ay: 'center', gap: '300', p: '300' },
                children: [
                  { type: 'we-icon', props: { name: 'phone', color: 'primary-700' } },
                  {
                    type: 'Column',
                    props: { gap: '100' },
                    children: [
                      {
                        type: 'we-text',
                        props: { fontWeight: 'semibold' },
                        children: ['Call'],
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
                      {
                        type: 'AvatarStack',
                        props: {
                          /*
                            `participants` is a list of DIDs, so each one is joined to the member
                            profile that carries a picture.

                            The lookup is inside the `select` rather than a filter over members,
                            because the ordering has to follow the *call's* roster — and because
                            `$filter` has no set-membership operator to express "members whose did is
                            in this list" with.

                            `hash` is set unconditionally, never as a fallback for a missing `image`:
                            it seeds a generated avatar that is stable per agent, so somebody whose
                            profile has not arrived is still visually distinct from everybody else
                            whose profile has not arrived. A real picture wins where there is one.
                          */
                          avatars: {
                            $map: {
                              items: '$call.participants',
                              select: {
                                image: {
                                  $find: {
                                    items: { $store: 'spaceStore.members' },
                                    where: { did: '$item' },
                                    select: 'avatar',
                                  },
                                },
                                // Wrapped rather than written as a bare '$item': a plain string in a
                                // `select` is treated as a literal, and only a token object is
                                // resolved against the item context.
                                hash: { $concat: ['$item'] },
                              },
                            },
                          },
                          max: 5,
                          size: 'sm',
                        },
                      },
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
                    ],
                  },
                ],
              },
            ],
            body: [
              {
                type: 'Column',
                props: { gap: '400', px: '400', pb: '400' },
                children: [
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
                                        children: [{ $concat: ['$speaker.firstName', ' ', '$speaker.lastName'] }],
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
      },
    ]),
  },
};
