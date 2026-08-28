/**
 * GENERATED from src/manifest/blocks/TaskBlock.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/models generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

/**
 * Interpretation hints: what the LLM is told when this class is an extraction target.
 *
 * They are **prompt payload, not documentation** — the executor puts every property of every
 * selected class into the prompt, each carrying its `hint` and its `required` flag, so a hint costs
 * tokens on every run and a class's whole shape ships whether or not its fields are hinted. That
 * asymmetry is the rule for adding more: hint the fields a person actually says out loud, and keep
 * the class list short rather than the hints short.
 *
 * Two things a hint has to carry that the type cannot. **Closed vocabularies** — `status` and
 * `priority` are `string` in SHACL, so without the allowed values spelled out a model invents
 * `"pending"` or `"urgent"` and the block renders an unrecognised tag. **Exact date formats** —
 * `dueDate` feeds an `<input type="date">` and `EventBlock`'s dates feed `datetime-local`, which
 * are different formats; a value the model formats its own way survives the write and then fails to
 * load into the edit form, which looks like data loss rather than a formatting slip.
 *
 * ## Written permissively, on evidence
 *
 * The first version of these hints was tuned against false positives — a task only if somebody
 * *took it on*, an event only at a *specific agreed time*. Run against a real transcript containing
 * "one task we need to complete is finishing up the model API" and "an event coming up this weekend,
 * going to visit my grandma", it extracted **nothing**, and was right to: neither sentence clears
 * those bars, and speech almost never does.
 *
 * The lesson is about which error is recoverable. A missed task is invisible — nobody knows to look
 * for it, and the transcript scrolls away. An over-eager one is a row a human deletes in a second,
 * and the §4 provenance gate already exists to hold anything contentious for review. So these lean
 * permissive, and the exclusions are only for things that are definitely not the class at all.
 */
@Model({
  name: 'TaskBlock',
  interpretationHint:
    'A piece of work the speakers say needs doing and that is not done yet. Includes anything phrased as "we need to…", "one task is…", "someone should…", or a commitment like "I\'ll do X" — an owner is not required, and neither is a deadline. It must be work in the world that outlives this conversation. Exclude work described as already finished, work raised purely to rule it out, and anything about the act of talking or testing itself — "let me add another one", "I need to say more to trigger this" and the like are about the conversation, not work anybody committed to.',
})
export class TaskBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://task_block' })
  flag: string = '';

  /**
   * The task, and its dedup key.
   *
   * `identity` is what makes extraction *converge*. A class that declares none is skipped when
   * the executor assembles the "instances that already exist" block, so the model is never
   * shown it, the deterministic dedup net has nothing to compare against, and every pass mints
   * fresh copies of everything it finds. Without this, pressing Extract twice on one call
   * produced two of every task.
   *
   * It is not what admits a class to extraction — `extractable` on the entity is (a class
   * without an identity property still extracts, it merely duplicates). Which is why an
   * authoring surface offering the one should warn about the absence of the other.
   *
   * It does three jobs at once, which is why the name reads oddly: it selects the human-readable
   * label the model matches against, it is the value compared for equality, and its presence is
   * what puts this class's existing instances in front of the model. Matching is normalised — trimmed, whitespace-collapsed,
   * lowercased — so "Ship  the docs " and "ship the docs" are one task, but "Ship the docs" and
   * "Send the docs" are two. Semantic (embedding) matching exists upstream as a strategy and is
   * the better default here eventually.
   *
   * Title is the right key for a task because a task *is* its statement of work: two calls both
   * saying "finish the model API" mean one task, and that convergence across conversations is the
   * whole point. Contrast {@link EventBlock}, where the same title recurs weekly and means
   * different occasions.
   */
  @Property({
    through: 'we://title',
    required: true,
    identity: true,
    interpretationHint:
      'The task as a short imperative phrase, e.g. "Ship the docs". No trailing period. Never include the bracketed timestamp that starts each turn — it is metadata, not speech. Reuse the wording of an existing task when this is the same piece of work said again.',
  })
  title: string = '';

  @Property({
    through: 'we://description',
    interpretationHint:
      'Extra context from the conversation that the title alone loses. Omit rather than restate the title.',
  })
  description: string = '';

  @Property({
    through: 'we://status',
    interpretationHint:
      'Exactly one of: "todo", "in-progress", "done". Use "todo" unless the speaker says work has begun.',
  })
  status: string = 'todo';

  @Property({
    through: 'we://priority',
    interpretationHint:
      'Exactly one of: "low", "medium", "high". Use "medium" unless urgency is stated; do not infer it from tone.',
  })
  priority: string = 'medium';

  @Property({
    through: 'we://due_date',
    interpretationHint:
      'Due date as YYYY-MM-DD. Only when a date is actually stated — resolve "Friday" against the bracketed timestamp leading that turn. Omit if vague.',
  })
  dueDate: string = '';

  @Property({
    through: 'we://assignee',
    interpretationHint:
      'Who took the task on, as the name used in conversation ("James"), not a DID. Omit if nobody was named.',
  })
  assignee: string = '';

  @Property({ through: 'we://version', interpretationHint: 'Bookkeeping. Never set this — WE maintains it.' })
  version: number = 0;
}
