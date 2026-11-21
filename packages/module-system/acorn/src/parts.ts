import type { ModulePart } from '@we/module-shared';

/**
 * The Acorn parts, named for what they are — the set the later stages fill in.
 *
 * v0 stubs are honest stubs: `outcomeCard` and `expandedOutcome` draw one record's fields;
 * the list parts query the mounted classes directly. The map and dashboard are declarations
 * of intent — they exist so the module's surface is named in one place, not to pretend the
 * canvas landed early.
 *
 * What is deliberately *not* here: the projects dialog. It drives the `space-admin`
 * `spaceStore.*AcornProject*` members, so it lives in `@we/template-shell` and renders at
 * the chrome tier — a part would render in the tier of whoever mounted it. This module
 * draws a project's insides; who may create one is the host's business.
 *
 * Everything else here reads `Acorn*` records through `$query` or declares its row as an
 * `input` — never a module store, which this module does not have.
 */
/*
  The add steps, shared by the Add button and Enter in the input. `addingOutcome`
  marks the write in flight so a second press — a double click or Enter while the
  first is still out — cannot start another. `onFinally`, not `onSuccess`: a
  failed add still releases the lock.
*/
const addOutcome = [
  { $setLocal: 'addingOutcome', value: true },
  {
    $invoke: 'record.create',
    args: ['AcornOutcome', { content: { $: 'local.newOutcome' } }],
    onFinally: [
      { $setLocal: 'newOutcome', value: '' },
      { $setLocal: 'addingOutcome', value: false },
    ],
  },
];

