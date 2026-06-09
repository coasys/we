export const createPostModal = {
  type: 'we-modal',
  props: {
    close: { $setLocal: 'createPostOpen', value: false },
    maxWidth: '900px',
    width: '100%',
    ax: 'center',
  },
  $localState: {
    savePost: { type: 'function', initial: null },
    submitting: { type: 'boolean', initial: false },
  },
  children: [
    { type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Create Post'] },
    {
      type: 'Column',
      props: {
        width: '100%',
        bg: 'neutral-25',
        p: '600',
        pl: '1000',
        r: '400',
        overflow: 'auto',
      },
      children: [
        {
          type: 'BlockComposer',
          props: {
            onReady: { $setLocal: 'savePost', from: '$event.save' },
            onSave: [
              { $setLocal: 'submitting', value: true },
              {
                $action: 'spaceStore.createPost',
                args: ['$arg'],
                onSuccess: [{ $setLocal: 'createPostOpen', value: false }],
                onFinally: [{ $setLocal: 'submitting', value: false }],
              },
            ],
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
            onClick: { $setLocal: 'createPostOpen', value: false },
          },
        },
        {
          type: 'we-button',
          props: {
            text: 'Post',
            bg: 'primary-500',
            color: 'neutral-0',
            height: '40px',
            loading: { $local: 'submitting' },
            disabled: { $local: 'submitting' },
            onClick: { $callLocal: 'savePost' },
          },
        },
      ],
    },
  ],
};
