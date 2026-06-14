// TODO: wire onClick to spaceStore.createSpace(name, description) once that action exists.
// That action should create a Space model record in the current perspective without
// spinning up a full AD4M neighbourhood (unlike adamStore.createSpace).
export const createChildSpaceModal = {
  type: 'we-modal',
  props: {
    close: { $setLocal: 'createSpaceModalOpen', value: false },
    maxWidth: '480px',
    width: '100%',
  },
  $localState: {
    name: {
      type: 'string',
      initial: '',
      validate: [{ rule: 'required', message: 'Name is required' }],
    },
    description: { type: 'string', initial: '' },
    submitting: { type: 'boolean', initial: false },
  },
  children: [
    { type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Create Space'] },

    {
      type: 'we-form-field',
      props: {
        label: 'Name',
        error: { $if: { condition: { $error: 'name' }, then: { $error: 'name' } } },
      },
      children: [
        {
          type: 'we-input',
          props: {
            placeholder: 'Space name…',
            value: { $local: 'name' },
            onInput: { $setLocal: 'name', from: '$event.detail' },
            onBlur: { $touch: 'name' },
          },
        },
      ],
    },

    {
      type: 'we-form-field',
      props: { label: 'Description' },
      children: [
        {
          type: 'we-input',
          props: {
            placeholder: 'Description (optional)',
            value: { $local: 'description' },
            onInput: { $setLocal: 'description', from: '$event.detail' },
          },
        },
      ],
    },

    {
      type: 'Row',
      props: { gap: '300', ax: 'end', mt: '200' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            text: 'Cancel',
            onClick: { $setLocal: 'createSpaceModalOpen', value: false },
          },
        },
        {
          type: 'we-button',
          props: {
            text: 'Create Space',
            variant: 'primary',
            loading: { $local: 'submitting' },
            disabled: { $or: [{ $local: 'submitting' }, { $not: { $formValid: '$scope' } }] },
            onClick: [
              { $touch: '$all' },
              {
                $if: {
                  condition: { $formValid: '$scope' },
                  then: {
                    $action: 'adamStore.createSpace',
                    args: [{ $local: 'name' }, { $local: 'description' }, false],
                    onSuccess: [{ $setLocal: 'createSpaceModalOpen', value: false }],
                    onFinally: [{ $setLocal: 'submitting', value: false }],
                  },
                },
              },
            ],
          },
        },
      ],
    },
  ],
};
