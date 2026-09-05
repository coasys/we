import type { TemplateSchema } from '@we/schema-shared';

export const profileTemplate: TemplateSchema = {
  meta: { name: 'Profile', description: 'Agent profile page', icon: 'user' },
  type: 'Column',
  props: { minWidth: '100%', minHeight: '100%', bg: 'page', ax: 'center' },
  children: [
    // Cover image
    {
      type: 'EditableImage',
      props: {
        src: { $: 'profileStore.ownProfile.coverImage' },
        alt: 'Cover image',
        fit: 'cover',
        width: '100%',
        height: '200px',
        aspect: 4 / 1,
        placeholderIcon: 'panorama',
        uploadLabel: 'Upload cover image',
        editLabel: 'Change cover image',
        onImageChange: { $action: 'profileStore.updateProfileImage', args: ['coverImage', { $: 'arg' }] },
        onImageRemove: { $action: 'profileStore.clearProfileImage', args: ['coverImage'] },
      },
    },

    // Main content column
    {
      type: 'Column',
      props: { mt: '-60px', maxWidth: '800px', width: '100%', gap: '400', px: '500', mb: '500' },
      children: [
        // Profile picture
        {
          type: 'EditableImage',
          props: {
            src: { $: 'profileStore.ownProfile.avatar' },
            alt: 'Profile picture',
            fit: 'cover',
            width: '120px',
            height: '120px',
            r: 'avatar',
            ring: '0 0 0 3px var(--we-color-neutral-500)',
            placeholderIcon: 'user',
            uploadLabel: 'Add photo',
            editLabel: 'Change photo',
            fontSize: '200',
            onImageChange: { $action: 'profileStore.updateProfileImage', args: ['avatar', { $: 'arg' }] },
            onImageRemove: { $action: 'profileStore.clearProfileImage', args: ['avatar'] },
          },
        },

        // Name & handle display
        {
          type: 'Column',
          props: { gap: '100', mt: '200' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'baseline' },
              children: [
                {
                  type: 'we-text',
                  props: { variant: 'heading-md' },
                  children: [{ $: '`${profileStore.ownProfile.firstName} ${profileStore.ownProfile.lastName}`' }],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $: 'profileStore.ownProfile.handle' },
                then: {
                  type: 'we-text',
                  props: { variant: 'body' },
                  children: [{ $: '`@${profileStore.ownProfile.handle}`' }],
                },
              },
            },
          ],
        },

        // Bio
        {
          type: '$if',
          props: {
            condition: { $: 'profileStore.ownProfile.bio' },
            then: {
              type: 'we-text',
              props: { variant: 'body', lineHeight: '1.5' },
              children: [{ $: 'profileStore.ownProfile.bio' }],
            },
          },
        },

        // Location
        {
          type: '$if',
          props: {
            condition: { $: 'profileStore.ownProfile.location' },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'map-pin', size: '20px' } },
                {
                  type: 'we-text',
                  props: { variant: 'body' },
                  children: [
                    { $: '`${profileStore.ownProfile.location.city}, ${profileStore.ownProfile.location.country}`' },
                  ],
                },
              ],
            },
          },
        },

        // DID
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'key', size: '20px' } },
            {
              type: 'we-text',
              props: { variant: 'body' },
              children: [{ $: 'me.did' }],
            },
          ],
        },

        // ── Editable fields ──
        {
          type: 'Card',
          props: { bg: 'surface-sunken' },
          children: [
            {
              type: 'Row',
              props: { gap: '300', ay: 'center', mb: '200' },
              children: [
                { type: 'we-icon', props: { name: 'pencil' } },
                {
                  type: 'we-text',
                  children: ['Edit Profile'],
                },
              ],
            },
            {
              type: 'Row',
              props: { gap: '300', wrap: true },
              children: [
                {
                  type: 'we-form-field',
                  props: { label: 'First Name' },
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        placeholder: 'First name',
                        value: { $: 'profileStore.ownProfile.firstName' },
                        onChange: {
                          $action: 'profileStore.updateOwnProfile',
                          args: [{ firstName: { $: 'arg.detail' } }],
                        },
                      },
                    },
                  ],
                },
                {
                  type: 'we-form-field',
                  props: { label: 'Last Name' },
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        placeholder: 'Last name',
                        value: { $: 'profileStore.ownProfile.lastName' },
                        onChange: {
                          $action: 'profileStore.updateOwnProfile',
                          args: [{ lastName: { $: 'arg.detail' } }],
                        },
                      },
                    },
                  ],
                },
              ],
            },
            {
              type: 'we-form-field',
              props: { label: 'Handle' },
              children: [
                {
                  type: 'we-input',
                  props: {
                    placeholder: 'yourhandle',
                    value: { $: 'profileStore.ownProfile.handle' },
                    onChange: {
                      $action: 'profileStore.updateOwnProfile',
                      args: [{ handle: { $: 'arg.detail' } }],
                    },
                  },
                },
              ],
            },
            {
              type: 'we-form-field',
              props: { label: 'Bio' },
              children: [
                {
                  type: 'we-textarea',
                  props: {
                    placeholder: 'Tell us about yourself...',
                    value: { $: 'profileStore.ownProfile.bio' },
                    onChange: {
                      $action: 'profileStore.updateOwnProfile',
                      args: [{ bio: { $: 'arg.detail' } }],
                    },
                  },
                },
              ],
            },
            {
              type: 'we-form-field',
              props: { label: 'Location' },
              children: [
                {
                  type: 'we-location-picker',
                  props: {
                    latitude: { $: 'profileStore.ownProfile.location.latitude' },
                    longitude: { $: 'profileStore.ownProfile.location.longitude' },
                    placeholder: 'Pin your location on the globe…',
                    onChange: {
                      $action: 'profileStore.updateOwnLocation',
                      args: [
                        {
                          latitude: { $: 'arg.detail.latitude' },
                          longitude: { $: 'arg.detail.longitude' },
                          city: { $: 'arg.detail.city' },
                          country: { $: 'arg.detail.country' },
                          countryCode: { $: 'arg.detail.countryCode' },
                        },
                      ],
                    },
                  },
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $: 'profileStore.ownProfile.location' },
                then: {
                  type: 'Row',
                  props: { gap: '300', wrap: true },
                  children: [
                    {
                      type: 'we-form-field',
                      props: { label: 'City', flex: '1' },
                      children: [
                        {
                          type: 'we-input',
                          props: {
                            placeholder: 'City',
                            value: { $: 'profileStore.ownProfile.location.city' },
                            onChange: {
                              $action: 'profileStore.updateOwnLocation',
                              args: [{ city: { $: 'arg.detail' } }],
                            },
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
                            placeholder: 'Country',
                            value: { $: 'profileStore.ownProfile.location.country' },
                            onChange: {
                              $action: 'profileStore.updateOwnLocation',
                              args: [{ country: { $: 'arg.detail' } }],
                            },
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
      ],
    },
  ],
};
