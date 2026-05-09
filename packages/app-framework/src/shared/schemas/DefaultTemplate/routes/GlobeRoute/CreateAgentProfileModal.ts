export const createAgentProfileModal = {
  type: 'we-modal',
  props: {
    close: { $setLocal: 'createAgentProfileOpen', value: false },
    maxWidth: '560px',
    width: '100%',
  },
  $localState: {
    firstName: {
      type: 'string',
      initial: '',
      validate: [{ rule: 'required', message: 'First name is required' }],
    },
    lastName: { type: 'string', initial: '' },
    handle: { type: 'string', initial: '' },
    bio: { type: 'string', initial: '' },
    avatar: { type: 'file', initial: null },
    coverImage: { type: 'file', initial: null },
    locationLat: { type: 'number', initial: null },
    locationLng: { type: 'number', initial: null },
    locationCity: { type: 'string', initial: '' },
    locationCountry: { type: 'string', initial: '' },
    locationCountryCode: { type: 'string', initial: '' },
  },
  children: [
    { type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Add Agent Profile'] },

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
        alt: 'Profile avatar',
        fit: 'cover',
        width: '80px',
        height: '80px',
        r: 'full',
        placeholderIcon: 'user',
        onImageChange: { $setLocal: 'avatar', from: '$event' },
      },
    },

    // First name + Last name row
    {
      type: 'Row',
      props: { gap: '300' },
      children: [
        {
          type: 'we-form-field',
          props: {
            label: 'First Name',
            flex: '1',
            error: { $if: { condition: { $error: 'firstName' }, then: { $error: 'firstName' } } },
          },
          children: [
            {
              type: 'we-input',
              props: {
                placeholder: 'First name...',
                value: { $local: 'firstName' },
                onInput: { $setLocal: 'firstName', from: '$event.detail' },
                onBlur: { $touch: 'firstName' },
              },
            },
          ],
        },
        {
          type: 'we-form-field',
          props: { label: 'Last Name', flex: '1' },
          children: [
            {
              type: 'we-input',
              props: {
                placeholder: 'Last name...',
                value: { $local: 'lastName' },
                onInput: { $setLocal: 'lastName', from: '$event.detail' },
              },
            },
          ],
        },
      ],
    },

    // Handle
    {
      type: 'we-form-field',
      props: { label: 'Handle' },
      children: [
        {
          type: 'we-input',
          props: {
            placeholder: '@handle...',
            value: { $local: 'handle' },
            onInput: { $setLocal: 'handle', from: '$event.detail' },
          },
        },
      ],
    },

    // Bio
    {
      type: 'we-form-field',
      props: { label: 'Bio' },
      children: [
        {
          type: 'we-input',
          props: {
            placeholder: 'Short bio (optional)...',
            value: { $local: 'bio' },
            onInput: { $setLocal: 'bio', from: '$event.detail' },
          },
        },
      ],
    },

    // Location picker
    {
      type: 'we-form-field',
      props: { label: 'Location' },
      children: [
        {
          type: 'we-location-picker',
          props: {
            latitude: { $local: 'locationLat' },
            longitude: { $local: 'locationLng' },
            placeholder: 'Pin your location on the globe…',
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

    // City + Country editable fields (only shown once a pin has been placed)
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
            onClick: { $setLocal: 'createAgentProfileOpen', value: false },
          },
        },
        {
          type: 'we-button',
          props: {
            text: 'Add Agent Profile',
            bg: 'primary-500',
            color: 'neutral-0',
            height: '40px',
            disabled: { $not: { $formValid: '$scope' } },
            onClick: [
              { $touch: '$all' },
              { $setLocal: 'createAgentProfileOpen', value: false },
              {
                $if: {
                  condition: { $formValid: '$scope' },
                  then: {
                    $action: 'spaceStore.createAgentProfile',
                    args: [
                      { $local: 'firstName' },
                      { $local: 'lastName' },
                      { $local: 'handle' },
                      { $local: 'bio' },
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
