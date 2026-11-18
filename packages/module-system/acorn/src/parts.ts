import type { ModulePart } from '@we/module-shared';

const closeProjects = { $invoke: 'shellStore.setAcornProjectsOpen', args: [false] };

/**
 * One lifecycle call's wiring: the busy flag around it, the modal closed when it lands,
 * the rejection turned into words where the dialog can read them — `local.error` is the
 * answer `JoinSpaceModal` gives for the same situation, an `$invoke` failure being the
 * only kind a schema can see.
 */
const lifecycleCall = (invoke: Record<string, unknown>): unknown[] => [
  { $setLocal: 'busy', value: true },
  { $setLocal: 'error', value: '' },
  {
    ...invoke,
    onSuccess: [closeProjects],
    onError: [{ $setLocal: 'error', value: { $: "result && result.message ? result.message : 'That did not work'" } }],
    onFinally: [{ $setLocal: 'busy', value: false }],
  },
];

/**
 * The Acorn parts, named for what they are — the set the later stages fill in.
 *
 * v0 stubs are honest stubs: `outcomeCard` and `expandedOutcome` draw one record's fields;
 * the list parts query the mounted classes directly. The map and dashboard are declarations
 * of intent — they exist so the module's surface is named in one place, not to pretend the
 * canvas landed early.
 *
 * `projectsModal` is the exception in kind, not in discipline: the project lifecycle chrome,
 * drawn from the host's overlay slot and gated on the shell flag that opens it. It is a
 * schema like the rest — every act in it is a `spaceStore.*AcornProject*` member, the
 * module itself still imports nothing backend-shaped and owns no store. Where it cannot
 * reach — a backend that cannot mount — `spaceStore.acornAvailable` keeps its door shut.
 *
 * Everything else here reads `Acorn*` records through `$query` or declares its row as an
 * `input` — never a module store, which this module does not have.
 */
