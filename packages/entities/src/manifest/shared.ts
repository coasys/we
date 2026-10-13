import { CONTAINMENT_PREDICATE, type EntitySchema } from '@we/backend-shared';

/**
 * The relations every `WeNode` carries — the generic affordances (what was made in response to it,
 * the thread under it, signals, who is taking part, agents mentioned). Declared once and merged into
 * every WeNode-based entity's assembled manifest entry by `index.ts`, exactly as the class
 * hierarchy gives them to every subclass. The prose for each lives on `WeNode.ts`, which remains the
 * hand-written behavioural base these definitions generate subclasses of.
 *
 * ## Three links between records, and what each means
 *
 * - **What is it a part of?** `we://child`, on `CollectionBlock.children` — structure, and nothing
 *   else. At most one container, and `mode` on the collection governs it: who owns the parts, and
 *   whether re-saving may rewrite them.
 * - **What does it answer?** `we://response`, here — what it was made in response to: a reply to a
 *   line, a comment on a post, a call about a task, a channel spun off from a post. Optional, open
 *   to anyone whatever `mode` says, and on every node, since a task or a block has no inside to be
 *   part of but can always be answered.
 * - **Which discussion is it in?** `we://thread`, here — one link from a thread's subject to every
 *   response under it, at any depth, so "the whole discussion under this post" is one read rather
 *   than a walk. Written by the host, never by a writer.
 *
 * A response is never a child of anything. Where it was said is derived — its thread's subject, and
 * the container that subject is part of — so a comment on a post moves with the post, and everything
 * said in a room is that room's children plus their threads. The same three links serve a single
 * feed and a forum of channels; only the arrangement and the interface differ. See
 * `docs/architecture/relations.md`.
 *
 * ## Untyped splits two ways here, and only one of them is polymorphic
 *
 * `signals` is the one typed edge: `include: { signals: true }` must hydrate `Signal` instances. The
 * rest deliberately name no target. `responses` and `thread` hold records — heterogeneous ones,
 * which is the case reading each member as its own class exists for. `participants` and `mentions`
 * hold **agent DIDs**: `setAttending` writes `me.did` and `writeMentions` writes the DIDs its marks
 * name. A DID is not an instance of anything, so classifying one finds no class and hydrating it
 * yields nothing — the read degrades rather than failing, but it is work spent to learn that. They
 * opt out explicitly, which is the whole reason the opt-out exists.
 *
 * `participants` is **membership a machine observed** — who was in a call — and must not be used for
 * intent a person stated. An assignment or an RSVP is an `Involvement`, which carries the author,
 * the date and the community's word for the kind that a bag of DIDs cannot. See `WeNode.participants`.
 * The showcase Events template predates that and still RSVPs through `setAttending`; moving it onto
 * `respondTo` is outstanding, not a second way to do the same thing.
 *
 * Worth noticing as a modelling gap rather than a wart: `target: ''` is currently doing two jobs —
 * "any record" and "not a record at all" — and only the second wants opting out. If a third such
 * relation appears, that is the point to give the manifest a way to say which.
 */
export const WE_NODE_RELATIONS: EntitySchema['relations'] = {
  /**
   * What was made in response to this node — a reply, a comment, a call held about it, a channel
   * spun off from it. Only the direct ones: a reply to a reply is the first reply's.
   *
   * One relation for every kind of response rather than one per kind (it was `comments`, with
   * calls on a link of their own), because what a response *is* is already on the response — its
   * entity, and a collection's `kind` — and a surface that wants only some of them filters by that.
   * A relation per kind made every new kind of response a new predicate and a new walker.
   */
  responses: { target: '', cardinality: 'many', predicate: 'we://response' },
  /**
   * What this node is a response to — `responses` read backwards.
   *
   * The first relation here that a node does not own: the link lives on the subject, and this reads
   * it from the other end. It earns its place because a thread cannot be drawn without it. Reading
   * every response under a post answers with a flat list — `thread` does that in one read — so the
   * shape has to come from each response naming its own parent, and one batched query answers that
   * for a whole page of them.
   *
   * Untyped for the same reason `responses` is, and the inverse of a heterogeneous relation is
   * heterogeneous in both directions: a response's subject is a post, a task, a line or another
   * response.
   *
   * To-one because a response is made to one thing. Nothing stops a peer writing a second
   * `we://response` link at the same target — a neighbourhood is writable by every member — and the
   * read then picks one. That is the ordinary last-write-wins shape of every scalar here, not a
   * case this relation is special in.
   */
  respondsTo: { target: '', cardinality: 'one', predicate: 'we://response', reverseOf: 'responses' },
  /**
   * Every response under this node, at any depth — on a thread's **subject**, which is the first
   * thing above a response that is not itself a response.
   *
   * The response axis, flattened. Each response is linked from its subject when it is written, so
   * "everything said under this post", its total and everything a delete has to take with it are
   * one forward read — where following `responses` down is a walk of unknown depth. The tree is
   * still drawn from `respondsTo`; this answers *which* thread, never *where* in it.
   *
   * Safe to store because a response is written once and never changes what it responds to. The
   * child axis gets no such link on purpose: parts move between collections all the time, and a
   * stored root would have to be rewritten for a whole subtree on every move.
   *
   * A reply to a block in a post is in the *block's* thread, not the post's, and a reply to a line
   * in a call is in the line's: the subject is exactly what was answered, so a block's discussion
   * and a post's stay apart.
   */
  thread: { target: '', cardinality: 'many', predicate: 'we://thread' },
  /** The subject of the thread this response is in — `thread` read backwards. Empty on anything that is not a response. */
  inThread: { target: '', cardinality: 'one', predicate: 'we://thread', reverseOf: 'thread' },
  /**
   * The collection this node is part of — `CollectionBlock.children` read backwards, exactly as
   * `extractedFrom` reads `extracted`. Empty on a response, which is a child of nothing.
   *
   * Where a response was said is worked out from it: the `partOf` of its thread's subject. One link
   * a node does not own, read in one batched query for a page of them.
   */
  partOf: { target: '', cardinality: 'one', predicate: CONTAINMENT_PREDICATE, reverseOf: 'children' },
  /**
   * Where this record was extracted from — the call (or the space collection, for loose messages)
   * whose `extracted` links to it. `CollectionBlock.extracted` read backwards, exactly as
   * `respondsTo` reads `responses`.
   *
   * Provenance, not containment: an extracted item lives in the space collection and records where
   * it came from separately, so moving it or deleting the call changes neither link. What it gives
   * a template is the source without a second query — the Inbox grouping unplaced items by call, a
   * card saying it came from Monday's call, the "this call" lens. Empty on anything made by hand.
   *
   * Untyped like `respondsTo`, and for the generated class's sake: the source is always a collection,
   * but a typed reverse on the base every collection extends would be a class importing its own
   * subclass.
   */
  extractedFrom: { target: '', cardinality: 'one', predicate: 'we://extracted', reverseOf: 'extracted' },
  signals: { target: 'Signal', cardinality: 'many', predicate: 'we://signal' },
  participants: { target: '', cardinality: 'many', predicate: 'we://participant', polymorphic: false },
  mentions: { target: '', cardinality: 'many', predicate: 'we://mention', polymorphic: false },
};

/**
 * WeNode's own manifest entry: abstract — nothing instantiates a bare node — and carrying the
 * shared relations, so a backend reading the manifest alone still learns what every node offers.
 */
export const WE_NODE_ENTITY: EntitySchema = {
  properties: {},
  relations: { ...WE_NODE_RELATIONS },
  abstract: true,
};
