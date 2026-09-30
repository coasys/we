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
  @HasMany({ through: 'we://comment', polymorphic: true })
  comments: string[] = [];

  /**
   * What this node is a comment on — `comments` read from the other end.
   *
   * There is one link; this side does not add a second. `@BelongsToOne` binds the same predicate
   * and matches `?source we://comment ?target` with the targets constrained to the rows in hand,
   * so a page of replies learns all its parents in one batched query rather than one each.
   *
   * It exists because a thread cannot be drawn without it. A transitive read answers with every
   * descendant of a post as a flat set — SPARQL property paths bind no intermediate variables, so
   * the traversal reports its endpoints and nothing about the route — and the tree has to be
   * rebuilt from each reply naming its own parent.
   *
   * Read-only, and generated that way: writing here would write a link `comments` owns.
   */
  @BelongsToOne({ through: 'we://comment', polymorphic: true })
  inReplyTo?: string;

  @HasMany(() => Signal, { through: 'we://signal' })
  signals: string[] = [];

  /**
   * Agents taking part in whatever this node represents — a call's roster, a document's co-editors,
   * an event's attendees.
   *
   * On `WeNode` rather than on any one model because "who is in this" is a generic affordance, like
   * `comments`. It is also what keeps rosters *per occurrence*: a `CollectionBlock` is a `WeNode`, so
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
  @HasMany({ through: 'we://participants' })
  participants: string[] = [];

  /**
   * Calls that happened on this node, as `CollectionBlock`s with `kind: 'call'`.
   *
   * The edge lives here rather than on the call because a forward drill-down is the cheap read: the
   * IR's `scope` walks *from* an anchor through a relation the anchor owns. Put it on the call and
   * "what calls happened on this post" becomes a full scan.
   *
   * Reading an edge backwards is possible — see `inReplyTo`, which does exactly that — but it is a
   * different tool and not a cheaper one: it answers "who points at these rows I already have",
   * which is the question a tree needs and a listing does not.
   *
   * Untyped, mirroring `comments` rather than `signals`: core mints the predicate and stays agnostic
   * about the other end. Typing it would mean importing `CollectionBlock` here, and since
   * `CollectionBlock extends WeNode` that is an evaluation-order cycle waiting to happen.
   *
   * `include: { calls: true }` used to be unavailable for exactly that reason — include had no
   * target class to hydrate into, so listing a node's calls meant a `scope` drill-down. Reading each
   * member as the class it actually is removes the requirement, so both routes now work and the
   * drill-down is a choice rather than the only option.
   */
  @HasMany({ through: 'we://call', polymorphic: true })
  calls: string[] = [];

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
  'comments' | 'signals' | 'reactions' | 'participants' | 'calls' | 'mentions'
> {}
