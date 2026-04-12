/**
 * Profile — System-level agent profile page
 *
 * Rendered by the shell when systemPage === 'profile'.
 * Not a route — does not conflict with template-defined routes.
 *
 * Displays the current agent's profile with editable cover image,
 * profile picture, and text fields (name, handle, bio, location).
 */

import type { SchemaNode } from '@we/schema-shared';

export const profilePage: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', bg: 'neutral-50', overflow: 'auto' },
  children: [
    // ── Header bar (title + close button) ──
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', ax: 'between', px: '600', pt: '600' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'user', size: '20px', color: 'neutral-500' } },
            { type: 'we-text', props: { fontSize: '600', fontWeight: 'bold' }, children: ['Profile'] },
          ],
        },
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            onClick: { $action: 'adamStore.setSystemPage', args: [null] },
          },
          children: [{ type: 'we-icon', props: { name: 'x', size: '20px' } }],
        },
      ],
    },

    // ── Cover image + overlapping profile picture ──
    {
      type: 'Column',
      props: { width: '100%', px: '600', pt: '400' },
      children: [
        // Cover image container (relative positioned for overlap)
        {
          type: 'Column',
          props: { width: '100%', position: 'relative' },
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
                r: '400',
                placeholderIcon: 'panorama',
                onImageChange: { $action: 'adamStore.updateCoverImage', args: ['$arg'] },
              },
            },
            // Profile picture — overlaps cover by half (absolute positioned)
            {
              type: 'Column',
              props: {
                position: 'absolute',
                bottom: '-60px',
                left: '24px',
                zIndex: 1,
              },
              children: [
                {
                  type: 'EditableImage',
                  props: {
                    src: { $store: 'adamStore.agentProfile.profileImage' },
                    alt: 'Profile picture',
                    fit: 'cover',
                    width: '120px',
                    height: '120px',
                    r: '300',
                    placeholderIcon: 'user',
                    onImageChange: { $action: 'adamStore.updateProfileImage', args: ['$arg'] },
                  },
                },
              ],
            },
          ],
        },
      ],
    },

    // ── Spacer for profile picture overlap ──
    { type: 'Column', props: { height: '72px', minHeight: '72px' } },

    // ── Profile info section ──
    {
      type: 'Column',
      props: { gap: '600', px: '600', pb: '600' },
      children: [
        // Name & handle display
        {
          type: 'Column',
          props: { gap: '100' },
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
              props: { gap: '100', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'map-pin', size: '16px', color: 'neutral-400' } },
                {
                  type: 'we-text',
                  props: { fontSize: '300', color: 'neutral-500' },
                  children: [{ $store: 'adamStore.agentProfile.location' }],
                },
              ],
            },
          },
        },

        // ── Editable fields ──
        {
          type: 'Column',
          props: { gap: '400', p: '400', r: '300', bg: 'neutral-100' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '500', fontWeight: 'semibold' },
              children: ['Edit Profile'],
            },
            {
              type: 'Row',
              props: { gap: '300' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '100', flex: '1' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '200', fontWeight: 'medium', color: 'neutral-500' },
                      children: ['First Name'],
                    },
                    {
                      type: 'we-input',
                      props: {
                        placeholder: 'First name',
                        value: { $store: 'adamStore.agentProfile.firstName' },
                        onChange: {
                          $action: 'adamStore.updateAgentProfile',
                          args: [{ firstName: '$arg.detail' }],
                        },
                      },
                    },
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '100', flex: '1' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '200', fontWeight: 'medium', color: 'neutral-500' },
                      children: ['Last Name'],
                    },
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
              type: 'Column',
              props: { gap: '100' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '200', fontWeight: 'medium', color: 'neutral-500' },
                  children: ['Handle'],
                },
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
              type: 'Column',
              props: { gap: '100' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '200', fontWeight: 'medium', color: 'neutral-500' },
                  children: ['Bio'],
                },
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
              type: 'Column',
              props: { gap: '100' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '200', fontWeight: 'medium', color: 'neutral-500' },
                  children: ['Location'],
                },
                {
                  type: 'we-input',
                  props: {
                    placeholder: 'City, Country',
                    value: { $store: 'adamStore.agentProfile.location' },
                    onChange: {
                      $action: 'adamStore.updateAgentProfile',
                      args: [{ location: '$arg.detail' }],
                    },
                  },
                },
              ],
            },
          ],
        },

        // ── Agent Identity (DID) ──
        {
          type: 'Column',
          props: { gap: '300', p: '400', r: '300', bg: 'neutral-100' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '500', fontWeight: 'semibold' },
              children: ['Identity'],
            },
            {
              type: 'Column',
              props: { gap: '100' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '200', fontWeight: 'medium', color: 'neutral-500' },
                  children: ['DID'],
                },
                {
                  type: 'we-text',
                  props: { fontSize: '300', fontFamily: 'mono', styles: { 'word-break': 'break-all' } },
                  children: [{ $store: 'adamStore.me.did' }],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'adamStore.me.directMessageLanguage' },
                then: {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '200', fontWeight: 'medium', color: 'neutral-500' },
                      children: ['Direct Message Language'],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '300', fontFamily: 'mono', styles: { 'word-break': 'break-all' } },
                      children: [{ $store: 'adamStore.me.directMessageLanguage' }],
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
