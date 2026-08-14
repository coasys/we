import type { RouteSchema, SchemaNode } from '@we/schema-shared';
import { emptyState, field } from '@we/template-kit';

/**
 * The space's tasks, as a board.
 *
 * ## Columns come from `status`, not from containment
 *
 * This is the opposite choice from the showcase `KanbanTemplate`, which makes a card's *column* its
 * status — boards and columns are `CollectionBlock`s there, and moving a card is a relink. That is
 * the more general model and it is right for a board somebody builds by hand: a community invents
 * whatever columns it needs, and the card and the board cannot disagree because there is only one
 * fact.
 *
 * It cannot work here, and the reason is extraction. A task written by a model has no column,
 * because the engine emits forward relations from the instance it creates and a card's membership
 * is a link from the *column* — the wrong direction. Nothing could put it on a board without either
 * a second truth on the task or a designated inbox column that every extracted task piles into
 * regardless of what it is about. Meanwhile the model does fill `status`, from a closed vocabulary,
 * because that is a property of the work.
 *
 * So this route reads `status` and a hand-built board reads containment, and the two are different
 * templates over the same records rather than two truths inside one. The kit's own warning applies
 * and is worth restating: **do not mix them in one view.** A status dropdown beside containment
 * columns is the disagreement both designs exist to avoid.
 *
 * The consequence worth naming: these three columns are a fixed vocabulary, where a hand-built
 * board's are not. That is the trade — a task appears here the moment a model finds it, and nobody
 * can invent a fourth column. Columns as saved queries would give both, and is where this goes.
 *
 * ## Ordering
 *
 * By creation, and no drag-to-reorder — the same constraint the kit's board documents. Ordering
 * within a column needs a conflict-free position (the AD4M CRDT work); a `position` scalar written
 * now is a shape that design supersedes.
 */
const COLUMNS = [
  { status: 'todo', label: 'To do', color: 'neutral-500' },
  { status: 'in-progress', label: 'In progress', color: 'primary-600' },
  { status: 'done', label: 'Done', color: 'success-600' },
] as const;

/** Tasks in one state, oldest first. */
const tasksIn = (status: string) => ({
  $query: { entity: 'TaskBlock', where: { status }, order: { createdAt: 'asc' }, limit: 100 },
});

/**
 * Moving a card is a `model.update` of one scalar.
 *
 * Cheap precisely because status is the truth here: no relinking, no read-modify-write, and two
 * people moving the same card concurrently converge on whichever wrote last rather than dropping
 * one of the writes.
 */
const moveMenu: SchemaNode = {
  type: 'DropdownMenu',
  props: {
    triggerIcon: 'arrows-left-right',
    size: 'xs',
    items: COLUMNS.map((spec) => ({
      id: spec.status,
      label: `Move to ${spec.label}`,
      onAction: { $action: 'model.update', args: ['TaskBlock', '$task.id', { status: spec.status }] },
    })),
  },
};

/** One card. Shows only what a board needs to triage; the detail belongs on the task itself. */
const card: SchemaNode = {
  type: 'Column',
  props: { width: '100%', gap: '200', bg: 'neutral-0', r: '300', p: '300', border: '1px solid neutral-200' },
  children: [
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['$task.title'] },
    {
      type: '$if',
      props: {
        condition: '$task.description',
        then: {
          type: 'we-text',
          props: { fontSize: '200', color: 'neutral-700', truncate: true },
          children: ['$task.description'],
        },
      },
    },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        {
          // Only when it is not the default, so a board is not a wall of "medium".
          type: '$if',
          props: {
            condition: { $ne: ['$task.priority', 'medium'] },
            then: {
              type: 'we-badge',
              props: {
                size: 'xs',
                variant: { $if: { condition: { $eq: ['$task.priority', 'high'] }, then: 'danger', else: 'neutral' } },
              },
              children: ['$task.priority'],
            },
          },
        },
        {
          type: '$if',
          props: {
            condition: '$task.dueDate',
            then: {
              type: 'we-text',
              props: { fontSize: '200', color: 'neutral-700' },
              children: ['$task.dueDate'],
            },
          },
        },
        {
          type: '$if',
          props: {
            condition: '$task.assignee',
            then: {
              type: 'we-text',
              props: { fontSize: '200', color: 'neutral-700' },
              children: [{ $concat: ['@', '$task.assignee'] }],
            },
          },
        },
        { type: 'Row', props: { ml: 'auto' }, children: [moveMenu] },
      ],
    },
  ],
};

