/**
 * GENERATED from src/manifest/TaskState.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from './WeNode';

export type TaskStateSemantic = 'open' | 'active' | 'blocked' | 'done' | 'cancelled';

/**
 * A state a community's work can be in — "To do", "Blocked", "In review".
 *
 * The middle tier between a frozen enum and free text, and the third time WE has needed it:
 * `SignalType` for reactions, `RelationshipType` for connections, this for the states work moves
 * through. A record rather than a schema change, so any community can name its own; identified by a
 * slug, so a query can filter on it and a board column can bind to it.
 *
 * ## Why the semantic exists
 *
 * A name is for people and cannot be reasoned about. Once a community renames "Done" to "Shipped"
 * and adds "Parked", "what work is outstanding here" is no longer answerable by anything that did
 * not write the vocabulary — which is every other surface, every peer, and every agent. `semantic`
 * is the small closed fact underneath the free one, sized by the questions that have to be
 * answerable from outside the space — see the table on the property itself.
 *
 * Exactly `SignalType.semantic`'s reasoning, and for the same reason: a community should be able to
 * invent its vocabulary without making the space illegible to everything that has not learned it.
 *
 * ## Why a task holds the slug rather than the record id
 *
 * `Signal` names its type by record id, and the note on `SignalType.retired` records what that cost:
 * deleting a type strands every reaction ever given, because a re-created one is a new record with a
 * new id. A task's state is a much commoner thing to write and a much cheaper thing to be wrong
 * about, and the slug buys two things the id cannot — every task that already exists keeps working
 * with no migration at all, and the stored value stays legible to somebody reading raw links.
 *
 * The cost is that renaming a slug orphans the tasks holding it. So don't: rename the `name`, which
 * is the part people read, and leave the slug alone. `retired` is here for the same reason it is on
 * `SignalType` — withdrawing a state from use must not strand the work sitting in it.
 *
 * ## No explicit order
 *
 * Columns want an order, and this deliberately does not carry one. `semantic` already gives the only
 * ordering that means anything across communities — what is coming, what is happening, what is
 * stuck, what is finished, what was dropped — and a number here would be a position scalar of
 * exactly the kind two people editing at once break. A community that wants its own order says so
 * through `Space.taskStates`, which is an ordered relation and converges; this is the reading order
 * for a state nobody has positioned.
 */
@Model({ name: 'TaskState' })
export class TaskState extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://task_state' })
  flag: string = '';

  @Property({ through: 'we://name', required: true })
  name: string = '';

  /**
   * What `TaskBlock.status` holds. Stable — see the note above on renaming.
   *
   * Derived from the name when a community does not supply one, exactly as a signal type's is.
   */
  @Property({ through: 'we://slug' })
  slug: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  @Property({ through: 'we://icon' })
  icon: string = '';

  @Property({ through: 'we://color' })
  color: string = '';

  /**
   * What this state means to anything that never learned this community's words.
   *
   * Five values, and the number is set by the questions that have to be answerable from outside
   * the space rather than by the vocabulary communities happen to use — that list is endless.
   *
   * | Question | Answered by |
   * |---|---|
   * | Is this outstanding? | `open`, `active`, `blocked` — and not `done`, `cancelled` |
   * | Is anybody on it? | `active` |
   * | Is it stuck? | `blocked` |
   * | Was it actually completed? | `done`, and not `cancelled` |
   *
   * There were three. `blocked` and `cancelled` were added because the three collapsed two
   * distinctions communities reach for immediately and nothing could recover: "Blocked" had to
   * claim it had not started, which is false, and "Cancelled" had to claim it was finished, which
   * would make any count of completed work wrong. Settings → Vocabulary offered "Blocked" as its
   * own example of a state worth naming, so the contradiction shipped.
   *
   * A sixth would need a sixth question. *In review* (a stage of flow, so `active`) and *Archived*
   * (finished, or no longer relevant) are judgement calls rather than gaps.
   *
   * Every consumer is written as a fallback chain ending in the outstanding branch, so a peer on
   * older code reading `blocked` sees outstanding-and-nobody-on-it, which is right, and reading
   * `cancelled` over-counts outstanding work rather than hiding finished work. Visibly misfiled
   * rather than silently gone, which is the rule the unplaced column follows too.
   */
  @Property({ through: 'we://semantic' })
  semantic: TaskStateSemantic = 'open';

  /** Withdrawn from use without stranding the work in it — see `SignalType.retired`. */
  @Property({ through: 'we://retired' })
  retired: boolean = false;

  @Property({ through: 'we://schema_version' })
  schemaVersion: number = 1;
}
