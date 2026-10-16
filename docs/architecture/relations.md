# Relations — where a connection between two things should live

WE can express a connection between two records in three different places, and they are not
interchangeable. This is the decision procedure, and the reasoning behind it.

## The axis that actually decides it

**Is the connection a statement about the _type_, or a statement about the _pair_?**

`Task.assignee` is a claim about the class: every task may have one, decided before any task existed,
by whoever owns the vocabulary. "This task came out of that call" is a claim about two specific
records, made afterwards, by a person who noticed something.

Those want different homes regardless of how many of each there are. Scale, combinatorics and query
cost all matter, but they are consequences of this distinction rather than the thing itself — and
the same distinction decides where a _position_ lives, which is why `Placement` exists rather than
`x`/`y` on a block.

## Three links every record can have: structure, what it answers, and its thread

Before the tiers below, the connections every record makes are fixed, and there are three of them.

| Link                                                                    | Question                       | Rule                                                                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `we://child` — `CollectionBlock.children`, read back as `WeNode.partOf` | **What is it a part of?**      | Structure, and nothing else. At most one container. `mode` on the collection governs it: who owns its parts, and whether re-saving may rewrite them. |
| `we://response` — `WeNode.responses`, read back as `respondsTo`         | **What does it answer?**       | Optional, open to anyone whatever `mode` says, on every node: a reply, a comment, a call held about it, a channel spun off from it.                  |
| `we://thread` — `WeNode.thread`, read back as `inThread`                | **Which discussion is it in?** | An index, written by the host: from a thread's subject to every response under it, at any depth.                                                     |

`we://child` is the name containment goes by in the manifest and in what `schemas.entries` reports;
a `parent` option names it by relation, `{ id, relation: 'children' }`. A backend with a
containment predicate of its own stores it under that one and translates at its boundary
(`containment.ts` in the AD4M backend), so the name is the same everywhere above it.

**A response is never a child of anything.** A reply to a line in a call answers the line and is in
the line's thread; a comment on a post answers the post and is in the post's thread. Neither is one
of the call's or the channel's children.

**Where a response was said is derived, not stored**: its thread's subject, and the container that
subject is part of — `inThread`, then `partOf`. A comment on a post was said in the post's channel
because the post is in that channel, and moves with the post if the post moves. Storing it as well
would be the same fact twice, and the copy goes stale on the first move.

| Responding to                            | Its thread           | Where it was said (derived)                 |
| ---------------------------------------- | -------------------- | ------------------------------------------- |
| a line in a call                         | the line             | the call                                    |
| a block inside a post                    | the block            | the post                                    |
| a post                                   | the post             | the post's channel, or the space collection |
| a task, or a message typed outside calls | that task or message | the space collection                        |
| a call itself                            | the call             | wherever the call is                        |

**A thread belongs to its subject**: the first record above a response that is not itself a
response. A reply to a block is in the block's thread and a reply to the post in the post's, so the
two discussions stay apart. The thread link makes the whole discussion under a post, its total and
what a delete takes with it one read rather than a walk. The child axis has no such link on purpose:
parts move between collections, and a stored root would have to be rewritten for a whole subtree on
every move. Responses never change what they answer.

**So everything said in a room is its children plus their threads.** A transcript reads a call's
lines with `include: { thread: true }`; unread credits a reply to the container its subject is part
of. One read, at any depth, without a walk.

### Why three, and why the same three at every scale

A small community runs as one feed — a chat. A large one runs as channels of posts with discussions
under them — a forum. The links are the same in both: what changes is how the space is arranged
(how many containers, how deep) and how the interface draws it. A chat draws each line's thread
inline beneath it; a forum draws a post's thread on the post's page. A community that grows from one
into the other changes its arrangement and its template, never its data.

A fourth link — a room's index of everything said in it, `we://room` — would make "everything in
this room" one hop rather than two. It is not built: the two-hop read is bounded and cheap, and an
index that has to be rewritten when a post moves is exactly the stale copy the rule above avoids.
Add it if a room-wide read measurably needs it.