export const ACORN_PARTS: Record<string, ModulePart> = {
  outcomeList: {
    label: 'Outcome list',
    description:
      'Every outcome in the mounted project — each editable in place, with its status line, tag picker and delete',
    node: {
      type: 'Column',
      props: { gap: '300', width: '100%' },
      $localState: {
        newOutcome: { type: 'string', initial: '' },
        addingOutcome: { type: 'boolean', initial: false },
      },
      children: [
        /*
          The create row: `record.create` is the generic write the host gives every space
          surface, so the same action runs against the in-memory backend in tests and the
          mounted dataset live — where it lands through the mount's `create` call action,
          not a link write (design §W.2). The draft clears on the click regardless; the row
          appears when the query re-runs.
        */
        {
          type: 'Row',
          props: { gap: '200', width: '100%' },
          children: [
            {
              type: 'we-input',
              props: {
                flex: '1',
                value: { $: 'local.newOutcome' },
                placeholder: 'New outcome…',
                onInput: { $setLocal: 'newOutcome', value: { $: 'event.detail' } },
                onKeyDown: {
                  $if: {
                    condition: { $: `arg.detail.key == 'Enter' && trim(local.newOutcome) && !local.addingOutcome` },
                    then: addOutcome,
                  },
                },
              },
            },
            {
              type: 'we-button',
              props: {
                variant: 'solid',
                disabled: { $: '!trim(local.newOutcome) || local.addingOutcome' },
                onClick: addOutcome,
              },
              children: ['Add outcome'],
            },
          ],
        },
        /*
          One row per outcome, oldest first — the mount's `update`/`delete` call actions are
          what the generic record paths reach on a mounted class, so every control here is a
          plain `record.*`/`recordStore.*` invoke: no Acorn-specific write path exists or
          needs one.
        */
        {
          type: '$each',
          props: {
            items: { $query: { entity: 'AcornOutcome', order: { timestampCreated: 'asc' } } },
            as: 'outcome',
          },
          children: [
            {
              type: 'Row',
              props: { gap: '300', ay: 'center', p: '300', bg: 'surface', r: 'surface', width: '100%' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '100', flex: '1 1 auto', minWidth: '0' },
                  children: [
                    /*
                      Content and description commit on change — the same
                      `recordStore.updateRecordField` a UI edit goes through everywhere
                      (`RecordStore.tsx`), so the model layer owns what reaching the mount
                      means. The placeholders carry the outcome's content so a page reader
                      can tell the fields of one row from the next's.
                    */
                    {
                      type: 'we-input',
                      props: {
                        width: '100%',
                        value: { $: 'outcome.content' },
                        placeholder: { $: 'outcome.content' },
                        /*
                          A change that holds only whitespace is not a rename — saving it would
                          blank the outcome's title. The write is skipped, so the previous
                          content stays.
                        */
                        onChange: {
                          $if: {
                            condition: { $: 'trim(arg.detail)' },
                            then: {
                              $invoke: 'recordStore.updateRecordField',
                              args: ['AcornOutcome', { $: 'outcome.id' }, 'content', { $: 'event.detail' }],
                            },
                          },
                        },
                      },
                    },
                    {
                      type: 'Row',
                      props: { gap: '200', ay: 'center', width: '100%' },
                      children: [
                        {
                          type: 'we-input',
                          props: {
                            flex: '1',
                            value: { $: 'outcome.description' },
                            placeholder: { $: '`Notes: ${outcome.content}`' },
                            onChange: {
                              $invoke: 'recordStore.updateRecordField',
                              args: ['AcornOutcome', { $: 'outcome.id' }, 'description', { $: 'event.detail' }],
                            },
                          },
                        },
                        {
                          type: 'we-text',
                          props: { fontSize: 'sm', tone: 'secondary', whiteSpace: 'nowrap' },
                          children: [{ $: 'acornOutcomeSummary({ outcome: outcome })' }],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'Row',
                  /*
                    `0 1 auto` + wrap, not `0 0 auto`: every tag's button is priced in its
                    `Tag <text> → <content>` label, so an unshrinkable row squeezes the
                    content column to zero width once the tags outnumber a single line —
                    the input stays in the DOM, invisible. Wrapping lets the buttons give
                    that ground back.
                  */
                  props: { gap: '200', ay: 'center', flex: '0 1 auto', minWidth: '0', wrap: true },
                  children: [
                    /*
                      The collection's setter-replace surface: each existing tag assigns itself
                      (`tags: [this tag]`), and the plain button empties the list — both through
                      `record.update`, which the model layer turns into the mount's `update`
                      call (design §W.3). A richer picker belongs to a later step; what S2-3
                      needs is one way to write a whole new member list.
                    */
                    {
                      type: '$each',
                      props: { items: { $query: { entity: 'AcornTag', order: { text: 'asc' } } }, as: 'tag' },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            variant: 'soft',
                            size: 'sm',
                            onClick: {
                              $invoke: 'record.update',
                              args: ['AcornOutcome', { $: 'outcome.id' }, { tags: [{ $: 'tag.id' }] }],
                            },
                          },
                          children: [{ $: '`Tag ${tag.text} → ${outcome.content}`' }],
                        },
                      ],
                    },
                    {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: {
                          $invoke: 'record.update',
                          args: ['AcornOutcome', { $: 'outcome.id' }, { tags: [] }],
                        },
                      },
                      children: [{ $: '`Untag ${outcome.content}`' }],
                    },
                    {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: {
                          $invoke: 'record.delete',
                          args: ['AcornOutcome', { $: 'outcome.id' }],
                        },
                      },
                      children: [{ $: '`Delete ${outcome.content}`' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  outcomeCard: {
    label: 'Outcome card',
    description: 'One outcome — its content, and status/progress/scope as a line under it',
    subject: 'outcome',
    inputs: { outcome: { description: 'the AcornOutcome record this card draws' } },
    node: {
      type: 'Column',
      props: { gap: '100', p: '300', bg: 'surface', r: 'surface' },
      children: [
        { type: 'we-text', props: { fontWeight: 'medium' }, children: [{ $: 'outcome.content' }] },
        {
          type: 'we-text',
          props: { fontSize: 'sm', tone: 'secondary' },
          children: [{ $: 'acornOutcomeSummary({ outcome: outcome })' }],
        },
      ],
    },
  },
  expandedOutcome: {
    label: 'Expanded outcome',
    description: 'One outcome, full: content, description, tasks, estimate and time frame',
    subject: 'outcome',
    inputs: { outcome: { description: 'the AcornOutcome record shown expanded' } },
    node: {
      type: 'Column',
      props: { gap: '300', p: '400' },
      children: [
        { type: 'we-text', props: { fontSize: 'xl', fontWeight: 'bold' }, children: [{ $: 'outcome.content' }] },
        { type: 'we-text', children: [{ $: 'outcome.description' }] },
        {
          type: 'we-text',
          props: { tone: 'secondary' },
          children: [{ $: 'acornOutcomeSummary({ outcome: outcome })' }],
        },
        {
          type: 'we-text',
          props: { tone: 'secondary' },
          children: [{ $: 'acornTimeFrameLabel({ timeFrame: outcome.timeFrame })' }],
        },
      ],
    },
  },
  outcomeTable: {
    label: 'Outcome table',
    description: 'Every outcome in the project as a row — content, scope, status, progress',
    node: {
      type: 'Column',
      props: { gap: '200', width: '100%' },
      children: [
        {
          type: '$each',
          props: { items: { $query: { entity: 'AcornOutcome', order: { content: 'asc' } } }, as: 'outcome' },
          children: [
            {
              type: 'Row',
              props: { gap: '400', p: '300', borderBottom: '1px solid border', width: '100%' },
              children: [
                { type: 'we-text', props: { flex: '3 1 0' }, children: [{ $: 'outcome.content' }] },
                {
                  type: 'we-text',
                  props: { flex: '1 1 0', tone: 'secondary' },
                  children: [{ $: 'acornScopeLabel({ scope: outcome.scopeType })' }],
                },
                {
                  type: 'we-text',
                  props: { flex: '1 1 0', tone: 'secondary' },
                  children: [{ $: 'acornStatusLabel({ status: outcome.achievementStatus })' }],
                },
                {
                  type: 'we-text',
                  props: { flex: '1 1 0', tone: 'secondary' },
                  children: [{ $: 'acornTaskProgress({ taskList: outcome.taskList })' }],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  priorityList: {
    label: 'Priority list',
    description: "The project's top-priority outcomes, in the order AcornProjectMeta left them",
    node: {
      type: 'Column',
      props: { gap: '200', width: '100%' },
      children: [
        {
          type: '$each',
          props: {
            items: { $query: { entity: 'AcornProjectMeta', include: { topPriorityOutcomes: true } } },
            as: 'meta',
          },
          children: [
            {
              type: '$each',
              props: { items: { $: 'meta.topPriorityOutcomes' }, as: 'priority' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', p: '300', bg: 'surface', r: 'surface', width: '100%' },
                  children: [
                    { type: 'we-text', props: { tone: 'secondary' }, children: [{ $: 'index + 1' }] },
                    { type: 'we-text', props: { fontWeight: 'medium' }, children: [{ $: 'priority.content' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  projectDashboard: {
    label: 'Project dashboard',
    description: 'The mounted projects — one card per AcornProjectMeta, its member roster under S2-5',
    node: {
      type: 'Column',
      props: { gap: '300', width: '100%' },
      children: [
        {
          type: '$each',
          props: { items: { $query: { entity: 'AcornProjectMeta' } }, as: 'meta' },
          children: [
            {
              type: 'Column',
              props: { gap: '100', p: '300', bg: 'surface', r: 'surface' },
              children: [
                { type: 'we-text', props: { fontWeight: 'semibold' }, children: [{ $: 'meta.name' }] },
                {
                  type: 'we-text',
                  props: { fontSize: 'sm', tone: 'secondary' },
                  children: [{ $: '`Layering: ${meta.layeringAlgorithm}`' }],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  mapView: {
    label: 'Outcome map',
    description: 'The outcome tree as a zoomable map — a stub until the canvas lands in S2-8',
    node: {
      type: 'Column',
      props: { gap: '300', width: '100%' },
      children: [
        { type: 'we-text', props: { tone: 'secondary' }, children: ['The outcome-tree canvas lands in S2-8.'] },
        {
          type: '$each',
          props: { items: { $query: { entity: 'AcornOutcome', order: { timestampCreated: 'asc' } } }, as: 'outcome' },
          children: [{ type: 'we-text', props: { fontWeight: 'medium' }, children: [{ $: 'outcome.content' }] }],
        },
      ],
    },
  },
};
