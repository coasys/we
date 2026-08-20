/**
 * GENERATED from src/manifest/entities/Relationship.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/models generate:classes` after changing it.
 */
import { Flag, HasOne, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

/**
 * A connection somebody drew between two things, in their own words.
 *
 * Every edge WE could previously draw came from a schema: a relation declared on a model, followed
 * forwards or backwards. That is the right way to render structure somebody already committed to,
 * and it cannot express the thing a knowledge map is actually for — noticing that *this* contradicts
 * *that*, that a task came out of a call, that two people's notes are about the same idea. Those are
 * claims made after the fact, by a person, about a pair of records nobody anticipated relating.
 *
 * ## Why an entity rather than a link
 *
 * The connection has to be able to carry things. A `WeNode` gets comments, signals, mentions and an
 * author for free, and all four are the point:
 *
 * - **Comments**, because a claim that two things are related is exactly the kind of claim people
 *   argue about, and the argument belongs on the claim rather than on either end of it.
 * - **Signals**, because "how strongly?" is a community judgement rather than a number the person
 *   who drew the line gets to set. A `SignalType` already carries mode, range and aggregate, and is
 *   per-agent, so a weight becomes something a space computes rather than something one member
 *   asserts. That is why there is no `weight` property here: a scalar would be one agent's opinion
 *   wearing the clothes of a fact.
 * - **Author and provenance**, because who said two things are connected is most of what the
 *   statement is worth.
 *
 * ## Why the endpoints are untyped, and carry their type beside them
 *
 * A relation declared in a schema names its target class. This one cannot: the whole point is to
 * connect a `TaskBlock` to a community's own `Sighting` to a `CollectionBlock`, and any pair a
 * member finds worth connecting. `CollectionBlock.children` is already untyped for the same reason,
 * so the shape is not new.
 *
 * What is new is `sourceType`/`targetType`. A graph node's address is minted from its dataset, its
 * type and its id, so drawing this as an edge needs both ends' types — and an untyped relation
 * cannot supply them. Storing the names beside the ids means an edge can be drawn from the
 * relationship record alone, with no round trip to ask each end what it is. The cost is two strings
 * that could drift from reality if a record were ever retyped, which is not a thing that happens:
 * an id belongs to one record and a record does not change class.
 */
@Model({
  name: 'Relationship',
  interpretationHint:
    'A relationship a person asserted between two specific records — "contradicts", "caused by", "same as". Only extract one when the speakers connect two things that both already exist as records.',
})
export class Relationship extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://relationship' })
  flag: string = '';

  /**
   * What the connection *is*, in the author's words — "contradicts", "came out of".
   *
   * Free text rather than a vocabulary, because the vocabulary is the thing being discovered. A
   * community that finds itself writing "contradicts" repeatedly has learnt something about how
   * it thinks, and the answer to that is a model it defines, not a dropdown WE guessed at.
   */
  @Property({ through: 'we://title', required: true })
  label: string = '';

  /** Why — the room a one-word label does not leave. */
  @Property({ through: 'we://description' })
  description: string = '';

  /** Entity name of the source record, so the edge can be drawn without resolving it first. */
  @Property({ through: 'we://source_type' })
  sourceType: string = '';

  /** Entity name of the target record. */
  @Property({ through: 'we://target_type' })
  targetType: string = '';

  @HasOne({ through: 'we://relationship_source' })
  source?: string;

  @HasOne({ through: 'we://relationship_target' })
  target?: string;
}