One relation holds every kind of response, so **surfaces filter by what a response is**: a thread
list or a reply count says `kind: 'reply'` (what the discussion composer writes), and a listing of
calls says `kind: 'call'`. The host writes the thread link — `completeResponse` in
`app-shell/src/shared/responses.ts` runs for every write made with the response predicate — so no
template or module writes it itself.

A space is its own dataset, so "a space made in response to a post" cannot be a link in either. That
one is a stored reference, like `sourceRef`.

## The three tiers

|                        | Authored by               | Cost to add                         | Query by it                     | Carries its own data | Visible as a kind |
| ---------------------- | ------------------------- | ----------------------------------- | ------------------------------- | -------------------- | ----------------- |
| **Free-text label**    | any member, in the moment | nothing                             | no                              | yes                  | no                |
| **`RelationshipType`** | the community             | one record                          | `where: { relationshipTypeId }` | yes                  | yes               |
| **Declared relation**  | whoever owns the schema   | a Shape edit, or a release for core | fully                           | **no**               | n/a               |

### Free text — where a vocabulary is discovered

A `Relationship` with a `label` and no kind. Costs nothing, needs no permission, and is right while
nobody yet knows what kinds of connection this community makes — which is the state every new space
is in.

What it cannot do is be queried or drawn. "contradicts", "Contradicts" and "contradicts?" are three
different relations to a `where` clause, so a template cannot filter on one, count them, or give a
kind its own colour.

### `RelationshipType` — the community's own vocabulary

The middle tier, and the one that carries most of the weight in practice. Deliberately the same
shape as `SignalType`: a community names its own vocabulary, as data, in its own space, and
instances reference it by id.

It buys three things a label cannot:

- **Query pushdown.** `where: { relationshipTypeId }` is a native equality that composes with
  `order` and `limit`.
- **Consistency.** One record, one spelling, one meaning — and a count you can trust when deciding
  whether to promote.
- **Visibility.** An edge style can key on the kind, so a community's vocabulary is _seen_ rather
  than read. A map whose kinds are legible at a glance is a different instrument from one where
  every line has to be read to be understood.

`directed` and `inverseName` live here for the same reason: "contradicts" is asymmetric and "related
to" is not, and drawing an arrowhead on the second asserts something nobody meant.

### A declared relation — committed vocabulary

`@HasOne` / `@HasMany` on the model class. Gets the full query surface: `include` hydration,
ordering by a related property (`order: { 'location.country': 'asc' }`), count projections, target
typing.

And it can carry **nothing about the connection itself**. A declared relation has no identity, so
there is no author, no date, nothing to comment on and nothing to rate. `task.assignee = did` cannot
express "James says Sarah owns this and Alice disagrees".

## Decision rules

1. **Can the connection be disputed, rated, commented on, dated or attributed?** → reify. Not a
   threshold but a requirement: a declared relation has nothing to hang any of that on.
2. **Will you filter, sort, `include` or count _by_ it?** → declare. This is the rule that overrides
   the elegance argument, and the one most easily lost: a reified relationship has no query
   pushdown at all, and resolving the far end is manual.
3. **Is the relation kind fixed when the schema is written, or invented by members as they go?** →
   declare / reify respectively. This is where combinatorics bites: you cannot declare
   `contradicts` × `supersedes` × `inspired-by` across every pair of twenty-five types, because
   those were never facts about types.
4. **Written by code, per record, as part of creating that record?** → declare. **Written by a
   person, deliberately, occasionally?** → reify. A declared relation is one link; a `Relationship`
   is an expression plus six or seven. Irrelevant at hand-drawn volume, ruinous at
   every-message-links-to-its-author volume.
5. **Both directions matter equally and neither end owns the other?** → reify. WE's declared
   relations are one-directional — the manifest emits no `reverseOf` and the query IR only walks
   forward — so a symmetric relation declared on one side is a lie about which side is which.

## Promotion, and its cost

**Reification is the staging area for schema.** Free text is where relations are discovered, a named
kind is where a community agrees on one, and a declared relation is where it commits.

The trigger for promoting is: **when you want to query _by_ the relation rather than filter a list
of them.** That subsumes frequency — nobody wants to query by something used twice, and a kind used
four hundred times is one somebody will.

