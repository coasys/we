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
   * What makes two mentions the same connection — the pair and the label, joined.
   *
   * The dedup key, and composite for the same reason {@link EventBlock.occurrence} is: a class
   * gets exactly one identity property, and no single field identifies a connection. The label
   * alone collapses every "contradicts" in a space into one record; either end alone is wrong by
   * construction, since the whole point is that a record has many connections.
   *
   * Written by the model rather than derived, because machine-authored instances go through
   * `create_subject` server-side and never pass WE's own write path — the hint spells the format.
   * Denormalised and never recomputed: relabel the connection and the next pass sees a different
   * one and writes a new record. That is the accepted cost of a single-property key, and it fails
   * in the safe direction — a duplicate somebody deletes, rather than two distinct claims merged.
   *
   * Not `required`, deliberately, and for the reason `occurrence` records: required would mean
   * every connection drawn by hand on a board carries `uninitialized`, and two of them would then
   * dedup into each other. Left unset, an instance is invisible to dedup — the right answer for a
   * record no machine is managing.
   */
  @Property({
    through: 'we://connection',
    identity: true,
    interpretationHint:
      'A dedup key, not a display value: the source id, the target id and the label joined, e.g. "we://a → we://b: contradicts". Always set it when you create a connection. Reuse an existing connection’s exact value only when this is the same claim about the same pair.',
  })
  connection: string = '';

  /**
   * Which kind of connection this is, when the community has named one.
   *
   * The same shape `Signal.signalTypeId` uses, and for the same reason: a kind is a record the
   * community owns, so referencing it by id gives a query something to filter on and an edge
   * style something to key on, where a free-text label gives neither.
   *
   * Optional, deliberately. A space that has not named any kinds yet still connects things, and
   * making this required would mean the first person to notice that two records are related has
   * to define a vocabulary before they can say so. The label carries the meaning until a kind
   * exists; afterwards it qualifies it — "contradicts, *specifically about the timeline*".
   */
  @Property({
    through: 'we://relationship_type_id',
    interpretationHint:
      'Leave this empty. It names a connection kind this community defined, and those are not in this prompt — an id guessed here would point at nothing and the connection would render without its kind.',
  })
  relationshipTypeId: string = '';

  /**
   * What the connection *is*, in the author's words — "contradicts", "came out of".
   *
   * Free text, because in a space that has named no kinds yet the vocabulary is the thing being
   * discovered, and a dropdown WE guessed at would be worse than a blank field. Once the
   * community has named kinds this becomes the qualifier on top of one — "contradicts,
   * *specifically about the timeline*" — so it is no longer required: a connection needs a kind
   * or a label, and the form enforces that rather than the schema, which cannot express "one of
   * these two".
   */
  @Property({
    through: 'we://title',
    interpretationHint:
      'What the connection is, in the speakers’ own words — a short lowercase verb phrase read source-to-target: "contradicts", "came out of", "blocks", "is the same as". Not a sentence, and not a summary of either end.',
  })
  label: string = '';

  /** Why — the room a one-word label does not leave. */
  @Property({
    through: 'we://description',
    interpretationHint:
      'One sentence saying what was actually said that makes this connection. Omit it when the label already says everything.',
  })
  description: string = '';

  /** Entity name of the source record, so the edge can be drawn without resolving it first. */
  @Property({
    through: 'we://source_type',
    interpretationHint:
      'The class name of the record `source` points at, exactly as it is named in this prompt — "TaskBlock", "Sighting". Stored beside the id so the connection can be drawn without loading either end.',
  })
  sourceType: string = '';

  /** Entity name of the target record. */
  @Property({
    through: 'we://target_type',
    interpretationHint: 'The class name of the record `target` points at, exactly as it is named in this prompt.',
  })
  targetType: string = '';

  @HasOne({ through: 'we://relationship_source' })
  source?: string;

  @HasOne({ through: 'we://relationship_target' })
  target?: string;
}
