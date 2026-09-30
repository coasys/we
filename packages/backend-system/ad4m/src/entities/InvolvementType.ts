/**
 * GENERATED from src/manifest/InvolvementType.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from './WeNode';

export type InvolvementSemantic = 'responsible' | 'reviewing' | 'committed' | 'interested' | 'declined';

/**
 * A kind of part a person can have in something — "Assigned", "Reviewing", "Going", "Maybe".
 *
 * The fourth of a family WE keeps arriving at: `SignalType` for reactions, `RelationshipType` for
 * connections, `TaskState` for stages of work, and this for how people stand in relation to it. A
 * record rather than a schema change, so a community can name its own; identified by a slug, so an
 * involvement can hold one and a filter can compare it. Deliberately the same shape as `TaskState`,
 * field for field where the two have the same job — a fourth instance of a known pattern is cheap,
 * and a fourth pattern would not be.
 *
 * Not "role". A role is a standing a person holds across a whole space — moderator, steward — and
 * that is a separate vocabulary WE wants room for. This is narrower: a person's part in one record.
 *
 * ## Why the semantic exists
 *
 * `TaskState.semantic`'s argument, one concept along. Once a community calls the assignee "Owner"
 * and adds "Shepherd", "who is on this" is answerable only by something that learned their words.
 * The semantic is the small closed fact underneath:
 *
 * | Question | Answered by |
 * |---|---|
 * | Who is doing this? | `responsible` |
 * | Who is checking it? | `reviewing` |
 * | Who is coming? | `committed` |
 * | Who might? | `interested` |
 * | Who has said no? | `declined` |
 *
 * Five, sized by the questions rather than by the words communities use. "Invited" is the obvious
 * sixth and is left out until something writes it: a question nothing asks is not yet a gap.
 *
 * ## Why `reflexive` is on the kind
 *
 * Whether somebody else may write it. Being assigned is something one person says about another; an
 * RSVP is only ever an agent's own answer, and a surface that let anybody mark anybody as going would
 * make every roster a claim nobody made. The distinction is the one `WeNode` draws between `mentions`
 * and `participants`, and it belongs to the kind because the kind is what a person picks.
 *
 * A reflexive kind is also **an answer**, and an agent gives one answer to a thing: going, maybe or
 * not going, never two at once. Non-reflexive kinds stack — a task can have an assignee and a
 * reviewer, and they can be the same person.
 *
 * ## Why `appliesTo`
 *
 * A community naming "Shepherd" wants it offered on a task and not on an event, and a picker that
 * offered every kind on everything would put "Going" in a task's assign menu. Entity names, joined
 * with commas — an entity name cannot contain one — and empty for every kind of record. A list in a
 * string rather than a relation because nothing queries by it; it is read to build a menu.
 *
 * ## No explicit order
 *
 * The semantic order above is the reading order, and nothing here is arranged into columns, so the
 * ordered relation `Space.taskStates` needs has no job to do yet.
 */
@Model({ name: 'InvolvementType' })
export class InvolvementType extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://involvement_type' })
  flag: string = '';

  @Property({ through: 'we://name', required: true })
  name: string = '';

  /** What `Involvement.kind` holds. Stable — rename the `name` instead; see `TaskState.slug`. */
  @Property({ through: 'we://slug' })
  slug: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  @Property({ through: 'we://icon' })
  icon: string = '';

  @Property({ through: 'we://color' })
  color: string = '';

  /** What this kind means to anything that never learned this community's words — see above. */
  @Property({ through: 'we://semantic' })
  semantic: InvolvementSemantic = 'responsible';

  /** Only the agent it is about may write it, and each agent holds at most one — see above. */
  @Property({ through: 'we://reflexive' })
  reflexive: boolean = false;

  /** Entity names this kind is offered on, comma-separated; empty for all — see above. */
  @Property({ through: 'we://applies_to' })
  appliesTo: string = '';

  /** Withdrawn from use without stranding anybody holding it — see `SignalType.retired`. */
  @Property({ through: 'we://retired' })
  retired: boolean = false;

  @Property({ through: 'we://schema_version' })
  schemaVersion: number = 1;
}
