import type { SchemaNode, SchemaProp } from '@we/schema-shared';

const close = { $invoke: 'shellStore.setAcornProjectsOpen', args: [false] };

/**
 * One lifecycle call's wiring: the busy flag around it, the modal closed only
 * when the call actually landed — `null` is a stood-down or unanswered ask
 * (superseded by a newer one, or a backend that cannot mount), not a landing to
 * close over. The rejection is turned into words the dialog reads — `local.error`
 * is the answer `JoinSpaceModal` gives for the same situation. The retained
 * operation's own progress and its Retry/Close live in `spaceStore.acornPending`,
 * the card below — parked there across this dialog closing, not in these locals.
 */
const lifecycleCall = (invoke: Record<string, unknown>): SchemaProp[] => [
  { $setLocal: 'busy', value: true },
  { $setLocal: 'error', value: '' },
  {
    ...invoke,
    onSuccess: [
      {
        $if: {
          condition: { $: 'result' },
          then: close,
          else: {
            $setLocal: 'error',
            // A pending operation is already telling its own story in the card.
            value: { $: "spaceStore.acornPending ? '' : 'That did not work — no project was opened.'" },
          },
        },
      },
    ],
    // A typed lifecycle failure is already telling its own story in the parked
    // card below — its plain message and the raw cause in the details. Only a
    // call that failed without parking a state gets the log line here.
    onError: [
      {
        $setLocal: 'error',
        value: {
          $: "spaceStore.acornPending && spaceStore.acornPending.failure ? '' : (result && result.message ? result.message : 'That did not work')",
        },
      },
    ],
    onFinally: [{ $setLocal: 'busy', value: false }],
  },
];

/**
 * The Acorn projects dialog.
 *
 * ## Why it is host chrome and not a module part
 *
 * The members it invokes — `createAcornProject`, `joinAcornProject`, `openAcornProject` —
 * hold `space-admin`: they template and install a language, mount it on a dataset and write
 * that space's template, the same authority `createSpace` carries. A module part renders in
 * the tier of whoever mounts it, so a part that needed those members would be dead anywhere
 * but the overlay slot — and alive in a community template had they stayed reachable there.
 * Drawn from the host's own chrome (`slotRegistry`'s `core:acornProjects` overlay, beside the
 * two space dialogs), the schema renders at the chrome tier where the members it names exist.
 *
 * A space template still gets to open it: `setAcornProjectsOpen` is ambient, which is the
 * request-the-host path the review prescribes — the space asks, the host's own buttons carry
 * the grant. `spaceStore.acornAvailable` keeps both the door and, through the condition here,
 * the dialog itself shut on a deployment that cannot answer the lifecycle.
 */
export const acornProjectsModal: SchemaNode = {
  type: 'we-modal',
  props: { size: 'md', close },
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
            disabled: { $: 'local.busy || !local.newName || !local.newPassphrase' },
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
            disabled: { $: 'local.busy || !local.joinPassphrase' },
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
      The retained operation's card — what `spaceStore.acornPending` reports.
      While it runs, the phase and the mount attempt; when it cannot finish, the
      resumable failure: Retry picks the same dataset and language back up (the
      form's fields are a *new* ask, not this one's) and Close only dismisses —
      the operation stays retained for the next open either way.
    */
    {
      type: '$if',
      props: {
        condition: { $: 'spaceStore.acornPending' },
        then: {
          type: '$if',
          props: {
            condition: { $: "spaceStore.acornPending.phase == 'failed'" },
            else: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-animated-icon', props: { name: 'spinner', size: 'xs', color: 'text-faint' } },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-muted' },
                  children: [
                    {
                      $: "spaceStore.acornPending.phase == 'mounting' ? 'Mounting the project — attempt ' + (spaceStore.acornPending.attempt ? spaceStore.acornPending.attempt : 1) + ' of 5. A first open can take a minute.' : spaceStore.acornPending.phase == 'setting-up' ? 'Setting the space up.' : 'Preparing the project.'",
                    },
                  ],
                },
              ],
            },
            then: {
              type: 'Column',
              props: { gap: '300', width: '100%' },
              children: [
                {
                  type: 'we-alert',
                  props: { variant: 'soft', tone: 'danger' },
                  children: [
                    {
                      $: "'The project could not finish connecting.' + (spaceStore.acornPending.failure && spaceStore.acornPending.failure.display ? ' ' + spaceStore.acornPending.failure.display : ' A peer may be unavailable.') + (spaceStore.acornPending.failure && spaceStore.acornPending.failure.retryable ? ' Retry continues this same project.' : '')",
                    },
                  ],
                },
                /*
                  The details, not the headline: the executor's own text stays
                  where a diagnosis looks for it — never splashed across the
                  card, and never trusted with a wire string it could smuggle a
                  seed through. `display` above is the classified sentence.
                */
                {
                  type: '$if',
                  props: {
                    condition: {
                      $: 'spaceStore.acornPending.failure && spaceStore.acornPending.failure.cause',
                    },
                    then: {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-faint' },
                      children: [{ $: "'Details: ' + spaceStore.acornPending.failure.cause" }],
                    },
                  },
                },
                {
                  type: 'Row',
                  props: { ax: 'end', gap: '200' },
                  children: [
                    {
                      type: '$if',
                      props: {
                        condition: {
                          $: 'spaceStore.acornPending.failure && spaceStore.acornPending.failure.retryable',
                        },
                        then: {
                          type: 'we-button',
                          props: {
                            variant: 'solid',
                            disabled: { $: 'local.busy' },
                            // The failure on display names its own target — this
                            // Retry resumes it, not whichever operation happens
                            // to be parked first.
                            onClick: lifecycleCall({
                              $invoke: 'spaceStore.retryAcornProject',
                              args: [
                                { $: 'spaceStore.acornPending.datasetId' },
                                { $: 'spaceStore.acornPending.languageAddress' },
                              ],
                            }),
                          },
                          children: ['Retry'],
                        },
                      },
                    },
                    {
                      type: 'we-button',
                      props: { variant: 'soft', disabled: { $: 'local.busy' }, onClick: [close] },
                      children: ['Close'],
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },

    /*
      Mounting, initialising and landing: a cold rig takes a while, and a silent
      spinner for that long reads as a hang — the pending card above narrates it
      once the operation reports; this line covers only the first beat before it does.
    */
    {
      type: '$if',
      props: {
        condition: { $: 'local.busy && !spaceStore.acornPending' },
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
};

/**
 * What the overlay slot mounts — the dialog while the flag is up, and only where this build
 * can answer its calls. Gating the mount rather than the modal alone is what `acornAvailable`
 * is for: on a deployment without the port, the module or the template, the flag can be set
 * all it likes and nothing appears.
 */
export const acornProjectsModalMount: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'shellStore.acornProjectsOpen && spaceStore.acornAvailable' },
    then: acornProjectsModal,
  },
};
