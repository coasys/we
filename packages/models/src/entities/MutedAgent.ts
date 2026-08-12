import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

/**
 * An agent this agent does not want to see. Personal, private, and unilateral.
 *
 * **Safety, not social graph** — which is why it lands now rather than waiting for follows or
 * cross-space feeds. It needs neither: muting is a filter applied to whatever a feed already
 * returns, so it works the day the first feed does. Its natural moment is *before* the feed
 * fragments ship, because a feed either carries the filter from the start or none of them do, and
 * retrofitting it across shipped fragments is exactly the drift the kit exists to prevent.
 *
 * **Held in the root dataset, never in a space** — the `SpacePreference` rule. Written into a
 * shared perspective it would tell the whole community, including the muted agent, who has muted
 * whom. That is worse than not having the feature: it converts a quiet act of self-protection into
 * a public one, and gives the person being avoided a notification about it.
 *
 * ### What it is not
 *
 * Not moderation, and not enforcement. An AD4M neighbourhood is writable by every member, so this
 * hides content on *this* agent's screen and does nothing to the record or to anyone else's view.
 * Community-level removal needs the governance layer and the validation rules underneath it;
 * conflating the two would promise a protection this cannot deliver.
 *
 * Global rather than per-space, deliberately. Muting is a judgement about a person, and the common
 * case — someone who is unpleasant in one community and turns up in another — is exactly the case a
 * per-space list would fail. Per-space scoping can be added as an optional field later without
 * moving any data; starting per-space and generalising later could not.
 *
 * One record per muted agent, so a mute and an unmute are an independent create and delete. A JSON
 * array on `AgentSettings` would be a read-modify-write, and two tabs muting two different people
 * would lose one of them.
 */
@Model({ name: 'MutedAgent' })
export class MutedAgent extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://muted_agent' })
  flag: string = '';

  /** DID of the muted agent. */
  @Property({ through: 'we://did' })
  did: string = '';

  /**
   * Optional note to self — why.
   *
   * Present because an unexplained mute list is one nobody prunes: six months on, the reason is
   * gone and the only safe action is to leave it, so the list only ever grows.
   */
  @Property({ through: 'we://description' })
  description: string = '';
}
