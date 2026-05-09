export const createSpaceModal = {
  type: 'we-modal',
  props: {
    close: { $setLocal: 'createSpaceOpen', value: false },
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
    shared: { type: 'boolean', initial: false },
    listedGlobally: { type: 'boolean', initial: false },
    avatar: { type: 'file', initial: null },
    coverImage: { type: 'file', initial: null },
    globalPromptDismissed: { type: 'boolean', initial: false },
    locationLat: { type: 'number', initial: null },
    locationLng: { type: 'number', initial: null },
    locationCity: { type: 'string', initial: '' },
    locationCountry: { type: 'string', initial: '' },
    locationCountryCode: { type: 'string', initial: '' },
  },
  children: [
    { type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Create a New Space'] },

    // Cover image (wide banner)
    {
      type: 'EditableImage',
      props: {
        src: { $local: 'coverImage' },
        alt: 'Cover image',
        fit: 'cover',
        width: '100%',
        height: '140px',
        r: '300',
        placeholderIcon: 'panorama',
        onImageChange: { $setLocal: 'coverImage', from: '$event' },
      },
    },

    // Avatar image (circular)
    {
      type: 'EditableImage',
      props: {
        src: { $local: 'avatar' },
        alt: 'Space avatar',
        fit: 'cover',
        width: '80px',
        height: '80px',
        r: 'full',
        placeholderIcon: 'image',
        onImageChange: { $setLocal: 'avatar', from: '$event' },
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
        {
          type: 'Column',
          props: { gap: '100', flex: '1' },
          children: [
            { type: 'we-text', props: { fontSize: '400', fontWeight: 'medium' }, children: ['Shared with network'] },
            {
              type: 'we-text',
              props: { fontSize: '300', color: 'neutral-400' },
              children: ['Publish as a joinable neighbourhood'],
            },
          ],
        },
        {
          type: 'we-switch',
          props: {
            checked: { $local: 'shared' },
            onChange: { $setLocal: 'shared', from: '$event.detail' },
          },
        },
      ],
    },

    // Listed in Global Discovery toggle (only active when shared)
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
                color: { $if: { condition: { $local: 'shared' }, then: 'neutral-800', else: 'neutral-400' } },
              },
              children: ['Listed in Global Discovery'],
            },
            {
              type: 'we-text',
              props: { fontSize: '300', color: 'neutral-400' },
              children: ['Appear on the WE discovery globe'],
            },
          ],
        },
        {
          type: 'we-switch',
          props: {
            checked: { $local: 'listedGlobally' },
            disabled: { $not: { $local: 'shared' } },
            onChange: { $setLocal: 'listedGlobally', from: '$event.detail' },
          },
        },
      ],
    },

    // Location picker — only shown when listed globally (a globe pin needs coords)
    {
      type: '$if',
      props: {
        condition: { $and: [{ $local: 'shared' }, { $local: 'listedGlobally' }] },
        then: {
          type: 'Column',
          props: { gap: '300' },
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
                  props: { gap: '300' },
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
      },
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
              { $setLocal: 'createSpaceOpen', value: false },
              {
                $if: {
                  condition: { $formValid: '$scope' },
                  then: {
                    $action: 'adamStore.createSpace',
                    args: [
                      { $local: 'name' },
                      { $local: 'description' },
                      {
                        $if: {
                          condition: { $and: [{ $local: 'shared' }, { $local: 'listedGlobally' }] },
                          then: 'public',
                          else: {
                            $if: {
                              condition: { $local: 'shared' },
                              then: 'shared',
                              else: 'personal',
                            },
                          },
                        },
                      },
                      { $local: 'avatar' },
                      { $local: 'coverImage' },
                      { $local: 'locationLat' },
                      { $local: 'locationLng' },
                      { $local: 'locationCity' },
                      { $local: 'locationCountry' },
                      { $local: 'locationCountryCode' },
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
