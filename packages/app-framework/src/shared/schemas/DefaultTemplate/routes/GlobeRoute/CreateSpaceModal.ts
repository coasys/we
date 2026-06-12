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
    globalPromptDismissed: { type: 'boolean', initial: false },
    locationLat: { type: 'number', initial: null },
    locationLng: { type: 'number', initial: null },
    locationCity: { type: 'string', initial: '' },
    locationCountry: { type: 'string', initial: '' },
    locationCountryCode: { type: 'string', initial: '' },
    submitting: { type: 'boolean', initial: false },
  },
  children: [
    { type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Create a New Space'] },

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
        // r: '300',
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

    // Location picker — only shown when listed globally (a globe pin needs coords)
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
                latitude: { $local: 'locationLat' },
                longitude: { $local: 'locationLng' },
                placeholder: 'Pin your space on the globe…',
                onChange: [
                  { $setLocal: 'locationLat', from: '$event.detail.latitude' },
                  { $setLocal: 'locationLng', from: '$event.detail.longitude' },
                  { $setLocal: 'locationCity', from: '$event.detail.city' },
                  { $setLocal: 'locationCountry', from: '$event.detail.country' },
                  { $setLocal: 'locationCountryCode', from: '$event.detail.countryCode' },
                ],
              },
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $local: 'locationLat' },
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
                        value: { $local: 'locationCity' },
                        placeholder: 'City…',
                        onInput: { $setLocal: 'locationCity', from: '$event.detail' },
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
                        value: { $local: 'locationCountry' },
                        placeholder: 'Country…',
                        onInput: { $setLocal: 'locationCountry', from: '$event.detail' },
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
              props: { fontSize: '300', color: 'neutral-400' },
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
                    condition: { $eq: [{ $local: 'access' }, 'shared'] },
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
              props: { fontSize: '300', color: 'neutral-400' },
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
            disabled: { $not: { $eq: [{ $local: 'access' }, 'shared'] } },
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
                      { $local: 'locationLat' },
                      { $local: 'locationLng' },
                      { $local: 'locationCity' },
                      { $local: 'locationCountry' },
                      { $local: 'locationCountryCode' },
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
