/**
 * GENERATED from src/manifest/entities/TypeStyle.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/models generate:classes` after changing it.
 */
import { Ad4mModel, Flag, Model, Property } from '@coasys/ad4m';

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
 * ## Why one record per type rather than a map on the board
 *
 * The same reason `Placement` is one record per card: a map in a field is a read-modify-write, and
 * on a shared board two people colouring two different types would clobber each other. One record
 * per fact means two independent changes are two independent writes.
 *
 * ## What this is the start of
 *
 * Colour is the first rule, not the only conceivable one. The board's key is a legend today and a
 * *control* eventually — colour by task status, by author, by how recently something changed — and
 * that is a rule with a field and a mapping rather than one colour per type. When it comes, it
 * belongs here, on the record that already means "how this board draws things", rather than in a
 * second model beside it.
 */
@Model({ name: 'TypeStyle' })
export class TypeStyle extends Ad4mModel {
  @Flag({ through: 'we://flag', value: 'we://type_style' })
  flag: string = '';

  /** Entity name this styles — `TaskBlock`, `CollectionBlock`, a shape the community defined. */
  @Property({ through: 'we://node_type' })
  nodeType: string = '';

  /** Design token or CSS colour. Empty is unset, and the board's own rules decide again. */
  @Property({ through: 'we://color' })
  color: string = '';
}
