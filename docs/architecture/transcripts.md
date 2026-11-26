# Transcripts

What a call's transcript **is**, as data — written down because four things now read this shape and
nothing enforces any of it.

## The shape

```
CollectionBlock                    ← one call's transcript
  kind: 'call'                     ← what sort of collection this is
  mode: 'feed'                     ← many agents append here; never reconcile
  children:  [TextBlock | CollectionBlock, …]   ← the lines, in order
                a heard line is a TextBlock: text, author (who said it), createdAt
                a typed line is a message composition: a CollectionBlock with kind 'message'
                  or 'reply', source 'typed', its words in `textContent`, its own TextBlock
                  under it and, if files were sent, a CollectionBlock of kind 'attachments'
                  holding a FileBlock for each; the people its marks mention are its own
                  `mentions` (we://mention), on the message and not on its TextBlock
                each line has `thread`: every reply typed to it, at any depth
  participants: [did, …]           ← who was present, including people who never spoke
  ↑ a response to the node the call was about, through `we://response` (WeNode.responses), and in
    that node's thread — or, for a call about nothing, a child of the space collection
```

A reply to a line is a child of nothing: it answers the line and is in the line's `thread`. So the
whole transcript is the call's children plus their threads, read as one page with
`include: { thread: true }` — the transcript panel, the Feed, the interpretation gather and the watch's
SPARQL all read it that way. See `docs/architecture/relations.md`.

Created by `@we/module-call`, which owns `CALL_KIND` and `RESPONSE_PREDICATE` in its `protocol.ts`;
the utterances inside it are written by `@we/module-transcribe`.

## The three behaviours that are not in the shape

- **The record is created when the call starts**, and it _is_ the call's identity: the call id is
  `call:<recordId>`, published on the call's presence activity. That is what lets a space hold
  several calls at once, and what gives a live call somewhere to keep its interpretation targets before
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

Drill down from the collection, and include each line's thread — the replies are there, not among
the children. Ask for both shapes of a line in one query, so they share one order and one window:

```ts
{
  $query: {
    entity: ['TextBlock', 'CollectionBlock'],  // a heard line, and a typed message
    scope: { anchor: 'CollectionBlock', via: 'children', anchorId: <collection id> },
    order: { createdAt: 'desc' },  // the newest page, turned back the right way up when drawn
    limit: <window>,
    include: { thread: true },     // every reply to each line, at any depth
  }
}
```

The same `where` goes to each entity of a union, so the query cannot keep only the message
compositions. Keep them in the expression: `rows.filter(r, r.__subjectClass != 'CollectionBlock' ||
r.kind in ['message', 'reply'])` (the views use `callLines` in `views/src/views/callLines.ts`). The
words of a line are `text` on a `TextBlock` and `textContent` on a composition. Count the filtered
rows, not the raw window, but use the raw window to tell whether there are more.

Then `threadLines({ rows, newestFirst })` flattens the threads in, sorts by when each line was said,
and gives each reply the quote of what it answers. The transcript panel reads exactly this, windowed
by `modules.transcribe.transcriptShown`; see `Panel.schema.ts`.

A message's files are two containment levels below it (message → group → file), so the panel reads
them in the same query: `include: { thread: { include: partsInclude() }, ...partsInclude() }`, where
`partsInclude()` (in `@we/messages`) is each line's `children` and, below them, each file's `name`,
`mimeType` and `size` — only for the lines in the window, in one read, and never a file's `url`,
which for a stored file is the whole file. `threadLines` turns those into each message's
`attachments`, which `messageLine` draws. The Feed reads its own window's parts and files itself
(`readParts` and `readAttachments` in `feed.ts`, which keep files read between windows); its rows
hold the parts as ids, and `threadLines` leaves their `attachments` alone.

## Writing a typed message

`writeMessage` in `@we/module-feed`'s `store.ts` writes every part first, where no reader of the
conversation looks: the files and their group, the message (unparented), its `TextBlock`, the group
into the message. Then **one link** publishes it: into the call's or the space's `children`, or —
for a reply — the answered line's `responses` (the host completes the thread from that link). Only
then come the `mentions` links from the message to each person its marks name: a mention wakes an
agent, a wake cannot be taken back, and the agent reads the message's place in its conversation.
The records kernel has no write group, so this is what stands in for one: until the holder link
nothing reads the message, and a failure at any step removes every record written, newest first. Every write names the dataset
it was sent from, captured before the first await.

**Mentions are on the message.** A woken agent is woken on the record that carries the
`we://mention` link and is told of the files up to two containment levels below it, which is the
message's group of files — from its `TextBlock` they would be a sibling's. The host's
`lineMentions.ts` keeps this so: it links nothing from a `TextBlock` written into a message, and
when an edit changes such a `TextBlock`'s words, it moves the links on the message (found through
`partOf`). Its readers — `myMentions` (`referrers` by relation, then `containerActivity`'s
`mentionsOf`) — read the relation on any record, so they find messages as they find posts.

**An edit** (`editUtterance` → `mendLine` in `@we/messages`) writes the words in both places they
are held, the `TextBlock` and the message's `textContent`, to the dataset captured when the edit
began. The two writes are not one transaction: if the second fails, the `TextBlock` is written back
as it was — text, `source` and marks, so the host moves the mentions back with them — and the
failure is reported.

**A bot's notice** (`botWatch.ts`) watches the space's newest `TextBlock`s. The words of a message
are a `TextBlock` whose `partOf` is the message, so a line whose parent is a message composition is
weighed as the message — its id, and the collection the message is in — which is what the Feed draws
and what "is the reader already looking at it" is asked about.
