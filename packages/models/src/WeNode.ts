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
}

export interface WeNode extends HasManyMethods<'comments' | 'signals' | 'reactions' | 'participants' | 'calls'> {}
