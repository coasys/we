export const createSpaceModal = {
  type: 'we-modal',
  props: {
    close: { $setLocal: 'createSpaceModalOpen', value: false },
    maxWidth: '560px',
    width: '100%',
  },
  $localState: {
    name: {
      type: 'string',
      initial: '',
      validate: [{ rule: 'required', message: 'Name is required' }],
    },
    description: { type: 'string', initial: '' },
    access: { type: 'string', initial: 'personal' },
    discovery: { type: 'string', initial: 'hidden' },
    avatar: { type: 'file', initial: null },
    coverImage: { type: 'file', initial: null },
    location: { type: 'object', initial: null },
    submitting: { type: 'boolean', initial: false },
  },
  children: [
    { type: 'we-text', props: { variant: 'heading-md' }, children: ['Create a New Space'] },

    // Cover image
    {
      type: 'EditableImage',
      props: {
        src: { $local: 'coverImage' },
        alt: 'Cover image',
        fit: 'cover',
        width: '100%',
        height: '180px',
        aspect: 4 / 1,
        placeholderIcon: 'panorama',
        onImageChange: { $setLocal: 'coverImage', from: '$event' },
      },
    },

    // Avatar image
    {
      type: 'Row',
      props: { ax: 'center', mt: '-85px' },
      children: [
        {
          type: 'EditableImage',
          props: {
            src: { $local: 'avatar' },
            alt: 'Space avatar',
            fit: 'cover',
            width: '120px',
            height: '120px',
            r: 'full',
            ring: '0 0 0 3px var(--we-color-neutral-500)',
            placeholderIcon: 'image',
            onImageChange: { $setLocal: 'avatar', from: '$event' },
          },
        },
      ],
    },

    // Name
    {
      type: 'we-form-field',
      props: { label: 'Name', error: { $if: { condition: { $error: 'name' }, then: { $error: 'name' } } } },
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

    // Location picker
    {
      type: 'Column',
      props: { gap: '400' },
      children: [
        {
          type: 'we-form-field',
          props: { label: 'Space location' },
          children: [
            {
              type: 'we-location-picker',
              props: {
                latitude: { $local: 'location.latitude' },
                longitude: { $local: 'location.longitude' },
                placeholder: 'Pin your space on the globe…',
                onChange: { $setLocal: 'location', from: '$event.detail' },
              },
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $local: 'location' },
            then: {
              type: 'Row',
              props: { gap: '400' },
              children: [
                {
                  type: 'we-form-field',
                  props: { label: 'City', flex: '1' },
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        value: { $local: 'location.city' },
                        placeholder: 'City…',
                        onInput: { $setLocal: 'location', merge: { city: '$event.detail' } },
                      },
                    },
                  ],
                },
                {
                  type: 'we-form-field',
                  props: { label: 'Country', flex: '1' },
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        value: { $local: 'location.country' },
                        placeholder: 'Country…',
                        onInput: { $setLocal: 'location', merge: { country: '$event.detail' } },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },

    // Access toggle (Personal vs Shared)
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        {
          type: 'Column',
          props: { gap: '100', flex: '1' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '400', fontWeight: 'medium' },
              children: [
                {
                  $if: {
                    condition: { $eq: [{ $local: 'access' }, 'shared'] },
                    then: 'Shared with network',
                    else: 'Personal space',
                  },
                },
              ],
            },
            {
              type: 'we-text',
              props: { variant: 'footnote' },
              children: [
                {
                  $if: {
                    condition: { $eq: [{ $local: 'access' }, 'shared'] },
                    then: 'Joinable by anyone with the link',
                    else: 'Only visible to you',
                  },
                },
              ],
            },
          ],
        },
        {
          type: 'we-switch',
          props: {
            checked: { $eq: [{ $local: 'access' }, 'shared'] },
            labelOff: 'Personal',
            labelOn: 'Shared',
            onChange: [
              {
                $if: {
                  condition: '$event.detail',
                  then: { $setLocal: 'access', value: 'shared' },
                  else: { $setLocal: 'access', value: 'personal' },
                },
              },
              { $if: { condition: { $not: '$event.detail' }, then: { $setLocal: 'discovery', value: 'hidden' } } },
            ],
          },
        },
      ],
    },

    // Discovery toggle (Hidden vs Listed)
    {
      type: 'Column',
      props: { gap: '200' },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [
            {
              type: 'Column',
              props: { gap: '100', flex: '1' },
              children: [
                {
                  type: 'we-text',
                  props: {
                    fontSize: '400',
                    fontWeight: 'medium',
                    color: {
                      $if: {
                        condition: {
                          $and: [{ $eq: [{ $local: 'access' }, 'shared'] }, { $store: 'adamStore.globalPerspective' }],
                        },
                        then: 'neutral-800',
                        else: 'neutral-400',
                      },
                    },
                  },
                  children: [
                    {
                      $if: {
                        condition: { $eq: [{ $local: 'discovery' }, 'listed'] },
                        then: 'Listed in Global Discovery',
                        else: 'Unlisted',
                      },
                    },
                  ],
                },
                {
                  type: 'we-text',
                  props: { variant: 'footnote' },
                  children: [
                    {
                      $if: {
                        condition: { $eq: [{ $local: 'discovery' }, 'listed'] },
                        then: 'Appears on the WE discovery globe',
                        else: 'Not shown in global discovery',
                      },
                    },
                  ],
                },
              ],
            },
            {
              type: 'we-switch',
              props: {
                checked: { $eq: [{ $local: 'discovery' }, 'listed'] },
                disabled: {
                  $or: [
                    { $not: { $eq: [{ $local: 'access' }, 'shared'] } },
                    { $not: { $store: 'adamStore.globalPerspective' } },
                  ],
                },
                labelOff: 'Hidden',
                labelOn: 'Public',
                onChange: [
                  {
                    $if: {
                      condition: '$event.detail',
                      then: { $setLocal: 'discovery', value: 'listed' },
                      else: { $setLocal: 'discovery', value: 'hidden' },
                    },
                  },
                ],
              },
            },
          ],
        },

        // Hint shown when global space not yet joined
        {
          type: '$if',
          props: {
            condition: {
              $and: [
                { $store: 'adamStore.globalSpaceConfigured' },
                { $not: { $store: 'adamStore.globalPerspective' } },
              ],
            },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'info', size: 'sm', color: 'neutral-400' } },
                {
                  type: 'we-text',
                  props: { variant: 'footnote' },
                  children: ['Join the WE discovery space to list your space globally.'],
                },
              ],
            },
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
            onClick: { $setLocal: 'createSpaceModalOpen', value: false },
          },
        },
        {
          type: 'we-button',
          props: {
            text: 'Create Space',
            bg: 'primary-500',
            color: 'neutral-0',
            height: '40px',
            loading: { $local: 'submitting' },
            disabled: { $local: 'submitting' },
            onClick: [
              { $touch: '$all' },
              { $setLocal: 'submitting', value: true },
              {
                $if: {
                  condition: { $formValid: '$scope' },
                  then: {
                    $action: 'adamStore.createSpace',
                    args: [
                      { $local: 'name' },
                      { $local: 'description' },
                      { $local: 'access' },
                      { $local: 'discovery' },
                      { $local: 'avatar' },
                      { $local: 'coverImage' },
                      { $local: 'location' },
                    ],
                    onSuccess: [{ $setLocal: 'createSpaceModalOpen', value: false }],
                    onFinally: [{ $setLocal: 'submitting', value: false }],
                  },
                  else: { $setLocal: 'submitting', value: false },
                },
              },
            ],
          },
        },
      ],
    },
  ],
};
