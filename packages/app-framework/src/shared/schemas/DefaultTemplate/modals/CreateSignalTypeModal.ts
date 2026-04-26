export const createSignalTypeModal = {
  type: 'we-modal',
  props: { close: { $setLocal: 'createOpen', value: false }, maxWidth: '500px', width: '100%' },
  children: [
    // Title
    {
      type: 'we-text',
      props: { fontSize: '700', fontWeight: 'bold', textAlign: 'center' },
      children: ['New Signal Type'],
    },

    // Name
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

    // Description
    {
      type: 'we-form-field',
      props: { label: 'Description' },
      children: [
        {
          type: 'we-textarea',
          props: {
            placeholder: 'Description',
            value: { $local: 'newDescription' },
            onInput: { $setLocal: 'newDescription', from: '$event.detail' },
          },
        },
      ],
    },

    // Mode & icon selectors
    {
      type: 'Row',
      props: { gap: '400', ax: 'center', wrap: true },
      children: [
        // Mode selector
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

        // Primary icon
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

        // Secondary icon (only for vote mode)
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $local: 'newMode' }, 'vote'] },
            then: {
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
          },
        },
      ],
    },

    // Range & step inputs (only for rating and slider modes)
    {
      type: '$if',
      props: {
        condition: { $or: [{ $eq: [{ $local: 'newMode' }, 'rating'] }, { $eq: [{ $local: 'newMode' }, 'slider'] }] },
        then: {
          type: 'Row',
          props: { gap: '300', ax: 'center' },
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
                    step: 0.1,
                    onChange: { $setLocal: 'newStep', from: '$event.detail' },
                  },
                },
              ],
            },
          ],
        },
      },
    },

    // Live preview
    {
      type: 'Column',
      props: { gap: '200', my: '400', ax: 'center', border: '1px solid neutral-200', p: '400', r: '500' },
      children: [
        { type: 'we-text', props: { color: 'neutral-500' }, children: ['Preview'] },
        {
          type: 'SignalControl',
          props: {
            preview: true,
            signalType: {
              icon: { $local: 'newIcon' },
              iconSecondary: { $local: 'newIconSecondary' },
              mode: { $local: 'newMode' },
              rangeMin: { $local: 'newRangeMin' },
              rangeMax: { $local: 'newRangeMax' },
              step: { $local: 'newStep' },
            },
          },
        },
      ],
    },

    // Action buttons
    {
      type: 'Row',
      props: { gap: '300', ax: 'center', mt: '200' },
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
