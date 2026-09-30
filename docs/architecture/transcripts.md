# Transcripts

What a call's transcript **is**, as data — written down because four things now read this shape and
nothing enforces any of it.

## The shape

```
CollectionBlock                    ← one call's transcript
  kind: 'call'                     ← what sort of collection this is
  type: 'collection'
  mode: 'feed'                     ← many agents append here; never reconcile
  children:  [TextBlock, …]        ← the utterances, in order
                each carries: text, author (who said it), createdAt
  participants: [did, …]           ← who was present, including people who never spoke
  ↑ parented to the call's anchor node through `we://call` (WeNode.calls)
```

Created by `@we/module-call`, which owns `CALL_KIND` and `CALL_PREDICATE` in its `protocol.ts`;
the utterances inside it are written by `@we/module-transcribe`.

## The three behaviours that are not in the shape

- **The record is created when the call starts**, and it _is_ the call's identity: the call id is
  `call:<recordId>`, published on the call's presence activity. That is what lets a space hold
  several calls at once, and what gives a live call somewhere to keep its extraction targets before
  anybody has spoken.
- **Nothing deletes an empty one.** A call somebody opened and closed leaves a record behind, and
  that is deliberate: telling "nobody spoke" from "I cannot see what they said" needs a view of the
  whole call, which under a partition no agent has. The Cards route folds them away instead
  (`showEmptyCalls`), which is a display decision and reversible.
- **Utterances are batched at roughly 1000 characters**, not one block per sentence. One block per
  utterance would be truer to the source and writes a record per breath.

There used to be a fourth, and its absence is the point: the record was created by whoever spoke
first, so two agents speaking at once made two transcripts of one meeting. That race was fought with
an election among the recorders and a timeout for an elected creator who might never speak, and it
still had a documented partition failure. Creating the record before the call is announced removes
the thing there was to disagree about.

## Attribution needs no diarization

Each agent transcribes **only their own microphone**, so a block's `author` _is_ the speaker. That
is why the shape carries no speaker field: the one it would hold is already on every record.

The limit that follows: attribution is per _agent_, so two people sharing one laptop's microphone
land under one name. Real diarization is a different problem and this shape does not pretend to
solve it.

`participants` exists because attribution alone cannot say who was _there_. A transcript showing
that somebody was present and silent is a different and more honest artefact than one that simply
omits them.

## `mode: 'feed'` is load-bearing

A machine-written collection with no `mode` reads as legacy, which makes `reconcileBlocks` willing
to delete children it did not author — **other agents' utterances**. Any new transcript-shaped
collection must set it.

## Who reads this shape

Five consumers, and none of them can import the constants from the module that writes them:
`templates → modules` and `modules → modules` are both sideways edges (see
`package-conventions.md`), so each spells `'call'` itself.

| Reader                            | What it does                                          |
| --------------------------------- | ----------------------------------------------------- |
| `@we/module-transcribe`'s panel   | the live transcript, drilled down from the collection |
| `CardsView/CallsList`             | a finished meeting, with its findings                 |
| `CardsView/Header`                | starts a call, which creates the collection           |
| `views/RecordPage`                | one call's own page, at `/record/CollectionBlock/:id` |
| `@we/module-graph`'s fragments    | styles a call node on a graph                         |
| `spaceStore.exportCallTranscript` | writes a `.txt` with real speaker names               |

That duplication is deliberate rather than tolerated. The alternative — a shared kind registry — is
the wrong shape: a free-text `kind` on a generic container is a symptom, and the answer is a
declared content type (a manifest plus fragments), not a lookup table of magic strings. Until then,
this page is the contract, and a change to the shape means changing every row above.

## Reading it

Drill down from the collection; do not use `include`. `CollectionBlock.children` is an **untyped**
to-many, so `include` will crash at runtime — the ids arrive and cannot render themselves.

```ts
{
  $query: {
    entity: 'TextBlock',
    scope: { anchor: 'CollectionBlock', via: 'children', anchorId: <collection id> },
    order: { createdAt: 'asc' },   // a transcript read backwards is not a transcript
  }
}
```

There is deliberately no windowing. A single call's transcript is bounded by the length of the call,
and "the last N, oldest first" is not currently expressible — `order: desc` with a `limit` returns
the newest N _newest-first_, and there is no reverse. When the expression layer's function library
lands, that is where the answer goes; adding a value operator for it is ruled out by the
architecture plan.