WE is unusually well set up for this because the shape wizard means promoting a community model's
relation does not need a release. What is _not_ free is the data: a declared relation is a different
set of links, so existing `Relationship` records have to be converted and then removed. A script,
per space. Cheap enough to be worth doing when the query surface is what you need, and expensive
enough not to do speculatively.

## What the graph engine does with all this

Nothing different, which is the point. The `entity` expander walks declared relations; the `reified`
map collapses relationship entities into edges. A reader cannot tell which is which unless a
template styles them apart — and WE's default template does, deliberately: drawn connections are
heavier and coloured, because the distinction that matters on a knowledge map is "a schema says so"
against "a person says so", and the second is the one worth arguing with.

So the choice of tier is a modelling decision, not a UX one. Getting it wrong costs query power or
provenance; it does not cost a rewrite of anything that draws.

## When a conversation draws the connection

A call can extract `Relationship` like any other candidate, so a pass can say "the migration depends
on the auth rewrite" as a record. Nothing in the extraction engine knows connections are reified. It
fills whatever relations a class declares, so a `Relationship` is a record with two to-one ends, and
the reified shape costs nothing at write time. What the pass needs is said in the declaration:

- **Which end is the parent.** The workshop reads a connection as a tree from source to target, so
  the hints on `source` and `target` say the source is the broader end, and the label is phrased from
  it ("includes", not "is part of"). The declaration cannot express direction, and a model guessing
  it inverts half a tree.
- **That the structure exists.** A model is shown only the instances whose identity property is set.
  That property is `connection`, the dedup key, so WE writes it on every connection a person draws
  (`connectionKey`), and rewrites it when an end moves, the connection is relabelled, or a record it
  joins is renamed. Both ends are named by title, so the existing connections read as the tree they
  are, and a hand-drawn key and an extracted key for the same claim are the same string. A
  connection drawn by hand with no key was invisible to the pass meant to extend it.
- **Which records it can reach.** A pass sees the existing records of the models it is looking for,
  and no others, so a connection can join only those models. Relationship on its own connects nothing.

What a pass cannot do yet is shared by every relation, not special to this one:

- It cannot see a space's `RelationshipType`s, so an extracted connection has no kind. It shows in a
  tree only while the tree follows every kind.
- It cannot re-point an end. Relation writes are add-only, so "that belongs under X" produces a
  second connection, and a person removes the old one.
- It sees the tree as a flat list of keys, not as a tree.

Those are executor capabilities: classes a pass can reference without creating, relation replacement
staged as a suggestion, and context described as a query. They are not workarounds to build here.

## Worked examples

| Connection                           | Tier                              | Why                                                                                       |
| ------------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `CollectionBlock.children`           | declared (untyped)                | Structural, written by the composer per block, queried constantly.                        |
| `Space.location`                     | declared                          | A fact about the class, one per space, nothing to dispute.                                |
| `WeNode.responses`                   | declared (untyped)                | Written by code on every response; the _response_ carries the provenance, not the link.   |
| "This contradicts that"              | reified + kind                    | A claim, arguable, authored, and the vocabulary is the community's.                       |
| "This card sits here on this canvas" | reified (`Placement`)             | A fact about the pair — the same note sits elsewhere on another canvas.                   |
| A reaction                           | reified (`Signal` + `SignalType`) | Per agent, per node, with a vocabulary the community names. Already this shape.           |
| "Sarah is reviewing this"            | reified (`Involvement` + kind)    | A claim about a person and a record, attributed and dated; the kinds are the community's. |
| Who was in a call                    | declared (`WeNode.participants`)  | Written by code per record at transcriber volume; nobody claims it, a machine saw it.     |

The reaction row is worth noticing: signals arrived at the same three-tier answer independently,
before any of this was written down. That is the strongest evidence the shape is right.

The last two rows are the same people and the same record in two tiers, and that is deliberate
rather than duplication. "Was in the room" and "said they would come" are different facts, one
observed and one stated, and rule 4 puts them in different places. A surface that read one as the
other would tell somebody a meeting they skipped was one they attended.
