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
 */
@Model({
  name: 'TaskBlock',
  interpretationHint:
    'Something a participant committed to doing, or was asked to do, that is not done yet. ' +
    'Only extract a task when someone actually takes it on or assigns it — not for work merely ' +
    'discussed, considered, or described as already finished.',
})
export class TaskBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://task_block' })
  flag: string = '';

  @Property({
    through: 'we://title',
    required: true,
    interpretationHint: 'The task as a short imperative phrase, e.g. "Ship the docs". No trailing period.',
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
    initial: 'todo',
    interpretationHint:
      'Exactly one of: "todo", "in-progress", "done". Use "todo" unless the speaker says work has begun.',
  })
  status: string = 'todo';

  @Property({
    through: 'we://priority',
    initial: 'medium',
    interpretationHint:
      'Exactly one of: "low", "medium", "high". Use "medium" unless urgency is stated; do not infer it from tone.',
  })
  priority: string = 'medium';

  @Property({
    through: 'we://due_date',
    interpretationHint:
      'Due date as YYYY-MM-DD. Only when a date is actually stated — resolve "Friday" against the turn timestamp. Omit if vague.',
  })
  dueDate: string = '';

  @Property({
    through: 'we://assignee',
    interpretationHint:
      'Who took the task on, as the name used in conversation ("James"), not a DID. Omit if nobody was named.',
  })
  assignee: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}
