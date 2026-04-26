export const createSpaceModal = {
  type: 'we-modal',
  props: {
    close: { $setLocal: 'createSpaceOpen', value: false },
    maxWidth: '560px',
    width: '100%',
  },
  children: [
    { type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Create a New Space'] },

    // Space image
    {
      type: 'EditableImage',
      props: {
        src: { $local: 'thumbnail' },
        alt: 'Space image',
        fit: 'cover',
        width: '100%',
        height: '160px',
        r: '300',
        placeholderIcon: 'image',
        onImageChange: { $setLocal: 'thumbnail', from: '$event' },
      },
    },

    // Name
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
            placeholder: 'Space name...',
            value: { $local: 'name' },
            onInput: { $setLocal: 'name', from: '$event.detail' },
            onBlur: { $touch: 'name' },
          },
        },
      ],
    },

    // Description
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

    // Shared toggle
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        { type: 'we-text', props: { fontSize: '400' }, children: ['Shared with network'] },
        {
          type: 'we-switch',
          props: {
            checked: { $local: 'shared' },
            onChange: { $setLocal: 'shared', from: '$event.detail' },
          },
        },
      ],
    },

    // Action buttons
    {
      type: 'Row',
      props: { gap: '300', ax: 'end', mt: '200' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            text: 'Cancel',
            onClick: { $setLocal: 'createSpaceOpen', value: false },
          },
        },
        {
          type: 'we-button',
          props: {
            text: 'Create Space',
            bg: 'primary-500',
            color: 'neutral-0',
            height: '40px',
            loading: { $store: 'adamStore.creatingSpace' },
            disabled: { $not: { $formValid: '$scope' } },
            onClick: [
              { $touch: '$all' },
              {
                $if: {
                  condition: { $formValid: '$scope' },
                  then: {
                    $action: 'adamStore.createSpace',
                    args: [
                      { $local: 'name' },
                      { $local: 'description' },
                      { $local: 'shared' },
                      { $local: 'thumbnail' },
                    ],
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
