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
/*
  A new child is two generic writes — the outcome, then the connection naming its parent — so the
  second can fail after the first landed. The outcome made is held (`orphan`, under
  `orphanParent`) with the draft until its connection lands; only then is the draft cleared.

  That hold is the dialog's local state, so it lasts only while this dialog is open: closing it
  drops the retry, and the outcome already made stays in the project unlinked, as an outcome of its
  own (a root in the list). Reopening offers no "Link again", and adding the same draft again makes
  a second outcome. The refusal therefore says to link again before closing. Recovering after a
  close is by hand: delete the unlinked outcome from the list, or connect it in Acorn. A retry that
  survives closing would need the pending link held somewhere durable, which this spike does not do.
*/
const CHILD_LINKED = [
  { $setLocal: 'newChild', value: '' },
  { $setLocal: 'orphan', value: '' },
  { $setLocal: 'orphanParent', value: '' },
  { $setLocal: 'childBusy', value: false },
];
const CHILD_LINK = {
  $invoke: 'record.create',
  args: [
    'AcornConnection',
    {
      $: '{ parent: local.orphanParent, child: local.orphan, siblingOrder: count(acornChildren({ outcome: local.orphanParent, outcomes: local.outcomes, connections: local.connections })) }',
    },
  ],
  onSuccess: CHILD_LINKED,
  onError: [
    { $setLocal: 'childBusy', value: false },
    {
      $setLocal: 'writeError',
      value: {
        $: "'Could not link the child: ' + result.message + ' — link it again before closing; once closed, it stays an outcome of its own.'",
      },
    },
  ],
};

/*
  The task list is one JSON field, so every edit is a whole-list replace — and an edit made before
  the last one has read back would start from the list that one replaced, undoing it. So each edit
  starts from the working list (`acornWorking`: the last list this view wrote, while the subscription
  still holds one it replaced on the way) and only one write per view is in flight (`taskBusy`
  disables the task controls), so the writes land in the order they were made. Once the write reads
  back — or somebody else's list arrives — the history is settled and the subscription is the truth
  again, so a later change elsewhere back to an earlier list is drawn and edited from; the next edit
  starts a new history (`acornWritten`). A refused write drops the working list, and the
  subscription's list is drawn and edited again.
*/
const TASK_HISTORY = 'local.taskFor == outcome.id ? local.taskWritten : []';
const TASKS = `acornWorking({ stored: outcome.taskList, working: local.taskWork, written: ${TASK_HISTORY} })`;
const taskEdit = (next: string, onSuccess: unknown[] = []) => [
  { $setLocal: 'taskWork', value: { $: next } },
  {
    $setLocal: 'taskWritten',
    value: { $: `acornWritten({ stored: outcome.taskList, working: local.taskWork, written: ${TASK_HISTORY} })` },
  },
  { $setLocal: 'taskFor', value: { $: 'outcome.id' } },
  { $setLocal: 'taskBusy', value: true },
  { $setLocal: 'writeError', value: '' },
  {
    $invoke: 'record.update',
    args: ['AcornOutcome', { $: 'outcome.id' }, { $: '{ taskList: local.taskWork }' }],
    onSuccess,
    onError: [
      { $setLocal: 'writeError', value: { $: "'Could not save: ' + result.message" } },
      { $setLocal: 'taskFor', value: '' },
      { $setLocal: 'taskWritten', value: [] },
    ],
    onFinally: [{ $setLocal: 'taskBusy', value: false }],
  },
];

