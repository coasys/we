import type { TemplateSchema } from '@we/schema-shared';

export const profileTemplate: TemplateSchema = {
  meta: { name: 'Profile', description: 'Agent profile page', icon: 'user' },
  type: 'Column',
  props: { minWidth: '100%', minHeight: '100%', bg: 'neutral-50', ax: 'center' },
  children: [
    // Cover image
    {
      type: 'EditableImage',
      props: {
        src: { $store: 'adamStore.ownAgent.coverImage' },
        alt: 'Cover image',
        fit: 'cover',
        width: '100%',
        height: '200px',
        aspect: 4 / 1,
        placeholderIcon: 'panorama',
        onImageChange: { $action: 'adamStore.updateProfileImage', args: ['coverImage', '$arg'] },
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
            src: { $store: 'adamStore.ownAgent.avatar' },
            alt: 'Profile picture',
            fit: 'cover',
            width: '120px',
            height: '120px',
            r: '300',
            ring: '0 0 0 3px var(--we-color-neutral-500)',
            placeholderIcon: 'user',
            onImageChange: { $action: 'adamStore.updateProfileImage', args: ['avatar', '$arg'] },
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
                  props: { fontSize: '700', fontWeight: 'bold' },
                  children: [
                    {
                      $concat: [
                        { $store: 'adamStore.ownAgent.firstName' },
                        ' ',
                        { $store: 'adamStore.ownAgent.lastName' },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'adamStore.ownAgent.handle' },
                then: {
                  type: 'we-text',
                  props: { fontSize: '400', color: 'neutral-500' },
                  children: [{ $concat: ['@', { $store: 'adamStore.ownAgent.handle' }] }],
                },
              },
            },
          ],
        },

        // Bio
        {
          type: '$if',
          props: {
            condition: { $store: 'adamStore.ownAgent.bio' },
            then: {
              type: 'we-text',
              props: { fontSize: '400', lineHeight: '1.5' },
              children: [{ $store: 'adamStore.ownAgent.bio' }],
            },
          },
        },

        // Location
        {
          type: '$if',
          props: {
            condition: { $store: 'adamStore.ownAgent.location' },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'map-pin', size: '20px', color: 'neutral-500' } },
                {
                  type: 'we-text',
                  props: { fontSize: '400', color: 'neutral-500' },
                  children: [
                    {
                      $concat: [
                        { $store: 'adamStore.ownAgent.location.city' },
                        ', ',
                        { $store: 'adamStore.ownAgent.location.country' },
                      ],
                    },
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
            { type: 'we-icon', props: { name: 'key', size: '20px', color: 'neutral-500' } },
            {
              type: 'we-text',
              props: { fontSize: '400', color: 'neutral-500' },
              children: [{ $store: 'adamStore.me.did' }],
            },
          ],
        },

        // ── Editable fields ──
        {
          type: 'Column',
          props: { gap: '400', p: '400', r: '300', bg: 'neutral-0' },
          children: [
            {
              type: 'Row',
              props: { gap: '300', ay: 'center', mb: '200' },
              children: [
                { type: 'we-icon', props: { name: 'pencil', color: 'neutral-500' } },
                {
                  type: 'we-text',
                  props: { color: 'neutral-700' },
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
                        value: { $store: 'adamStore.ownAgent.firstName' },
                        onChange: {
                          $action: 'adamStore.updateOwnProfile',
                          args: [{ firstName: '$arg.detail' }],
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
                        value: { $store: 'adamStore.ownAgent.lastName' },
                        onChange: {
                          $action: 'adamStore.updateOwnProfile',
                          args: [{ lastName: '$arg.detail' }],
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
                    value: { $store: 'adamStore.ownAgent.handle' },
                    onChange: {
                      $action: 'adamStore.updateOwnProfile',
                      args: [{ handle: '$arg.detail' }],
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
                    value: { $store: 'adamStore.ownAgent.bio' },
                    onChange: {
                      $action: 'adamStore.updateOwnProfile',
                      args: [{ bio: '$arg.detail' }],
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
                    latitude: { $store: 'adamStore.ownAgent.location.latitude' },
                    longitude: { $store: 'adamStore.ownAgent.location.longitude' },
                    placeholder: 'Pin your location on the globe…',
                    onChange: {
                      $action: 'adamStore.updateAgentLocation',
                      args: [
                        {
                          latitude: '$arg.detail.latitude',
                          longitude: '$arg.detail.longitude',
                          city: '$arg.detail.city',
                          country: '$arg.detail.country',
                          countryCode: '$arg.detail.countryCode',
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
                condition: { $store: 'adamStore.ownAgent.location' },
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
                            value: { $store: 'adamStore.ownAgent.location.city' },
                            onChange: {
                              $action: 'adamStore.updateAgentLocation',
                              args: [{ city: '$arg.detail' }],
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
                            value: { $store: 'adamStore.ownAgent.location.country' },
                            onChange: {
                              $action: 'adamStore.updateAgentLocation',
                              args: [{ country: '$arg.detail' }],
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
