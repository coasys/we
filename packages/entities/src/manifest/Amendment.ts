import type { CoreEntityDef } from './defs';

/**
 * One change a model suggested to a record that already existed, and somebody kept.
 *
 * ## Why accepting a change has to write something
 *
 * A model suggests two kinds of thing, and only one of them leaves a trace by itself. A record it
 * *makes* is real and says where it came from. A change to a record that was already agreed is
 * applied to that record, and after that nothing anywhere says it happened: the record holds a new
 * value with no account of where the value came from, and the decision to keep it leaves no mark.
 *
 * ## Why the previous value is stored rather than derived
 *
 * It cannot be derived. Applying the change overwrites it, so the moment an amendment is worth
 * recording is the last moment the old value exists. That is also why this is a record per
 * *property* rather than a relation naming the records a run changed: a relation carries no data,
 * so it could say a task was changed and never which field or from what.
 *
 * ## What is deliberately not here
 *
 * **The property's label**, which the entity's declaration already carries, and **the record's
 * title**, which is read from the record rather than snapshotted. **Who and when** are `author` and
 * `createdAt`, which every record carries: who *kept* the change, not who suggested it.
 *
 * ## How it connects
 *
 * What the change was made from holds it in its `amendments` (`CollectionBlock.amendments`: a call,
 * for an extraction), so a panel open on the call reads it with the subject it reads everything else
 * with. {@link run} names the run that suggested it, where the writer knows which one.
 */
export const Amendment: CoreEntityDef = {
  base: 'Ad4mModel',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://amendment' },
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
      /** The run that suggested the change, where the writer knows which one. */
      run: { target: 'ModelRun', cardinality: 'one', predicate: 'we://amendment_run' },
    },
  },
};
