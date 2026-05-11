/**
 * Profile — Shell template for the agent profile page
 *
 * Displays the current agent's profile with editable cover image,
 * profile picture, and text fields (name, handle, bio, location).
 */

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
        src: { $store: 'adamStore.agentProfile.coverImage' },
        alt: 'Cover image',
        fit: 'cover',
        width: '100%',
        height: '200px',
        aspect: 4 / 1,
        placeholderIcon: 'panorama',
        onImageChange: { $action: 'adamStore.updateCoverImage', args: ['$arg'] },
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
            src: { $store: 'adamStore.agentProfile.avatar' },
            alt: 'Profile picture',
            fit: 'cover',
            width: '120px',
            height: '120px',
            r: '300',
            ring: '0 0 0 3px var(--we-color-neutral-500)',
            placeholderIcon: 'user',
            onImageChange: { $action: 'adamStore.updateAvatarImage', args: ['$arg'] },
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
                        { $store: 'adamStore.agentProfile.firstName' },
                        ' ',
                        { $store: 'adamStore.agentProfile.lastName' },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'adamStore.agentProfile.handle' },
                then: {
                  type: 'we-text',
                  props: { fontSize: '400', color: 'neutral-500' },
                  children: [{ $concat: ['@', { $store: 'adamStore.agentProfile.handle' }] }],
                },
              },
            },
          ],
        },

        // Bio
        {
          type: '$if',
          props: {
            condition: { $store: 'adamStore.agentProfile.bio' },
            then: {
              type: 'we-text',
              props: { fontSize: '400', lineHeight: '1.5' },
              children: [{ $store: 'adamStore.agentProfile.bio' }],
            },
          },
        },

        // Location
        {
          type: '$if',
          props: {
            condition: { $store: 'adamStore.agentProfile.location' },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'map-pin', size: '20px', color: 'neutral-500' } },
                {
                  type: 'we-text',
                  props: { fontSize: '400', color: 'neutral-500' },
                  children: [{ $store: 'adamStore.agentProfile.location.name' }],
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
                        value: { $store: 'adamStore.agentProfile.firstName' },
                        onChange: { $action: 'adamStore.updateAgentProfile', args: [{ firstName: '$arg.detail' }] },
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
                        value: { $store: 'adamStore.agentProfile.lastName' },
                        onChange: {
                          $action: 'adamStore.updateAgentProfile',
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
                    value: { $store: 'adamStore.agentProfile.handle' },
                    onChange: {
                      $action: 'adamStore.updateAgentProfile',
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
                    value: { $store: 'adamStore.agentProfile.bio' },
                    onChange: {
                      $action: 'adamStore.updateAgentProfile',
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
                    latitude: { $store: 'adamStore.agentProfile.location.latitude' },
                    longitude: { $store: 'adamStore.agentProfile.location.longitude' },
                    placeholder: 'Pin your location on the globe…',
                    onChange: {
                      $action: 'adamStore.updateAgentLocation',
                      args: [
                        '$arg.detail.latitude',
                        '$arg.detail.longitude',
                        '$arg.detail.city',
                        '$arg.detail.country',
                        '$arg.detail.countryCode',
                      ],
                    },
                  },
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'adamStore.agentProfile.location' },
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
                            value: { $store: 'adamStore.agentProfile.location.city' },
                            onChange: {
                              $action: 'adamStore.updateAgentLocation',
                              args: [
                                { $store: 'adamStore.agentProfile.location.latitude' },
                                { $store: 'adamStore.agentProfile.location.longitude' },
                                '$arg.detail',
                                { $store: 'adamStore.agentProfile.location.country' },
                                { $store: 'adamStore.agentProfile.location.countryCode' },
                              ],
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
                            value: { $store: 'adamStore.agentProfile.location.country' },
                            onChange: {
                              $action: 'adamStore.updateAgentLocation',
                              args: [
                                { $store: 'adamStore.agentProfile.location.latitude' },
                                { $store: 'adamStore.agentProfile.location.longitude' },
                                { $store: 'adamStore.agentProfile.location.city' },
                                '$arg.detail',
                                { $store: 'adamStore.agentProfile.location.countryCode' },
                              ],
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