/*
  The priority order is one field on the project meta, replaced whole by every add, remove and
  reorder — the same hazard as the task list, on the same path: each edit starts from the working
  list (the last this view wrote, while its write is unsettled), and one write per project is in
  flight (`prioBusy`). The state sits on the meta's own row, so it is per project.
*/
const PRIO = 'acornWorking({ stored: meta.topPriorityOutcomes, working: local.prioWork, written: local.prioWritten })';
const prioEdit = (next: string) => [
  { $setLocal: 'prioWork', value: { $: next } },
  {
    $setLocal: 'prioWritten',
    value: {
      $: 'acornWritten({ stored: meta.topPriorityOutcomes, working: local.prioWork, written: local.prioWritten })',
    },
  },
  { $setLocal: 'prioBusy', value: true },
  {
    $invoke: 'record.update',
    args: ['AcornProjectMeta', { $: 'meta.id' }, { $: '{ topPriorityOutcomes: local.prioWork }' }],
    onError: [{ $setLocal: 'prioWritten', value: [] }],
    onFinally: [{ $setLocal: 'prioBusy', value: false }],
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
      'One outcome, opened — title and description with an editor, scope and status set in place, its tags, its child outcomes (each opened in the same view) or its task list, the roll-up from its children, and its comments',
    subject: 'outcome',
    inputs: {
      outcome: {
        description:
          'the AcornOutcome record opened; the part reads it again by id, with its tags, and opens its children in its place',
      },
    },
    node: {
      type: 'Column',
      props: { gap: '400', width: '100%' },
      /*
        `focus` is the child opened in this view, '' for the outcome placed — so opening a child
        is a look inside the same dialog, as in Acorn's expanded view, and asks nothing of the
        placer. The project-wide reads are hoisted once here: the tree (outcomes + connections)
        the children and the roll-up are joined from, and the comments with the profiles their
        authors are named from. Comments are read whole and filtered per outcome, so the
        relation compare is the same client-side one on both hosts.
      */
      $localState: {
        focus: { type: 'string', initial: '' },
        orphan: { type: 'string', initial: '' },
        orphanParent: { type: 'string', initial: '' },
        childBusy: { type: 'boolean', initial: false },
        taskWork: { type: 'string', initial: '' },
        taskFor: { type: 'string', initial: '' },
        taskWritten: { type: 'array', initial: [] },
        taskBusy: { type: 'boolean', initial: false },
      },
      $queries: {
        outcomes: { entity: 'AcornOutcome', order: { timestampCreated: 'asc' } },
        connections: { entity: 'AcornConnection' },
        comments: { entity: 'AcornOutcomeComment', order: { unixTimestamp: 'asc' } },
        profiles: { entity: 'AcornProfile' },
      },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: 'local.focus' },
            then: {
              type: 'Row',
              children: [
                {
                  type: 'we-button',
                  props: { variant: 'ghost', size: 'sm', onClick: { $setLocal: 'focus', value: '' } },
                  children: [{ $: '`Back to ${outcome.content}`' }],
                },
              ],
            },
          },
        },
        {
          type: '$single',
          props: {
            item: {
              $query: {
                entity: 'AcornOutcome',
                where: { id: { $: 'local.focus ? local.focus : outcome.id' } },
                include: { tags: true },
              },
            },
            as: 'outcome',
          },
          children: [
            {
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
                newChild: { type: 'string', initial: '' },
                newTask: { type: 'string', initial: '' },
                addedTask: { type: 'string', initial: '' },
                newComment: { type: 'string', initial: '' },
                writeError: { type: 'string', initial: '' },
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
                            then: {
                              type: 'we-text',
                              props: { color: 'danger-text' },
                              children: [{ $: 'local.saveError' }],
                            },
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
                                  onError: [
                                    { $setLocal: 'saveError', value: { $: "'Could not save: ' + result.message" } },
                                  ],
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
                  outcome's status is computed from its children — the roll-up below), so the picker
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
                // The rest of the record, read-only here: the tag picker is a later step's.
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
                /*
                  The roll-up: Acorn computes an outcome's scope and status from its descendants
                  (`computedState.ts`), and shows it wherever the outcome has children. Derived, never written.
                */
                {
                  type: '$if',
                  props: {
                    condition: {
                      $: 'count(acornChildren({ outcome: outcome.id, outcomes: local.outcomes, connections: local.connections })) > 0',
                    },
                    then: {
                      type: 'we-text',
                      props: { tone: 'secondary' },
                      children: [
                        {
                          $: "'From its children: ' + acornRollup({ outcome: outcome, outcomes: local.outcomes, connections: local.connections }).scope + ' · ' + acornRollupLabel({ rollup: acornRollup({ outcome: outcome, outcomes: local.outcomes, connections: local.connections }) })",
                        },
                      ],
                    },
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'local.writeError' },
                    then: { type: 'we-text', props: { color: 'danger-text' }, children: [{ $: 'local.writeError' }] },
                  },
                },
                /*
                  Children or tasks — one or the other, as in Acorn: a Small outcome has a task list, any other
                  has child outcomes.
                */
                {
                  type: '$if',
                  props: {
                    condition: { $: "outcome.scopeType == 'Small'" },
                    /*
                      The task list is one JSON field on the record, so every change — add, tick, remove — is a
                      whole-field `record.update` of the list the module's functions compute (an expression
                      cannot serialise). On the mount that is the `update` call stock's own checklist makes.
                    */
                    then: {
                      type: 'Column',
                      props: { gap: '200', width: '100%' },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'label' },
                          children: [
                            {
                              $: `'Tasks' + (acornTaskProgress({ taskList: ${TASKS} }) ? ' ' + acornTaskProgress({ taskList: ${TASKS} }) : '')`,
                            },
                          ],
                        },
                        {
                          type: '$each',
                          props: { items: { $: `acornTasks({ taskList: ${TASKS} })` }, as: 'task' },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center', width: '100%' },
                              children: [
                                {
                                  type: 'we-checkbox',
                                  props: {
                                    flex: '1 1 auto',
                                    checked: { $: 'task.complete' },
                                    disabled: { $: 'local.taskBusy' },
                                    label: { $: 'task.task' },
                                    onChange: taskEdit(`acornTasksToggled({ taskList: ${TASKS}, index: index })`),
                                  },
                                  children: [{ $: 'task.task' }],
                                },
                                {
                                  type: 'we-button',
                                  props: {
                                    variant: 'ghost',
                                    size: 'sm',
                                    disabled: { $: 'local.taskBusy' },
                                    label: { $: '`Remove task ${task.task}`' },
                                    onClick: taskEdit(`acornTasksRemoved({ taskList: ${TASKS}, index: index })`),
                                  },
                                  children: [{ type: 'we-icon', props: { name: 'x' } }],
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: 'Row',
                          props: { gap: '200', width: '100%' },
                          children: [
                            {
                              type: 'we-input',
                              props: {
                                flex: '1',
                                label: 'New task',
                                placeholder: 'New task…',
                                value: { $: 'local.newTask' },
                                onInput: { $setLocal: 'newTask', value: { $: 'event.detail' } },
                              },
                            },
                            {
                              type: 'we-button',
                              props: {
                                variant: 'soft',
                                disabled: { $: '!trim(local.newTask) || local.taskBusy' },
                                /*
                                  The field stays open while the add is in flight, so the next task
                                  can be typed; the draft is cleared on success only if it is still
                                  the one that was added.
                                */
                                onClick: [
                                  { $setLocal: 'addedTask', value: { $: 'local.newTask' } },
                                  ...taskEdit(`acornTasksAdded({ taskList: ${TASKS}, task: local.addedTask })`, [
                                    {
                                      $if: {
                                        condition: { $: 'local.newTask == local.addedTask' },
                                        then: { $setLocal: 'newTask', value: '' },
                                      },
                                    },
                                  ]),
                                ],
                              },
                              children: ['Add task'],
                            },
                          ],
                        },
                      ],
                    },
                    /*
                      The children, each opened in this same view. A new child is what Acorn's own "add child"
                      makes — an Uncertain outcome, and the connection naming this one its parent — written as
                      the two generic creates the mount maps to `create_outcome` and `create_connection`.
                    */
                    else: {
                      type: 'Column',
                      props: { gap: '200', width: '100%' },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'label' },
                          children: [
                            {
                              $: "'Children ' + count(acornChildren({ outcome: outcome.id, outcomes: local.outcomes, connections: local.connections }))",
                            },
                          ],
                        },
                        {
                          type: '$each',
                          props: {
                            items: {
                              $: 'acornChildren({ outcome: outcome.id, outcomes: local.outcomes, connections: local.connections })',
                            },
                            as: 'child',
                          },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '300', ay: 'center', p: '200', bg: 'surface', r: 'surface', width: '100%' },
                              children: [
                                {
                                  type: 'Column',
                                  props: { gap: '100', flex: '1 1 auto', minWidth: '0' },
                                  children: [
                                    {
                                      type: 'we-text',
                                      props: { fontWeight: 'medium' },
                                      children: [{ $: 'child.content' }],
                                    },
                                    {
                                      type: 'we-text',
                                      props: { fontSize: 'sm', tone: 'secondary' },
                                      children: [{ $: 'acornOutcomeSummary({ outcome: child })' }],
                                    },
                                  ],
                                },
                                {
                                  type: 'we-button',
                                  props: {
                                    variant: 'soft',
                                    size: 'sm',
                                    onClick: [
                                      { $setLocal: 'editing', value: false },
                                      { $setLocal: 'writeError', value: '' },
                                      { $setLocal: 'focus', value: { $: 'child.id' } },
                                    ],
                                  },
                                  children: [{ $: '`Open child ${child.content}`' }],
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: 'Row',
                          props: { gap: '200', width: '100%' },
                          children: [
                            {
                              type: 'we-input',
                              props: {
                                flex: '1',
                                label: 'New child outcome',
                                placeholder: 'New child outcome…',
                                value: { $: 'local.newChild' },
                                onInput: { $setLocal: 'newChild', value: { $: 'event.detail' } },
                              },
                            },
                            {
                              type: 'we-button',
                              props: {
                                variant: 'soft',
                                disabled: { $: "!trim(local.newChild) || local.childBusy || local.orphan != ''" },
                                onClick: [
                                  { $setLocal: 'childBusy', value: true },
                                  { $setLocal: 'writeError', value: '' },
                                  {
                                    $invoke: 'record.create',
                                    args: [
                                      'AcornOutcome',
                                      { $: "{ content: trim(local.newChild), scopeType: 'Uncertain' }" },
                                    ],
                                    onSuccess: [
                                      { $setLocal: 'orphan', value: { $: 'result.id' } },
                                      { $setLocal: 'orphanParent', value: { $: 'outcome.id' } },
                                      CHILD_LINK,
                                    ],
                                    onError: [
                                      { $setLocal: 'childBusy', value: false },
                                      { $setLocal: 'writeError', value: { $: "'Could not save: ' + result.message" } },
                                    ],
                                  },
                                ],
                              },
                              children: ['Add child outcome'],
                            },
                          ],
                        },
                        /*
                          A child made but not linked — its connection was refused — is offered its
                          link again, for the outcome already made, rather than a second outcome. A
                          link that did land after all (the refusal was the reply, not the write) is
                          seen in the connections and only cleared.
                        */
                        {
                          type: '$if',
                          props: {
                            condition: { $: 'local.orphan' },
                            then: {
                              type: 'we-button',
                              props: {
                                variant: 'soft',
                                disabled: { $: 'local.childBusy' },
                                onClick: [
                                  { $setLocal: 'writeError', value: '' },
                                  {
                                    $if: {
                                      condition: {
                                        $: 'acornChildren({ outcome: local.orphanParent, outcomes: local.outcomes, connections: local.connections }).exists(c, c.id == local.orphan)',
                                      },
                                      then: CHILD_LINKED,
                                      else: [{ $setLocal: 'childBusy', value: true }, CHILD_LINK],
                                    },
                                  },
                                ],
                              },
                              children: ['Link again'],
                            },
                          },
                        },
                      ],
                    },
                  },
                },
                /*
                  Comments, oldest first, each by its author's profile name where the project has one — the
                  comment's `creator` and the profile's `agent` are the same DID on the mount — and by the DID's
                  short form where it has none. A new comment is one `record.create`; the mount stamps its author
                  and time.
                */
                {
                  type: 'Column',
                  props: { gap: '200', width: '100%' },
                  children: [
                    {
                      type: 'we-text',
                      props: { variant: 'label' },
                      children: [{ $: "'Comments ' + count(local.comments.filter(c, c.outcome == outcome.id))" }],
                    },
                    {
                      type: '$each',
                      props: { items: { $: 'local.comments.filter(c, c.outcome == outcome.id)' }, as: 'comment' },
                      children: [
                        {
                          type: 'Column',
                          props: { gap: '100', p: '200', bg: 'surface', r: 'surface', width: '100%' },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                {
                                  type: 'we-text',
                                  props: { fontWeight: 'medium' },
                                  children: [{ $: 'acornAuthor({ did: comment.creator, profiles: local.profiles })' }],
                                },
                                {
                                  type: 'we-text',
                                  props: { fontSize: 'sm', tone: 'secondary' },
                                  children: [{ $: 'acornWhen({ timestamp: comment.unixTimestamp })' }],
                                },
                              ],
                            },
                            {
                              type: 'we-text',
                              props: { whiteSpace: 'pre-wrap' },
                              children: [{ $: 'comment.content' }],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: 'we-textarea',
                      props: {
                        width: '100%',
                        label: 'Comment',
                        placeholder: 'Write a comment…',
                        rows: 2,
                        value: { $: 'local.newComment' },
                        onInput: { $setLocal: 'newComment', value: { $: 'event.detail' } },
                      },
                    },
                    {
                      type: 'Row',
                      props: { ax: 'end', width: '100%' },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            variant: 'soft',
                            disabled: { $: '!trim(local.newComment)' },
                            onClick: {
                              $invoke: 'record.create',
                              args: [
                                'AcornOutcomeComment',
                                { $: '{ outcome: outcome.id, content: trim(local.newComment) }' },
                              ],
                              onSuccess: [{ $setLocal: 'newComment', value: '' }],
                              onError: [
                                { $setLocal: 'writeError', value: { $: "'Could not save: ' + result.message" } },
                              ],
                            },
                          },
                          children: ['Add comment'],
                        },
                      ],
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
  outcomeTable: {
    label: 'Outcome table',
    description:
      "Every outcome as a row of Acorn's table — ID number, the statement in its tree, scope, status, progress and tags — with Acorn's filters, each row opening the expanded outcome",
    node: {
      type: 'Column',
      props: { gap: '300', width: '100%' },
      /*
        The filters are Acorn's table filters (`OutcomeTableFilterSelector`): keyword or ID
        number, only high priority, achievement status, scope and tags, each list an OR and all
        of them ANDed. Assignees are left out until S2-4's member-mapping question is decided.
        `collapsed` holds the rows folded shut; everything starts open. The rows themselves are
        `acornTableRows`, so the tree walk and the computed status are the same code the
        expanded outcome's roll-up runs.
      */
      $localState: {
        keyword: { type: 'string', initial: '' },
        highPriority: { type: 'boolean', initial: false },
        statuses: { type: 'array', initial: [] },
        scopes: { type: 'array', initial: [] },
        tagFilter: { type: 'array', initial: [] },
        collapsed: { type: 'array', initial: [] },
        openOutcome: { type: 'string', initial: '' },
      },
      $queries: {
        outcomes: { entity: 'AcornOutcome', order: { timestampCreated: 'asc' } },
        connections: { entity: 'AcornConnection' },
        tags: { entity: 'AcornTag', order: { text: 'asc' } },
        meta: { entity: 'AcornProjectMeta' },
      },
      children: [
        {
          type: 'we-input',
          props: {
            width: '100%',
            label: 'Filter by keyword or ID number',
            placeholder: 'Filter by keyword or ID number',
            value: { $: 'local.keyword' },
            onInput: { $setLocal: 'keyword', value: { $: 'event.detail' } },
          },
        },
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true, width: '100%' },
          children: [
            {
              type: 'we-checkbox',
              props: {
                size: 'sm',
                label: 'Only high priority',
                checked: { $: 'local.highPriority' },
                onChange: { $toggleLocal: 'highPriority' },
              },
              children: ['Only high priority'],
            },
            { type: 'we-text', props: { variant: 'label', ml: '200' }, children: ['Status'] },
            {
              type: '$each',
              props: {
                items: {
                  $: "[{ value: 'Achieved', label: 'Achieved' }, { value: 'PartiallyAchieved', label: 'Partially achieved' }, { value: 'NotAchieved', label: 'Not achieved' }]",
                },
                as: 'choice',
              },
              children: [
                {
                  type: 'we-checkbox',
                  props: {
                    size: 'sm',
                    label: { $: 'choice.label' },
                    checked: { $: 'choice.value in local.statuses' },
                    onChange: { $toggleLocalIn: 'statuses', value: { $: 'choice.value' } },
                  },
                  children: [{ $: 'choice.label' }],
                },
              ],
            },
            { type: 'we-text', props: { variant: 'label', ml: '200' }, children: ['Scope'] },
            {
              type: '$each',
              props: {
                items: {
                  $: "[{ value: 'Small', label: 'Small' }, { value: 'Uncertain', label: 'Uncertain' }, { value: 'Big', label: 'Other' }]",
                },
                as: 'choice',
              },
              children: [
                {
                  type: 'we-checkbox',
                  props: {
                    size: 'sm',
                    label: { $: 'choice.label' },
                    checked: { $: 'choice.value in local.scopes' },
                    onChange: { $toggleLocalIn: 'scopes', value: { $: 'choice.value' } },
                  },
                  children: [{ $: 'choice.label' }],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $: 'count(local.tags) > 0' },
                then: { type: 'we-text', props: { variant: 'label', ml: '200' }, children: ['Tags'] },
              },
            },
            {
              type: '$each',
              props: { items: { $: 'local.tags' }, as: 'tag' },
              children: [
                {
                  type: 'we-checkbox',
                  props: {
                    size: 'sm',
                    label: { $: 'tag.text' },
                    checked: { $: 'tag.id in local.tagFilter' },
                    onChange: { $toggleLocalIn: 'tagFilter', value: { $: 'tag.id' } },
                  },
                  children: [{ $: 'tag.text' }],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: {
                  $: "trim(local.keyword) != '' || local.highPriority || count(local.statuses) > 0 || count(local.scopes) > 0 || count(local.tagFilter) > 0",
                },
                then: {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: 'ghost',
                    onClick: [
                      { $setLocal: 'keyword', value: '' },
                      { $setLocal: 'highPriority', value: false },
                      { $setLocal: 'statuses', value: [] },
                      { $setLocal: 'scopes', value: [] },
                      { $setLocal: 'tagFilter', value: [] },
                    ],
                  },
                  children: ['Clear filters'],
                },
              },
            },
          ],
        },
        /*
          The table, as assistive technology reads it: a table of rows, a header row of column
          headers and a cell per column — the layout stays the Rows' own.
        */
        {
          type: 'Column',
          props: { width: '100%', role: 'table', 'aria-label': 'Outcomes' },
          children: [
            {
              type: 'Row',
              props: { role: 'row', gap: '400', p: '300', borderBottom: '1px solid border', width: '100%' },
              children: [
                {
                  type: 'div',
                  props: { role: 'columnheader', style: { flex: '0 0 auto', width: '4.5rem' } },
                  children: [{ type: 'we-text', props: { fontWeight: 'semibold' }, children: ['ID#'] }],
                },
                {
                  type: 'div',
                  props: { role: 'columnheader', style: { flex: '4 1 0' } },
                  children: [{ type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Outcome'] }],
                },
                {
                  type: 'div',
                  props: { role: 'columnheader', style: { flex: '1 1 0' } },
                  children: [{ type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Scope'] }],
                },
                {
                  type: 'div',
                  props: { role: 'columnheader', style: { flex: '1.4 1 0' } },
                  children: [{ type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Status'] }],
                },
                {
                  type: 'div',
                  props: { role: 'columnheader', style: { flex: '1 1 0' } },
                  children: [{ type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Progress'] }],
                },
                {
                  type: 'div',
                  props: { role: 'columnheader', style: { flex: '2 1 0' } },
                  children: [{ type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Tags'] }],
                },
              ],
            },
            {
              type: '$each',
              props: {
                items: {
                  $: 'acornTableRows({ outcomes: local.outcomes, connections: local.connections, tags: local.tags, priorities: first(local.meta).topPriorityOutcomes, collapsed: local.collapsed, filter: { keyword: local.keyword, highPriority: local.highPriority, statuses: local.statuses, scopes: local.scopes, tags: local.tagFilter } })',
                },
                as: 'row',
              },
              children: [
                {
                  type: 'Row',
                  props: {
                    role: 'row',
                    gap: '400',
                    px: '300',
                    py: '200',
                    borderBottom: '1px solid border',
                    width: '100%',
                    ay: 'center',
                  },
                  children: [
                    {
                      type: 'div',
                      props: { role: 'cell', style: { width: '4.5rem', flex: '0 0 auto' } },
                      children: [{ type: 'we-text', props: { tone: 'secondary' }, children: [{ $: 'row.number' }] }],
                    },
                    {
                      type: 'Row',
                      props: { role: 'cell', gap: '100', ay: 'center', flex: '4 1 0', minWidth: '0' },
                      children: [
                        // The tree's indent: a level per depth, as Acorn's table draws it.
                        {
                          type: 'div',
                          props: { style: { $: "{ width: (row.depth * 1.5) + 'rem', flexShrink: '0' }" } },
                        },
                        {
                          type: '$if',
                          props: {
                            condition: { $: 'row.children > 0' },
                            then: {
                              type: 'we-button',
                              props: {
                                variant: 'bare',
                                size: 'xs',
                                label: { $: "(row.open ? 'Collapse ' : 'Expand ') + row.outcome.content" },
                                expanded: { $: 'row.open' },
                                onClick: { $toggleLocalIn: 'collapsed', value: { $: 'row.id' } },
                              },
                              children: [
                                { type: 'we-icon', props: { name: { $: "row.open ? 'caret-down' : 'caret-right'" } } },
                              ],
                            },
                            else: { type: 'div', props: { style: { width: '1.25rem', flexShrink: '0' } } },
                          },
                        },
                        {
                          type: 'we-button',
                          props: {
                            variant: 'bare',
                            label: { $: '`Open ${row.outcome.content}`' },
                            onClick: { $setLocal: 'openOutcome', value: { $: 'row.id' } },
                          },
                          children: [{ $: 'row.outcome.content' }],
                        },
                        {
                          type: '$if',
                          props: {
                            condition: { $: 'row.priority' },
                            then: {
                              type: 'we-icon',
                              props: { name: 'medal', color: 'warning', label: 'High priority' },
                            },
                          },
                        },
                      ],
                    },
                    {
                      type: 'div',
                      props: { role: 'cell', style: { flex: '1 1 0' } },
                      children: [{ type: 'we-text', props: { tone: 'secondary' }, children: [{ $: 'row.scope' }] }],
                    },
                    {
                      type: 'div',
                      props: { role: 'cell', style: { flex: '1.4 1 0' } },
                      children: [
                        {
                          type: 'we-text',
                          props: { tone: 'secondary' },
                          children: [
                            {
                              $: "row.status == 'PartiallyAchieved' ? 'Partially achieved' : row.status == 'NotAchieved' ? 'Not achieved' : 'Achieved'",
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: 'div',
                      props: { role: 'cell', style: { flex: '1 1 0' } },
                      children: [{ type: 'we-text', props: { tone: 'secondary' }, children: [{ $: 'row.progress' }] }],
                    },
                    {
                      type: 'Row',
                      props: { role: 'cell', gap: '100', wrap: true, flex: '2 1 0', minWidth: '0' },
                      children: [
                        {
                          type: '$each',
                          props: { items: { $: 'row.tags' }, as: 'tag' },
                          children: [{ type: 'we-tag', children: [{ $: 'tag.text' }] }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: {
              $: 'local.outcomesLoaded && count(acornTableRows({ outcomes: local.outcomes, connections: local.connections, tags: local.tags, priorities: first(local.meta).topPriorityOutcomes, collapsed: local.collapsed, filter: { keyword: local.keyword, highPriority: local.highPriority, statuses: local.statuses, scopes: local.scopes, tags: local.tagFilter } })) == 0',
            },
            then: { type: 'we-text', props: { tone: 'secondary', p: '300' }, children: ['No outcome matches.'] },
          },
        },
        // A row opens the expanded outcome over the table, as the outcome list does.
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
                    item: { $query: { entity: 'AcornOutcome', where: { id: { $: 'local.openOutcome' } } } },
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
  priorityList: {
    label: 'Priority list',
    description:
      "The project's top-priority outcomes, in the order AcornProjectMeta keeps them — reorderable, with outcomes to add and remove",
    node: {
      type: 'Column',
      props: { gap: '400', width: '100%' },
      /*
        One subscription for every outcome, joined to the meta's id list below rather than
        hydrated through `include`. The list's order is the record — the whole point of the
        field — and the stored id list is what carries it; an included relation is drawn in
        whatever order the backend hydrates (the in-memory one reads its table order).
      */
      $queries: { outcomes: { entity: 'AcornOutcome', order: { timestampCreated: 'asc' } } },
      children: [
        {
          type: '$each',
          props: { items: { $query: { entity: 'AcornProjectMeta' } }, as: 'meta' },
          children: [
            {
              type: 'Column',
              props: { gap: '400', width: '100%' },
              $localState: {
                prioWork: { type: 'array', initial: [] },
                prioWritten: { type: 'array', initial: [] },
                prioBusy: { type: 'boolean', initial: false },
              },
              children: [
                /*
                  The order is one field on the project meta, and every change to it — a drag, an
                  add, a remove — is a whole-list replace through `record.update`: the mount
                  declares no adder or remover, so its `update` call takes the new list entire
                  (design §2). `we-sortable` reports only the ids it draws, and a stored id whose
                  outcome has not arrived (or is gone) is not drawn — so the drop is merged back
                  into the stored list by `acornPriorityOrder`, which moves the drawn ids among
                  their own places and leaves the rest where they were. A reorder is never a
                  remove. The expression language cannot say this itself: it has no index in a
                  comprehension to refill the drawn places with.
                  The drawn list is `distinct` first: two carriers sharing a `data-we-id` would
                  give the sortable one item under two rows.
                */
                {
                  type: '$if',
                  props: {
                    condition: { $: `count(${PRIO})` },
                    then: {
                      type: 'we-sortable',
                      props: {
                        gap: '200',
                        locked: { $: 'local.prioBusy' },
                        onReorder: prioEdit(`acornPriorityOrder({ stored: ${PRIO}, visible: event.detail })`),
                      },
                      children: [
                        {
                          type: '$each',
                          props: {
                            items: {
                              $: `distinct(${PRIO}).map(i, local.outcomes.find(o, o.id == i)).filter(o, o)`,
                            },
                            as: 'priority',
                          },
                          children: [
                            {
                              // A native carrier: `we-sortable` reads `data-we-id` off the DOM.
                              type: 'div',
                              props: { 'data-we-id': { $: 'priority.id' }, style: { width: '100%' } },
                              children: [
                                {
                                  type: 'Row',
                                  props: {
                                    gap: '300',
                                    ay: 'center',
                                    p: '300',
                                    bg: 'surface',
                                    r: 'surface',
                                    width: '100%',
                                  },
                                  children: [
                                    {
                                      // The grip — only a press here drags, and Space on it picks the row up.
                                      type: 'div',
                                      props: { 'data-we-handle': '', style: { display: 'flex' } },
                                      children: [
                                        {
                                          type: 'we-button',
                                          props: {
                                            label: { $: '`Reorder ${priority.content}`' },
                                            variant: 'bare',
                                            cursor: 'grab',
                                            activeProps: { cursor: 'grabbing' },
                                          },
                                          children: [
                                            {
                                              type: 'we-icon',
                                              props: { name: 'dots-six-vertical', color: 'text-faint' },
                                            },
                                          ],
                                        },
                                      ],
                                    },
                                    { type: 'we-text', props: { color: 'text-faint' }, children: [{ $: 'index + 1' }] },
                                    {
                                      type: 'we-text',
                                      props: { fontWeight: 'medium', flex: '1 1 auto', minWidth: '0' },
                                      children: [{ $: 'priority.content' }],
                                    },
                                    {
                                      type: 'we-button',
                                      props: {
                                        variant: 'ghost',
                                        size: 'sm',
                                        disabled: { $: 'local.prioBusy' },
                                        onClick: prioEdit(`${PRIO}.filter(i, i != priority.id)`),
                                      },
                                      children: [{ $: '`Remove ${priority.content} from priority`' }],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    else: {
                      type: 'we-text',
                      props: { color: 'text-faint' },
                      children: ['Nothing is a priority yet — add outcomes from the list below.'],
                    },
                  },
                },
                // Every outcome not on the list, to add at its end.
                {
                  type: 'Column',
                  props: { gap: '200', width: '100%' },
                  children: [
                    { type: 'we-text', props: { variant: 'label' }, children: ['Other outcomes'] },
                    {
                      type: '$each',
                      props: { items: { $: 'local.outcomes' }, as: 'outcome' },
                      children: [
                        {
                          type: '$if',
                          props: {
                            condition: { $: `!(outcome.id in ${PRIO})` },
                            then: {
                              type: 'Row',
                              props: { gap: '300', ay: 'center', px: '300', py: '200', width: '100%' },
                              children: [
                                {
                                  type: 'we-text',
                                  props: { flex: '1 1 auto', minWidth: '0' },
                                  children: [{ $: 'outcome.content' }],
                                },
                                {
                                  type: 'we-button',
                                  props: {
                                    variant: 'soft',
                                    size: 'sm',
                                    disabled: { $: 'local.prioBusy' },
                                    onClick: prioEdit(`distinct(${PRIO}, [outcome.id])`),
                                  },
                                  children: [{ $: '`Prioritise ${outcome.content}`' }],
                                },
                              ],
                            },
                          },
                        },
                      ],
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
