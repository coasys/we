import type { SchemaNode } from '@we/schema-shared';

export const spaceSidebar: SchemaNode = {
  type: 'Column',
  props: { flex: '0 0 400px', gap: '200', bg: 'neutral-25' },
  children: [
    // Cover image
    {
      type: 'EditableImage',
      props: {
        src: { $store: 'spaceStore.currentSpace.coverImage' },
        alt: 'Cover image',
        fit: 'cover',
        width: '100%',
        height: '180px',
        aspect: 4 / 1,
        placeholderIcon: 'panorama',
        uploadLabel: 'Upload cover image',
        editLabel: 'Change cover image',
        onImageChange: { $action: 'spaceStore.updateSpaceImage', args: ['coverImage', '$arg'] },
      },
    },
    {
      type: 'Column',
      props: { mt: '-65px', width: '100%', ax: 'center' },
      children: [
        // Profile picture
        {
          type: 'EditableImage',
          props: {
            src: { $store: 'spaceStore.currentSpace.avatar' },
            alt: 'Profile picture',
            fit: 'cover',
            width: '120px',
            height: '120px',
            r: 'pill',
            ring: '0 0 0 2px var(--we-ring-color)',
            placeholderIcon: 'users-three',
            uploadLabel: 'Add image',
            editLabel: 'Change image',
            fontSize: '200',
            onImageChange: { $action: 'spaceStore.updateSpaceImage', args: ['avatar', '$arg'] },
          },
        },
      ],
    },
    // Space Details
    {
      type: 'Column',
      props: { p: '400', gap: '200', ax: 'center' },
      children: [
        {
          type: 'we-text',
          props: {
            textAlign: 'center',
            loading: { $not: { $store: 'spaceStore.currentSpace' } },
          },
          children: [{ $store: 'spaceStore.currentSpace.name' }],
        },
        {
          type: 'we-text',
          props: {
            variant: 'body',
            textAlign: 'center',
            mb: '400',
            loading: { $not: { $store: 'spaceStore.currentSpace' } },
          },
          children: [{ $store: 'spaceStore.currentSpace.description' }],
        },
      ],
    },
    // Navigation
    {
      type: 'Column',
      props: { p: '400', gap: '200', ax: 'start' },
      children: [
        {
          type: '$each',
          props: {
            items: [
              { label: 'Globe', icon: 'globe-hemisphere-west', segment: 'globe', path: './globe' },
              // { label: 'Graph', icon: 'graph', segment: 'graph', path: './graph' },
              { label: 'Cards', icon: 'cards-three', segment: 'cards', path: './cards' },
              { label: 'Flux', icon: 'chat-circle', segment: 'flux', path: './flux' },
            ],
            as: 'view',
          },
          children: [
            {
              type: 'we-button',
              props: {
                variant: {
                  $if: {
                    condition: { $eq: [{ $store: 'routeStore.segments.2' }, '$view.segment'] },
                    then: 'primary',
                    else: 'ghost',
                  },
                },
                onClick: { $action: 'routeStore.navigate', args: ['$view.path'] },
              },
              children: [
                { type: 'we-icon', props: { name: '$view.icon' } },
                { type: 'we-text', children: ['$view.label'] },
              ],
            },
          ],
        },
      ],
    },
  ],
};