/** One column: a heading with a count, and the cards in that state. */
const column = (spec: (typeof COLUMNS)[number]): SchemaNode => ({
  type: 'Column',
  props: {
    // A column has to read as a surface even when it is empty, or a board with one card in it looks
    // like a card with a stray heading. Hence the minimum height and the border: `neutral-100`
    // alone is nearly invisible against the page, which is what made the columns disappear.
    width: '300px',
    minHeight: '200px',
    gap: '300',
    bg: 'neutral-100',
    border: '1px solid neutral-200',
    r: '400',
    p: '300',
    ay: 'start',
  },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', width: '100%' },
      children: [
        { type: 'we-text', props: { variant: 'footnote', uppercase: true, color: spec.color }, children: [spec.label] },
        {
          // The count as a **prop**, not a child. A `$query` is hoisted into a subscription at
          // component setup, which is safe for a prop and not for a child — written as a child it
          // resolves to 0, silently, on a column with cards in it.
          type: 'we-text',
          props: {
            variant: 'footnote',
            color: 'neutral-500',
            ml: 'auto',
            text: { $count: { items: tasksIn(spec.status) } },
          },
        },
      ],
    },
    {
      type: '$each',
      props: { items: tasksIn(spec.status), as: 'task' },
      children: [card],
    },
  ],
});

/** Creating a task by hand — the other way work gets onto this board, beside extraction. */
const composer: SchemaNode = {
  type: '$if',
  props: {
    condition: { $local: 'composerOpen' },
    then: {
      type: 'we-modal',
      props: { close: { $setLocal: 'composerOpen', value: false } },
      children: [
        { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['New task'] },
        field({ name: 'draftTitle', label: 'What needs doing?', placeholder: 'Ship the docs' }),
        field({ name: 'draftDescription', label: 'Notes', control: 'textarea', placeholder: 'Optional' }),
        field({
          name: 'draftStatus',
          label: 'Status',
          control: 'select',
          props: { options: COLUMNS.map((spec) => ({ label: spec.label, value: spec.status })) },
        }),
        {
          type: 'Row',
          props: { ax: 'end', gap: '200' },
          children: [
            {
              type: 'we-button',
              props: { variant: 'ghost', onClick: { $setLocal: 'composerOpen', value: false } },
              children: ['Cancel'],
            },
            {
              type: 'we-button',
              props: {
                disabled: { $not: { $local: 'draftTitle' } },
                onClick: {
                  $action: 'model.create',
                  args: [
                    'TaskBlock',
                    {
                      title: { $local: 'draftTitle' },
                      description: { $local: 'draftDescription' },
                      status: { $local: 'draftStatus' },
                    },
                  ],
                  onSuccess: [
                    { $setLocal: 'composerOpen', value: false },
                    { $setLocal: 'draftTitle', value: '' },
                    { $setLocal: 'draftDescription', value: '' },
                  ],
                },
              },
              children: ['Add task'],
            },
          ],
        },
      ],
    },
  },
};

export const tasksRoute: RouteSchema = {
  path: '/tasks',
  type: 'Column',
  props: { width: '100%', ax: 'center', p: '500' },
  $localState: {
    composerOpen: { type: 'boolean', initial: false },
    draftTitle: { type: 'string', initial: '' },
    draftDescription: { type: 'string', initial: '' },
    draftStatus: { type: 'string', initial: 'todo' },
  },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: 'var(--we-layout-lg)', gap: '400' },
      children: [
        {
          type: 'Row',
          props: { width: '100%', ay: 'center', gap: '300' },
          children: [
            { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Tasks'] },
            {
              type: 'we-button',
              props: { size: 'sm', ml: 'auto', onClick: { $setLocal: 'composerOpen', value: true } },
              children: ['New task'],
            },
          ],
        },
        composer,
        {
          type: '$if',
          props: {
            condition: {
              $or: COLUMNS.map((spec) => ({ $count: { items: tasksIn(spec.status) } })),
            },
            then: {
              type: 'Row',
              props: { width: '100%', gap: '400', ay: 'start', overflow: 'auto' },
              children: COLUMNS.map(column),
            },
            else: emptyState({
              icon: 'check-square',
              label: 'tasks',
              message: 'No tasks yet. Add one, or record a call — extraction writes down the work people commit to.',
            }),
          },
        },
      ],
    },
  ],
};
