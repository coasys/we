import type { ModulePart } from '@we/module-shared';

/**
 * The Acorn parts, named for what they are — the set the later stages fill in.
 *
 * `outcomeList` is the working list, and opens `expandedOutcome` over itself — one outcome read
 * and edited (S2-4). `outcomeCard` draws one record's fields; the other list parts query the
 * mounted classes directly. The map and dashboard are declarations
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
export const ACORN_PARTS: Record<string, ModulePart> = {
  outcomeList: {
    label: 'Outcome list',
    description:
      'Every outcome in the mounted project — each editable in place, with its status line, tag picker and delete',
    node: {
      type: 'Column',
      props: { gap: '300', width: '100%' },
      /*
        `openOutcome` is the id of the outcome drawn expanded, '' for none — local to the list,
        so opening one is a look, not a navigation, as Acorn's own expanded view is an overlay.
      */
      $localState: {
        newOutcome: { type: 'string', initial: '' },
        openOutcome: { type: 'string', initial: '' },
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
              },
            },
            {
              type: 'we-button',
              props: {
                variant: 'solid',
                disabled: { $: '!local.newOutcome' },
                onClick: {
                  $invoke: 'record.create',
                  args: ['AcornOutcome', { content: { $: 'local.newOutcome' } }],
                  onFinally: [{ $setLocal: 'newOutcome', value: '' }],
                },
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
                        onChange: {
                          $invoke: 'recordStore.updateRecordField',
                          args: ['AcornOutcome', { $: 'outcome.id' }, 'content', { $: 'event.detail' }],
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
                    {
                      type: 'we-button',
                      props: {
                        variant: 'soft',
                        size: 'sm',
                        onClick: { $setLocal: 'openOutcome', value: { $: 'outcome.id' } },
                      },
                      children: [{ $: '`Open ${outcome.content}`' }],
                    },
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
        /*
          The expanded outcome, over the list. Read by id rather than handed the row, so the
          dialog follows the record — a stock-side edit, or this dialog's own save, redraws it
          from the same subscription the list uses. Tags come included as AcornTag records,
          which the expanded part draws by name.
        */
        {
          type: '$if',
          props: {
            condition: { $: 'local.openOutcome' },
            then: {
              type: 'we-modal',
              props: { size: 'lg', close: { $setLocal: 'openOutcome', value: '' } },
              children: [
                {
                  type: '$single',
                  props: {
                    item: {
                      $query: {
                        entity: 'AcornOutcome',
                        where: { id: { $: 'local.openOutcome' } },
                        include: { tags: true },
                      },
                    },
                    as: 'outcome',
                  },
                  children: [{ type: '$part', props: { id: 'acorn.expandedOutcome' } }],
                },
              ],
            },
          },
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
    description:
      'One outcome, opened — title and description with an editor, scope and status set in place, its tags, tasks and time frame',
    subject: 'outcome',
    inputs: {
      outcome: { description: 'the AcornOutcome record shown expanded, its `tags` included as AcornTag records' },
    },
    node: {
      type: 'Column',
      props: { gap: '400', width: '100%' },
      /*
        The editor's drafts. Title and description are edited together and written once, on
        Save, as one `record.update` — one `update` call on the mount, so stock Acorn sees
        one revision rather than one per field. Cancel just drops the drafts.
      */
      $localState: {
        editing: { type: 'boolean', initial: false },
        draftContent: { type: 'string', initial: '' },
        draftDescription: { type: 'string', initial: '' },
        saveError: { type: 'string', initial: '' },
      },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: '!local.editing' },
            then: {
              type: 'Column',
              props: { gap: '300', width: '100%' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'start', width: '100%' },
                  children: [
                    {
                      type: 'we-text',
                      props: { variant: 'heading-sm', flex: '1 1 auto', minWidth: '0' },
                      children: [{ $: 'outcome.content' }],
                    },
                    {
                      type: 'we-button',
                      props: {
                        variant: 'soft',
                        size: 'sm',
                        onClick: [
                          { $setLocal: 'draftContent', value: { $: 'outcome.content' } },
                          { $setLocal: 'draftDescription', value: { $: "outcome.description ?? ''" } },
                          { $setLocal: 'saveError', value: '' },
                          { $setLocal: 'editing', value: true },
                        ],
                      },
                      children: ['Edit outcome'],
                    },
                  ],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'outcome.description' },
                    then: {
                      type: 'we-text',
                      props: { whiteSpace: 'pre-wrap' },
                      children: [{ $: 'outcome.description' }],
                    },
                    else: { type: 'we-text', props: { tone: 'secondary' }, children: ['No description'] },
                  },
                },
              ],
            },
            /*
              The editor. Writes through `record.update` — the generic record path every space
              surface has, which the model layer turns into the mount's `update` call on an
              Acorn space and into a plain row write on the in-memory backend. An empty
              description is a write of '', the same empty-clear S2-3 proved reaches stock.
            */
            else: {
              type: 'Column',
              props: { gap: '300', width: '100%' },
              children: [
                {
                  type: 'we-input',
                  props: {
                    width: '100%',
                    label: 'Title',
                    value: { $: 'local.draftContent' },
                    onInput: { $setLocal: 'draftContent', value: { $: 'event.detail' } },
                  },
                },
                {
                  type: 'we-textarea',
                  props: {
                    width: '100%',
                    label: 'Description',
                    rows: 5,
                    value: { $: 'local.draftDescription' },
                    onInput: { $setLocal: 'draftDescription', value: { $: 'event.detail' } },
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'local.saveError' },
                    then: { type: 'we-text', props: { color: 'danger-text' }, children: [{ $: 'local.saveError' }] },
                  },
                },
                {
                  type: 'Row',
                  props: { gap: '200', ax: 'end', width: '100%' },
                  children: [
                    {
                      type: 'we-button',
                      props: { variant: 'ghost', onClick: { $setLocal: 'editing', value: false } },
                      children: ['Cancel'],
                    },
                    {
                      type: 'we-button',
                      props: {
                        variant: 'solid',
                        // Acorn requires an outcome's content; an empty title is not a write.
                        disabled: { $: '!local.draftContent' },
                        onClick: {
                          $invoke: 'record.update',
                          args: [
                            'AcornOutcome',
                            { $: 'outcome.id' },
                            { $: '{ content: local.draftContent, description: local.draftDescription }' },
                          ],
                          onSuccess: [{ $setLocal: 'editing', value: false }],
                          onError: [{ $setLocal: 'saveError', value: { $: "'Could not save: ' + result.message" } }],
                        },
                      },
                      children: ['Save'],
                    },
                  ],
                },
              ],
            },
          },
        },
        /*
          Scope and status, set in place as Acorn's own right column does — each pick is its own
          single-field `record.update`. Status belongs to a Small outcome only: the mount folds
          `achievementStatus` into `scope.Small` and drops it for an Uncertain one (an Uncertain
          outcome's status is computed from its children, which is S2-5's roll-up), so the picker
          is offered only where the write means something.
        */
        {
          type: 'Row',
          props: { gap: '400', ay: 'end', wrap: true, width: '100%' },
          children: [
            {
              type: 'we-select',
              props: {
                label: 'This outcome is',
                size: 'sm',
                fit: true,
                value: { $: "outcome.scopeType ?? ''" },
                options: [
                  { value: 'Small', label: 'Small' },
                  { value: 'Uncertain', label: 'Uncertain' },
                ],
                onChange: {
                  $invoke: 'record.update',
                  args: ['AcornOutcome', { $: 'outcome.id' }, { $: '{ scopeType: event.detail }' }],
                },
              },
            },
            {
              type: '$if',
              props: {
                condition: { $: "outcome.scopeType == 'Small'" },
                then: {
                  type: 'we-select',
                  props: {
                    label: 'Status',
                    size: 'sm',
                    fit: true,
                    value: { $: "outcome.achievementStatus ?? 'NotAchieved'" },
                    options: [
                      { value: 'Achieved', label: 'Achieved' },
                      { value: 'NotAchieved', label: 'Not achieved' },
                    ],
                    onChange: {
                      $invoke: 'record.update',
                      args: ['AcornOutcome', { $: 'outcome.id' }, { $: '{ achievementStatus: event.detail }' }],
                    },
                  },
                },
              },
            },
          ],
        },
        // The rest of the record, read-only here: the tag picker, tasks and children are S2-5's.
        {
          type: 'we-text',
          props: { tone: 'secondary' },
          children: [{ $: 'acornOutcomeSummary({ outcome: outcome })' }],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'acornTimeFrameLabel({ timeFrame: outcome.timeFrame })' },
            then: {
              type: 'we-text',
              props: { tone: 'secondary' },
              children: [{ $: "'Time frame: ' + acornTimeFrameLabel({ timeFrame: outcome.timeFrame })" }],
            },
          },
        },
        {
          type: 'Row',
          props: { gap: '200', wrap: true, width: '100%' },
          children: [
            {
              type: '$each',
              props: { items: { $: 'outcome.tags' }, as: 'tag' },
              children: [{ type: 'we-tag', children: [{ $: 'tag.text' }] }],
            },
          ],
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
