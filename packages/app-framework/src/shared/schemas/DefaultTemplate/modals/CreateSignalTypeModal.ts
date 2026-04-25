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
      props: { label: 'Icon' },
      children: [
        {
          type: 'we-icon-picker',
          props: {
            value: { $local: 'newIcon' },
            onChange: { $setLocal: 'newIcon', from: '$event.detail' },
          },
        },
      ],
    },
    {
      type: 'we-form-field',
      props: { label: 'Secondary Icon', helpText: 'Used as the negative icon in vote mode' },
      children: [
        {
          type: 'we-icon-picker',
          props: {
            placeholder: 'Same as icon',
            value: { $local: 'newIconSecondary' },
            onChange: { $setLocal: 'newIconSecondary', from: '$event.detail' },
          },
        },
      ],
    },
    {
      type: 'we-form-field',
      props: { label: 'Mode' },
      children: [
        {
          type: 'we-select',
          props: {
            value: { $local: 'newMode' },
            onChange: { $setLocal: 'newMode', from: '$event.target.value' },
            options: [
              { label: 'Toggle', value: 'toggle' },
              { label: 'Vote', value: 'vote' },
              { label: 'Rating', value: 'rating' },
              { label: 'Slider', value: 'slider' },
            ],
          },
        },
      ],
    },
    // {
    //   type: 'we-form-field',
    //   props: { label: 'Aggregate' },
    //   children: [
    //     {
    //       type: 'we-select',
    //       props: {
    //         value: { $local: 'newAggregate' },
    //         onChange: { $setLocal: 'newAggregate', from: '$event.target.value' },
    //         options: [
    //           { label: 'Count', value: 'count' },
    //           { label: 'Sum', value: 'sum' },
    //           { label: 'Mean', value: 'mean' },
    //           { label: 'Median', value: 'median' },
    //         ],
    //       },
    //     },
    //   ],
    // },

    // Range & step
    {
      type: 'Row',
      props: { gap: '300' },
      children: [
        {
          type: 'we-form-field',
          props: { label: 'Min' },
          children: [
            {
              type: 'we-number-input',
              props: {
                value: { $local: 'newRangeMin' },
                onChange: { $setLocal: 'newRangeMin', from: '$event.detail' },
              },
            },
          ],
        },
        {
          type: 'we-form-field',
          props: { label: 'Max' },
          children: [
            {
              type: 'we-number-input',
              props: {
                value: { $local: 'newRangeMax' },
                onChange: { $setLocal: 'newRangeMax', from: '$event.detail' },
              },
            },
          ],
        },
        {
          type: 'we-form-field',
          props: { label: 'Step' },
          children: [
            {
              type: 'we-number-input',
              props: {
                value: { $local: 'newStep' },
                min: 0.1,
                step: 0.5,
                onChange: { $setLocal: 'newStep', from: '$event.detail' },
              },
            },
          ],
        },
      ],
    },

    // Live preview
    {
      type: 'SignalControl',
      props: {
        signalType: {
          icon: { $local: 'newIcon' },
          iconSecondary: { $local: 'newIconSecondary' },
          mode: { $local: 'newMode' },
          rangeMin: { $local: 'newRangeMin' },
          rangeMax: { $local: 'newRangeMax' },
          step: { $local: 'newStep' },
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
                    iconSecondary: { $local: 'newIconSecondary' },
                    mode: { $local: 'newMode' },
                    aggregate: { $local: 'newAggregate' },
                    rangeMin: { $local: 'newRangeMin' },
                    rangeMax: { $local: 'newRangeMax' },
                    step: { $local: 'newStep' },
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
