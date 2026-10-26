import type { CoreEntityDef } from './defs';

/**
 * How a kind of thing is drawn, on one board.
 *
 * The other half of {@link Placement}: that says how *this card* looks, this says how *everything of
 * this type* looks. Both are presentation attached to a view rather than to a record, and the split
 * is the difference between decorating one note and giving a board a vocabulary — "tasks are blue
 * here, decisions are amber" is a fact about the board, and repeating it on every card would mean
 * re-deciding it every time somebody adds one.
 *
 * ## Why it belongs to the board rather than to the type
 *
 * Because two boards in the same space legitimately disagree. A retro board colours by task status,
 * a roadmap colours by team, and neither is wrong about what a `TaskBlock` *is* — they are answering
 * different questions with the same records. A colour stored on the type would make the last board
 * somebody styled win everywhere, silently, which is the class of change nobody can attribute.
 *
 * That argument decides where a board's *override* lives, and it left the ordinary case homeless:
 * most of the time "tasks are blue" is a fact about the community, and a canvas made tomorrow should
 * start out coloured like every other one. So the same record is also parented to the `Space`,
 * through `Space.typeStyles`, as the key every canvas falls back to. A canvas's own children still
 * win where it has any.
 *
 * ## Why one record per type rather than a map on the board
 *
 * The same reason `Placement` is one record per card: a map in a field is a read-modify-write, and
 * on a shared board two people colouring two different types would clobber each other. One record
 * per fact means two independent changes are two independent writes.
 *
 * ## Beside colour: how a card and a form are laid out
 *
 * The same record carries the rest of a type's presentation where this community wants something
 * other than the model's own — a card's title and summary, the control a field uses, the fields a
 * form asks for. A model ships its author's defaults; a record here overrides only what it sets, and
 * a template can still override both. See `shared/shapes/presentation.ts` in `@we/app-shell`.
 *
 * ## What this is the start of
 *
 * Colour is the first rule, not the only conceivable one. The board's key is a legend today and a
 * *control* eventually — colour by task status, by author, by how recently something changed — and
 * that is a rule with a field and a mapping rather than one colour per type. When it comes, it
 * belongs here, on the record that already means "how this board draws things", rather than in a
 * second model beside it.
 */
export const TypeStyle: CoreEntityDef = {
  base: 'Ad4mModel',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://type_style' },
    properties: {
      /** Entity name this styles — `TaskBlock`, `CollectionBlock`, a shape the community defined. */
      nodeType: { type: 'string', predicate: 'we://node_type', default: '' },
      /** Design token or CSS colour. Empty is unset, and the board's own rules decide again. */
      color: { type: 'string', predicate: 'we://color', default: '' },
      /*
        How a card of this type is laid out, where the model's own display is not what this space or
        board wants — which field titles it, which summarises it, which pictures it, which it lists.
        JSON of the same shape as an entity's `display`; a key it leaves out falls through to the
        model's. Empty is unset.

        Presentation and not meaning, so it lives here rather than on the model: a community choosing
        what its sighting cards show must not need to change the model itself — nor bump its version,
        nor mark it changed against wherever it came from.
      */
      display: { type: 'string', predicate: 'we://type_display', default: '' },
      /** The form control a field uses here, by field name — JSON. Empty is unset. */
      controls: { type: 'string', predicate: 'we://type_controls', default: '' },
      /** The fields a form for this type asks for, in order — JSON list. Empty is unset. */
      authoring: { type: 'string', predicate: 'we://type_authoring', default: '' },
    },
    // None. A type is a name here rather than a record: the entity being styled may be a shape this
    // community defined last week, which has no node to point a relation at.
    relations: {},
  },
};
