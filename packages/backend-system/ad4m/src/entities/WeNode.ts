import { Ad4mModel, BelongsToOne, HasMany, HasManyMethods, Model } from '@coasys/ad4m';

import { Signal } from './Signal';

@Model({ name: 'WeNode' })
export class WeNode extends Ad4mModel {
  /*
    `polymorphic` on the relations that hold records, and deliberately absent from the two that hold
    DIDs — see WE_NODE_RELATIONS in @we/entities for why the split is not arbitrary. This class is
    hand-written rather than generated, so it is the one place the manifest's answer is repeated by
    hand; `coreManifest.test.ts` holds the two in step, since SHACL does not carry the answer.
  */
  @HasMany({ through: 'we://response', polymorphic: true })
  responses: string[] = [];

  /**
   * What this node is a response to — `responses` read from the other end.
   *
   * There is one link; this side does not add a second. `@BelongsToOne` binds the same predicate
   * and matches `?source we://response ?target` with the targets constrained to the rows in hand,
   * so a page of replies learns all its parents in one batched query rather than one each.
   *
   * It exists because a thread cannot be drawn without it. A transitive read answers with every
   * descendant of a post as a flat set — SPARQL property paths bind no intermediate variables, so
   * the traversal reports its endpoints and nothing about the route — and the tree has to be
   * rebuilt from each reply naming its own parent.
   *
   * Read-only, and generated that way: writing here would write a link `responses` owns.
   */
  @BelongsToOne({ through: 'we://response', polymorphic: true })
  respondsTo?: string;

  /**
   * Every response under this node at any depth, linked from the thread's subject when each is
   * written — so the whole discussion, its total and what a delete takes with it are one forward
   * read. See the manifest's `thread` for which node is the subject.
   */
  @HasMany({ through: 'we://thread', polymorphic: true })
  thread: string[] = [];

  /** The subject of the thread this response is in — `thread` read backwards. Read-only. */
  @BelongsToOne({ through: 'we://thread', polymorphic: true })
  inThread?: string;

  /**
   * The collection this node lives in — `CollectionBlock.children` read backwards, as
   * `extractedFrom` reads `extracted`. Read-only: the link belongs to the collection.
   */
  @BelongsToOne({ through: 'we://child', polymorphic: true })
  partOf?: string;

  /**
   * Where this record was extracted from — `CollectionBlock.extracted` read backwards. Provenance,
   * not containment: see the manifest's `extractedFrom`. Read-only, as `respondsTo` is.
   */
  @BelongsToOne({ through: 'we://extracted', polymorphic: true })
  extractedFrom?: string;

  @HasMany(() => Signal, { through: 'we://signal' })
  signals: string[] = [];

  /**
   * Agents taking part in whatever this node represents — a call's roster, a document's co-editors,
   * an event's attendees.
   *
   * On `WeNode` rather than on any one model because "who is in this" is a generic affordance, like
   * `responses`. It is also what keeps rosters *per occurrence*: a `CollectionBlock` is a `WeNode`, so
   * two calls anchored to the same post are two collections with two independent rosters, rather than
   * one list on the post that both would have to share.
   *
   * DIDs rather than a relation to an agent model: there is no agent entity in the perspective to
   * point at, and profiles are already resolved separately (see `spaceStore.members` feeding
   * `AvatarStack`). Add-only in practice — each agent appends itself — which is what makes it
   * conflict-free without coordination.
   *
   * **One writer per member, and that is a contract rather than an observation.** This is a bag of
   * links: nothing here can refuse one that is already present, because refusing would mean reading
   * the current set first and a read-modify-write drops whoever loses the race. So it is a set only
   * for as long as each agent writes its own entry and nobody else's. A writer that appends every
   * member it can see turns it into a multiset that grows with every session — which is what the
   * transcribe module used to do, and why an avatar row drew the same two faces over and over.
   *
   * **Membership a machine observed, not intent a person stated.** Who was in a call belongs here.
   * Who is assigned to a task, or said they are coming to an event, is an `Involvement` — a claim
   * with an author, a date and a community-named kind, which a DID in a bag cannot carry. The two
   * are different facts about the same people: reading this roster as "said they would come" would
   * tell somebody a meeting they skipped was one they attended.
   */
  @HasMany({ through: 'we://participant' })
  participants: string[] = [];

  /**
   * Agents named inside this node — the @-mentions in its composed content.
   *
   * DIDs, exactly as {@link WeNode.participants} holds them, and for the same reason: there is no
   * agent entity in the perspective to point a typed relation at.
   *
   * The point of writing it as an edge at all is that "posts mentioning me" must be a **query**.
   * The alternative — scanning `textContent` for a handle — is wrong twice over: handles are
   * mutable and not unique, so it matches the wrong people and misses renamed ones, and a
   * substring filter cannot be pushed down, so it degrades with every post in the space.
   *
   * Distinct from `participants` even though the shape is identical: participation is something an
   * agent does to itself (each writes its own entry, which is what keeps the set conflict-free),
   * whereas a mention is something an author asserts about someone else. Merging them would let
   * any author add anyone to any roster.
   *
   * Derived, not authored: the serializer rewrites the whole set from the composed tree on every
   * save, so it is the one relation here where a read-modify-write is correct — the author owns
   * the text, therefore owns every mention in it, so there is no second writer to race.
   */
  @HasMany({ through: 'we://mention' })
  mentions: string[] = [];
}

export interface WeNode extends HasManyMethods<
  'responses' | 'thread' | 'signals' | 'reactions' | 'participants' | 'mentions'
> {}