export const ACORN_PARTS: Record<string, ModulePart> = {
  projectsModal: {
    label: 'Acorn projects',
    description: 'Your mounted Acorn projects — open one, start one, or join one by passphrase',
    node: {
      // Mounted only while the flag says so — which also resets the drafts between uses.
      type: '$if',
      props: {
        condition: { $: 'shellStore.acornProjectsOpen' },
        then: {
          type: 'we-modal',
          props: { size: 'md', close: closeProjects },
          $localState: {
            newName: { type: 'string', initial: '' },
            newPassphrase: { type: 'string', initial: '' },
            joinPassphrase: { type: 'string', initial: '' },
            joinAddress: { type: 'string', initial: '' },
            busy: { type: 'boolean', initial: false },
            error: { type: 'string', initial: '' },
          },
          children: [
            { type: 'we-text', props: { variant: 'heading-md' }, slot: 'header', children: ['Acorn projects'] },

            /*
              What the executor already has mounted — each row lands on its project through
              the same open sequence a create ends in.
            */
            {
              type: '$if',
              props: {
                condition: { $: 'count(spaceStore.acornProjects) > 0' },
                then: {
                  type: 'Column',
                  props: { gap: '200', width: '100%' },
                  children: [
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-muted' },
                      children: ['Your projects'],
                    },
                    {
                      type: '$each',
                      props: { items: { $: 'spaceStore.acornProjects' }, as: 'project' },
                      children: [
                        {
                          type: 'Row',
                          props: { gap: '300', ay: 'center', width: '100%' },
                          children: [
                            {
                              type: 'we-text',
                              props: { flex: '1', fontWeight: 'medium' },
                              children: [{ $: 'project.name' }],
                            },
                            {
                              type: 'we-button',
                              props: {
                                variant: 'soft',
                                disabled: { $: 'local.busy' },
                                onClick: lifecycleCall({
                                  $invoke: 'spaceStore.openAcornProject',
                                  args: [{ $: 'project.datasetId' }],
                                }),
                              },
                              children: ['Open'],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },

            { type: 'we-divider', props: { width: '100%' } },

            /*
              Start one: the passphrase is the join secret, not decoration — the language
              derives the project from it, so it is the thing somebody else joins with.
            */
            { type: 'we-text', props: { variant: 'body', fontWeight: 'medium' }, children: ['New project'] },
            {
              type: 'we-form-field',
              props: { label: 'Project name' },
              children: [
                {
                  type: 'we-input',
                  props: {
                    width: '100%',
                    value: { $: 'local.newName' },
                    placeholder: 'What the project is called',
                    disabled: { $: 'local.busy' },
                    onInput: { $setLocal: 'newName', value: { $: 'event.detail' } },
                  },
                },
              ],
            },
            {
              type: 'we-form-field',
              props: {
                label: 'Passphrase',
                description: 'The project secret. Share it with whoever should join — anybody holding it can.',
              },
              children: [
                {
                  type: 'we-input',
                  props: {
                    width: '100%',
                    value: { $: 'local.newPassphrase' },
                    placeholder: 'A few words they will type back',
                    disabled: { $: 'local.busy' },
                    onInput: { $setLocal: 'newPassphrase', value: { $: 'event.detail' } },
                  },
                },
              ],
            },
            {
              type: 'Row',
              props: { ax: 'end' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'solid',
                    loading: { $: 'local.busy' },
                    disabled: { $: '!local.newName || !local.newPassphrase' },
                    onClick: lifecycleCall({
                      $invoke: 'spaceStore.createAcornProject',
                      args: [{ $: 'local.newName' }, { $: 'local.newPassphrase' }],
                    }),
                  },
                  children: ['Create project'],
                },
              ],
            },

            { type: 'we-divider', props: { width: '100%' } },

            /*
              Join one: the passphrase alone usually suffices — the same words template to
              the same project language — with the address for when it does not.
            */
            { type: 'we-text', props: { variant: 'body', fontWeight: 'medium' }, children: ['Join a project'] },
            {
              type: 'we-form-field',
              props: { label: 'Passphrase', description: 'The secret the project was created with.' },
              children: [
                {
                  type: 'we-input',
                  props: {
                    width: '100%',
                    value: { $: 'local.joinPassphrase' },
                    placeholder: 'The words you were given',
                    disabled: { $: 'local.busy' },
                    onInput: { $setLocal: 'joinPassphrase', value: { $: 'event.detail' } },
                  },
                },
              ],
            },
            {
              type: 'we-form-field',
              props: { label: 'Language address', description: 'Optional — leave empty and the passphrase finds it.' },
              children: [
                {
                  type: 'we-input',
                  props: {
                    width: '100%',
                    value: { $: 'local.joinAddress' },
                    placeholder: 'Only if the passphrase alone does not resolve',
                    disabled: { $: 'local.busy' },
                    onInput: { $setLocal: 'joinAddress', value: { $: 'event.detail' } },
                  },
                },
              ],
            },
            {
              type: 'Row',
              props: { ax: 'end' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'solid',
                    loading: { $: 'local.busy' },
                    disabled: { $: '!local.joinPassphrase' },
                    onClick: lifecycleCall({
                      $invoke: 'spaceStore.joinAcornProject',
                      args: [{ $: 'local.joinAddress || null' }, { $: 'local.joinPassphrase' }],
                    }),
                  },
                  children: ['Join project'],
                },
              ],
            },

            /*
              Mounting, initialising and landing: a cold rig takes a while, and a silent
              spinner for that long reads as a hang — `joinSlow` is the store's version of
              the same line; here the one busy flag covers all three calls.
            */
            {
              type: '$if',
              props: {
                condition: { $: 'local.busy' },
                then: {
                  type: 'Row',
                  props: { gap: '200', ay: 'center' },
                  children: [
                    { type: 'we-animated-icon', props: { name: 'spinner', size: 'xs', color: 'text-faint' } },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-muted' },
                      children: ['Mounting the project. A first open can take a minute.'],
                    },
                  ],
                },
              },
            },
            {
              type: '$if',
              props: {
                condition: { $: 'local.error' },
                then: {
                  type: 'we-alert',
                  props: { variant: 'soft', tone: 'danger' },
                  children: [{ $: 'local.error' }],
                },
              },
            },
          ],
        },
      },
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
