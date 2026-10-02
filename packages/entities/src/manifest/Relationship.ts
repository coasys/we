import type { CoreEntityDef } from './defs';

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
      'A connection the speakers made between two specific things — one depends on another, includes it, leads to it, blocks it, contradicts it. Extract one whenever somebody says how two things relate, whether each end is already listed here or is something you are creating in this response. One connection joins exactly one pair: a goal with three prerequisites is three connections.',
    flag: { predicate: 'we://flag', value: 'we://relationship' },
    /**
     * A candidate for extraction — off in a space that has made no choice, on where one has.
     *
     * The class hint below was written for extraction from the day it was added, and nothing ever
     * extracted a `Relationship`: the target list was a constant naming two block types. That was
     * the same gap this whole change exists to close, one entity along.
     *
     * A candidate rather than a default. What a community's calls are *about* is the community's to
     * say, and "the speakers connected two records that already exist" is a rarer and more specific
     * act than "somebody committed to something" — so a space turns this on deliberately rather than
     * finding relationships appearing in a meeting about anything else.
     */
    /*
      On, after a spell off. It was switched off because nothing had ever carried an extracted
      connection end to end, and three things stood in the way, all fixed with it: the class hint
      allowed only connections between records that already existed, which ruled out the case that
      matters — a new task said to depend on an old one; the canvas drew a line only between two
      *placed* cards, and everything a call extracts lands unplaced, in the tray; and a connection
      drawn by hand carried no `connection` key, and the executor shows a model only the instances
      that have one, so the structure people had drawn was invisible to the pass meant to extend it.
    */
    extractable: true,
    // `sourceType`/`targetType` are absent: they are set from what was connected, not typed by hand,
    // and so is `relationshipTypeId` — the form offers the kinds this community has named.
    //
    // Never in a "create something" picker, and not by a flag: it is not a block. A connection is
    // drawn between two records — a picker would open this form with two endpoints nobody had chosen.
    authoring: { fields: ['label', 'description'] },
    properties: {
      /**
       * What makes two mentions the same connection — the pair and the label, joined.
       *
       * The dedup key, and composite for the same reason {@link EventBlock.occurrence} is: a class
       * gets exactly one identity property, and no single field identifies a connection. The label
       * alone collapses every "contradicts" in a space into one record; either end alone is wrong by
       * construction, since the whole point is that a record has many connections.
       *
       * Written by the model for what it extracts, because machine-authored instances go through
       * `create_subject` server-side and never pass WE's own write path — the hint spells the format.
       * Written by WE for what people draw, in the same format (`connectionKey` in `RecordStore`),
       * and that is not optional: the executor shows a model only the instances whose identity is
       * set, so a connection drawn by hand without one was invisible to the pass meant to extend the
       * structure it was part of.
       *
       * Titles rather than ids, so the existing connections in a prompt read as the tree they are —
       * "Launch the beta → Write the onboarding guide: depends on" — and so a key a person's
       * connection carries and the one a model writes for the same claim are the same string. Ids
       * were tried first: a small model then had to resolve every key against the record list to
       * read the tree, misread one, and wrote titles in its own keys regardless.
       *
       * Denormalised, and kept in step by WE's own writes: rewritten when an end moves, when the
       * connection is relabelled, and when a record it joins is renamed through the inspector. A
       * rename made anywhere else leaves the key behind until the next of those, and the next pass may
       * then write a second record. That fails in the safe direction — a duplicate somebody deletes,
       * rather than two distinct claims merged.
       *
       * Not `required`, deliberately, and for the reason `occurrence` records: required would mean a
       * connection written without one carries `uninitialized`, and two of them would then dedup into
       * each other.
       */
      connection: {
        type: 'string',
        predicate: 'we://connection',
        interpretationHint:
          'A dedup key, not a display value: the two ends\u2019 titles and the label joined as "<source title> \u2192 <target title>: <label>". Write each end exactly as it is titled in this prompt, or as you title it when you are creating it in this response \u2014 never an id, and never a "new:" reference. Always set it when you create a connection. Reuse an existing connection\u2019s exact value only when this is the same claim about the same pair; a connection is never re-pointed at a different pair.',
        identity: true,
        default: '',
      },
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
      relationshipTypeId: {
        type: 'string',
        predicate: 'we://relationship_type_id',
        interpretationHint:
          'Leave this empty. It names a connection kind this community defined, and those are not in this prompt — an id guessed here would point at nothing and the connection would render without its kind.',
        default: '',
      },
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
      label: {
        type: 'string',
        predicate: 'we://title',
        interpretationHint:
          'What the connection is, in the speakers\u2019 own words \u2014 a short lowercase verb phrase read source-to-target, so from the broader end: "depends on", "includes", "leads to", "blocks", "contradicts". "Includes" rather than "is part of", which reads from the wrong end. Not a sentence, and not a summary of either end.',
        default: '',
      },
      /** Why — the room a one-word label does not leave. */
      description: {
        type: 'string',
        predicate: 'we://description',
        control: 'textarea',
        interpretationHint:
          'One sentence saying what was actually said that makes this connection. Omit it when the label already says everything.',
        default: '',
      },
      /** Entity name of the source record, so the edge can be drawn without resolving it first. */
      sourceType: {
        type: 'string',
        predicate: 'we://source_type',
        interpretationHint:
          'The class name of the record `source` points at, exactly as it is named in this prompt \u2014 "TaskBlock", "Sighting". Stored beside the id so the connection can be drawn without loading either end.',
        default: '',
      },
      /** Entity name of the target record. */
      targetType: {
        type: 'string',
        predicate: 'we://target_type',
        interpretationHint: 'The class name of the record `target` points at, exactly as it is named in this prompt.',
        default: '',
      },
    },
    relations: {
      /*
        Untyped, and to-one on both sides.

        To-one because a relationship *is* the pair: connecting three things is three relationships,
        each of which can be argued with and weighted separately, where one record holding a list
        would collapse them into a claim nobody can disagree with a part of.
      */
      /*
        Hinted, because which end is which is the one thing a tree needs and the declaration cannot
        say. The workshop reads a connection as parent → child, source first; a model left to guess
        connects a goal to its prerequisites either way round, and half the tree comes out inverted.
      */
      source: {
        target: '',
        cardinality: 'one',
        predicate: 'we://relationship_source',
        interpretationHint:
          'The broader or governing end: the goal, the whole, the thing that depends on or comes before the other. Read from source to target, connections form a tree from its roots down. Between peers, as with "contradicts", either way round. An existing entry\u2019s id, or a new:<Class>:<n> reference to something you create in this response.',
      },
      target: {
        target: '',
        cardinality: 'one',
        predicate: 'we://relationship_target',
        interpretationHint:
          'The narrower or following end: the prerequisite, the part, the next step. An existing entry\u2019s id, or a new:<Class>:<n> reference to something you create in this response.',
      },
    },
  },
};
