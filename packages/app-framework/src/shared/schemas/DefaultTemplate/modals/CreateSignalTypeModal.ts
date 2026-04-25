export const createSignalTypeModal = {
  type: 'we-modal',
  props: { close: { $setLocal: 'createOpen', value: false }, maxWidth: '500px', width: '100%' },
  children: [
    { type: 'we-text', props: { fontSize: '600', fontWeight: 'bold' }, children: ['New Signal Type'] },
    {
      type: 'we-form-field',
      props: { label: 'Name' },
      children: [
        {
          type: 'we-input',
          props: {
            placeholder: 'e.g. Like',
            value: { $local: 'newName' },
            onInput: { $setLocal: 'newName', from: '$event.detail' },
          },
        },
      ],
    },
    {
      type: 'we-form-field',
      props: { label: 'Icon (emoji)' },
      children: [
        {
          type: 'we-input',
          props: {
            value: { $local: 'newIcon' },
            onInput: { $setLocal: 'newIcon', from: '$event.detail' },
          },
        },
      ],
    },
    {
      type: 'we-form-field',
      props: { label: 'Display' },
      children: [
        {
          type: 'we-select',
          props: {
            value: { $local: 'newDisplay' },
            onChange: { $setLocal: 'newDisplay', from: '$event.target.value' },
            options: [
              { label: 'Icon (toggle)', value: 'icon' },
              { label: 'Up / Down', value: 'vertical-icons' },
              { label: 'Star rating', value: 'horizontal-icons' },
              { label: 'Slider', value: 'slider' },
            ],
          },
        },
      ],
    },
    {
      type: 'we-form-field',
      props: { label: 'Aggregate' },
      children: [
        {
          type: 'we-select',
          props: {
            value: { $local: 'newAggregate' },
            onChange: { $setLocal: 'newAggregate', from: '$event.target.value' },
            options: [
              { label: 'Count', value: 'count' },
              { label: 'Sum', value: 'sum' },
              { label: 'Mean', value: 'mean' },
              { label: 'Median', value: 'median' },
            ],
          },
        },
      ],
    },

    // Live preview
    {
      type: 'SignalControl',
      props: {
        signalType: {
          icon: { $local: 'newIcon' },
          display: { $local: 'newDisplay' },
          rangeMin: { $local: 'newRangeMin' },
          rangeMax: { $local: 'newRangeMax' },
        },
        aggregate: 0,
      },
    },

    {
      type: 'Row',
      props: { gap: '300', ax: 'end', mt: '200' },
      children: [
        {
          type: 'we-button',
          props: { variant: 'ghost', text: 'Cancel', onClick: { $setLocal: 'createOpen', value: false } },
        },
        {
          type: 'we-button',
          props: {
            text: 'Create',
            bg: 'primary-500',
            color: 'neutral-0',
            height: '40px',
            onClick: [
              {
                $action: 'spaceStore.createSignalType',
                args: [
                  {
                    name: { $local: 'newName' },
                    icon: { $local: 'newIcon' },
                    display: { $local: 'newDisplay' },
                    aggregate: { $local: 'newAggregate' },
                    rangeMin: { $local: 'newRangeMin' },
                    rangeMax: { $local: 'newRangeMax' },
                  },
                ],
              },
              { $setLocal: 'createOpen', value: false },
            ],
          },
        },
      ],
    },
  ],
};
