import type { CoreEntityDef } from '../defs';

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
export const Relationship: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    interpretationHint:
      'A relationship a person asserted between two specific records — "contradicts", "caused by", "same as". Only extract one when the speakers connect two things that both already exist as records.',
    flag: { predicate: 'we://flag', value: 'we://relationship' },
    // `sourceType`/`targetType` are absent: they are set from what was connected, not typed by hand,
    // and so is `relationshipTypeId` — the form offers the kinds this community has named.
    authoring: { fields: ['label', 'description'] },
    properties: {
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
      relationshipTypeId: { type: 'string', predicate: 'we://relationship_type_id', default: '' },
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
      label: { type: 'string', predicate: 'we://title', default: '' },
      /** Why — the room a one-word label does not leave. */
      description: { type: 'string', predicate: 'we://description', control: 'textarea', default: '' },
      /** Entity name of the source record, so the edge can be drawn without resolving it first. */
      sourceType: { type: 'string', predicate: 'we://source_type', default: '' },
      /** Entity name of the target record. */
      targetType: { type: 'string', predicate: 'we://target_type', default: '' },
    },
    relations: {
      /*
        Untyped, and to-one on both sides.

        To-one because a relationship *is* the pair: connecting three things is three relationships,
        each of which can be argued with and weighted separately, where one record holding a list
        would collapse them into a claim nobody can disagree with a part of.
      */
      source: { target: '', cardinality: 'one', predicate: 'we://relationship_source' },
      target: { target: '', cardinality: 'one', predicate: 'we://relationship_target' },
    },
  },
};
