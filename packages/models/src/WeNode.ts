import { Ad4mModel, HasMany, HasManyMethods, Model } from '@coasys/ad4m';

import { Signal } from './entities/Signal';

@Model({ name: 'WeNode' })
export class WeNode extends Ad4mModel {
  @HasMany({ through: 'we://comment' })
  comments: string[] = [];

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
   */
  @HasMany({ through: 'we://participants' })
  participants: string[] = [];

  /**
   * Calls that happened on this node, as `CollectionBlock`s with `kind: 'call'`.
   *
   * The edge lives here rather than on the call because traversal is forward-only — the IR's `scope`
   * drills down *from* an anchor through a relation the anchor owns, and `reverseOf` is deliberately
   * not emitted (see `neutralManifest.ts`). Put it on the call and "what calls happened on this post"
   * becomes a full scan.
   *
   * Untyped, mirroring `comments` rather than `signals`: core mints the predicate and stays agnostic
   * about the other end. The cost is that `include: { calls: true }` will not work (include needs a
   * known target class) — a drill-down via `scope` does, which is what listing a node's calls needs.
   * Typing it would mean importing `CollectionBlock` here, and since `CollectionBlock extends WeNode`
   * that is an evaluation-order cycle waiting to happen.
   */
  @HasMany({ through: 'we://call' })
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
