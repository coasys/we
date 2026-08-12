import { field } from '@we/template-kit';

export const createSignalTypeModal = {
  type: 'we-modal',
  props: { close: { $setLocal: 'createSignalTypeOpen', value: false }, maxWidth: '500px', width: '100%' },
  $localState: {
    name: { type: 'string', initial: '' },
    slug: { type: 'string', initial: '' },
    description: { type: 'string', initial: '' },
    icon: { type: 'string', initial: '❤️' },
    iconSecondary: { type: 'string', initial: '' },
    mode: { type: 'string', initial: 'toggle' },
    aggregate: { type: 'string', initial: 'count' },
    rangeMin: { type: 'number', initial: 0 },
    rangeMax: { type: 'number', initial: 1 },
    step: { type: 'number', initial: 1 },
  },
  children: [
    // Title
    {
      type: 'we-text',
      props: { variant: 'heading-md', textAlign: 'center' },
      children: ['New Signal Type'],
    },

    // Name
    field({ name: 'name', label: 'Name', placeholder: 'e.g. Like' }),

    // Slug
    field({
      name: 'slug',
      label: 'Slug',
      description: 'Auto-generated from name. Used in schemas to reference this signal type.',
      placeholder: 'e.g. like',
    }),

    // Description
    field({ name: 'description', label: 'Description', control: 'textarea', placeholder: 'Description' }),

    // Mode & icon selectors
    {
      type: 'Row',
      props: { gap: '400', ax: 'center', wrap: true },
      children: [
        // Mode selector
        field({
          name: 'mode',
          label: 'Mode',
          control: 'select',
          props: {
            options: [
              { label: 'Toggle', value: 'toggle' },
              { label: 'Vote', value: 'vote' },
              { label: 'Rating', value: 'rating' },
              { label: 'Slider', value: 'slider' },
            ],
          },
        }),

        // Primary icon
        {
          type: 'we-form-field',
          props: { label: 'Icon' },
          children: [
            {
              type: 'we-icon-picker',
              props: {
                value: { $local: 'icon' },
                onChange: { $setLocal: 'icon', from: '$event.detail' },
              },
            },
          ],
        },

        // Secondary icon (only for vote mode)
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $local: 'mode' }, 'vote'] },
            then: {
              type: 'we-form-field',
              props: { label: 'Secondary Icon', description: 'Used as the negative icon in vote mode' },
              children: [
                {
                  type: 'we-icon-picker',
                  props: {
                    placeholder: 'Same as icon',
                    value: { $local: 'iconSecondary' },
                    onChange: { $setLocal: 'iconSecondary', from: '$event.detail' },
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
        condition: { $or: [{ $eq: [{ $local: 'mode' }, 'rating'] }, { $eq: [{ $local: 'mode' }, 'slider'] }] },
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
                    value: { $local: 'rangeMin' },
                    onChange: { $setLocal: 'rangeMin', from: '$event.detail' },
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
                    value: { $local: 'rangeMax' },
                    onChange: { $setLocal: 'rangeMax', from: '$event.detail' },
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
                    value: { $local: 'step' },
                    min: 0.1,
                    step: 0.1,
                    onChange: { $setLocal: 'step', from: '$event.detail' },
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
        { type: 'we-text', children: ['Preview'] },
        {
          type: 'SignalControl',
          props: {
            preview: true,
            signalType: {
              icon: { $local: 'icon' },
              iconSecondary: { $local: 'iconSecondary' },
              mode: { $local: 'mode' },
              rangeMin: { $local: 'rangeMin' },
              rangeMax: { $local: 'rangeMax' },
              step: { $local: 'step' },
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
          props: { variant: 'ghost', text: 'Cancel', onClick: { $setLocal: 'createSignalTypeOpen', value: false } },
        },
        {
          type: 'we-button',
          props: {
            text: 'Create',
            height: '40px',
            onClick: [
              {
                $action: 'spaceStore.createSignalType',
                args: [
                  {
                    name: { $local: 'name' },
                    slug: { $local: 'slug' },
                    description: { $local: 'description' },
                    icon: { $local: 'icon' },
                    iconSecondary: { $local: 'iconSecondary' },
                    mode: { $local: 'mode' },
                    aggregate: { $local: 'aggregate' },
                    rangeMin: { $local: 'rangeMin' },
                    rangeMax: { $local: 'rangeMax' },
                    step: { $local: 'step' },
                  },
                ],
              },
              { $resetLocal: '$scope' },
              { $setLocal: 'createSignalTypeOpen', value: false },
            ],
          },
        },
      ],
    },
  ],
};
