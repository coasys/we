import type { CoreEntityDef } from './defs';

/**
 * One change an extraction pass suggested to a record that already existed, and somebody kept.
 *
 * ## Why accepting a change had to start writing something
 *
 * A pass produces two kinds of suggestion, and only one of them left a trace. A *create* is written
 * as a real record and hangs off the call as `extracted`, so what a conversation produced survives
 * the panel that reviewed it. An *update* applied its value to a record that was already agreed and
 * then resolved its overlay — and after that nothing anywhere said it had happened. The record held
 * a new value with no account of where the value came from; the reviewer's decision left no mark at
 * all.
 *
 * The asymmetry read as a gap in the panel and was really a gap in the data. Three of the four
 * quadrants a review surface has — pending record, pending change, accepted record — were
 * answerable from storage; the fourth had nothing behind it, so no section could be written for it
 * however the panel was arranged.
 *
 * ## Why the previous value is stored rather than derived
 *
 * It cannot be derived. Applying the change overwrites it, so the moment an amendment is worth
 * recording is the last moment the old value exists. Everything else here could in principle be
 * recovered — the new value is on the record, the pass's `response` holds what was proposed — and
 * {@link previousValue} is the one fact that is gone for good if nobody writes it down.
 *
 * That is also the whole argument for this being a record per *property* rather than a relation
 * naming the records a call amended. A relation carries no data, so it could say a task was changed
 * and never which field or from what — which is the interesting half, and is what makes this a log
 * rather than a badge.
 *
 * ## What is deliberately not here
 *
 * **The property's label.** `recordStore.displays[nodeType].fields` already carries the label for
 * every declared property, so storing "Due date" beside `dueDate` would be a second copy of
 * something the declaration answers — and one that would not follow a model whose property is later
 * relabelled. Where the type is unknown a reader sees the raw property name, which is exactly how
 * every other surface in the extraction panel degrades.
 *
 * **The record's title.** It is read from the record, not snapshotted, because a card naming what a
 * record *used to be called* would be a worse answer than naming what it is. The amendment is about
 * one property; nothing about it claims the rest of the record stood still.
 *
 * **Who and when.** `author` and `createdAt`, which every record carries.
 *
 * ## Why it hangs off the call
 *
 * `CollectionBlock.amendments`, the same shape `extractionPasses` and `extracted` use and for the
 * same reason: a panel open on one call reads it with the subject it reads everything else with.
 * Its own relation rather than `children`, which holds a collection's *content* — an amendment is a
 * fact about the collection, and in `children` it would be loaded by the board and drawn as a card.
 */
export const ExtractionAmendment: CoreEntityDef = {
  base: 'Ad4mModel',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://extraction_amendment' },
    properties: {
      /**
       * The property that changed, by its name on the model — `status`, `dueDate`.
       *
       * The name rather than the predicate, because every surface that would read this speaks
       * property names: `recordStore.displays` is keyed by them, and the proposal it came from
       * carried them. A predicate would have to be translated back through the dataset's shapes at
       * every read, and one-to-many at that — see `NameTables` in `interpretationAdapter.ts`.
       */
      property: { type: 'string', predicate: 'we://amended_property', default: '' },
      /**
       * What the record held before, as it was shown to whoever accepted the change.
       *
       * A string whatever the property's type, because this is testimony rather than data: nothing
       * computes with it, one surface prints it beside the new value, and a number kept as a number
       * here would only invite a comparison that means nothing once the record has moved on.
       *
       * Empty where the record held nothing — a property being filled in for the first time is an
       * ordinary amendment and the common one.
       */
      previousValue: { type: 'string', predicate: 'we://previous_value', default: '' },
      /**
       * What it was changed to. Stored, though the record carries it, because a later edit makes
       * the record and this disagree — and at that point the record is right about the present and
       * this is right about what was accepted, which is the question a log answers.
       */
      newValue: { type: 'string', predicate: 'we://new_value', default: '' },
      /**
       * Entity name of the amended record — the same fact {@link Placement} carries beside its own
       * untyped `node`, on the same predicate and for the same reason: the relation supplies no
       * type, and a reader needs one to know how to draw the row or what to query.
       *
       * Empty where the backend could not classify the record, which is the executor gap the rest
       * of the extraction panel already degrades around.
       */
      nodeType: { type: 'string', predicate: 'we://node_type', default: '' },
    },
    relations: {
      /**
       * The record that was amended. Untyped, because a pass can suggest a change to anything the
       * space's vocabulary holds.
       *
       * Read as a bare URI rather than hydrated, exactly as `Placement.node` is: an untyped relation
       * has no target class for the ORM to hydrate into, and a reader wants the id anyway — to query
       * the record for its current title, or to open it.
       */
      node: { target: '', cardinality: 'one', predicate: 'we://amended_node' },
    },
  },
};
