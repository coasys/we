import type { SchemaNode, SchemaProp } from '@we/schema-shared';

const close = { $invoke: 'shellStore.setAcornProjectsOpen', args: [false] };

/**
 * One lifecycle call's wiring: the busy flag around it, the modal closed when it lands,
 * the rejection turned into words where the dialog can read them — `local.error` is the
 * answer `JoinSpaceModal` gives for the same situation, an `$invoke` failure being the
 * only kind a schema can see.
 */
const lifecycleCall = (invoke: Record<string, unknown>): SchemaProp[] => [
  { $setLocal: 'busy', value: true },
  { $setLocal: 'error', value: '' },
  {
    ...invoke,
    onSuccess: [close],
    onError: [{ $setLocal: 'error', value: { $: "result && result.message ? result.message : 'That did not work'" } }],
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
