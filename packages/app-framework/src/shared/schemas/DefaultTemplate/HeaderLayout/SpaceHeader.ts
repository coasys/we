import type { SchemaNode } from '@we/schema-shared';

export const spaceHeader: SchemaNode = {
  type: '$single',
  props: {
    item: { $query: { model: 'Space', where: { uuid: { $store: 'adamStore.currentPerspective.uuid' } } } },
    as: 'space',
  },
  children: [
    {
      type: 'Row',
      props: { bg: 'neutral-100', ax: 'center' },
      children: [
        {
          type: 'Column',
          props: { width: '100%', maxWidth: '1200px' },
          children: [
            // Cover image
            {
              type: 'EditableImage',
              props: {
                src: '$space.coverImage',
                alt: 'Cover image',
                fit: 'cover',
                width: '100%',
                height: '300px',
                rb: '600',
                aspect: 4 / 1,
                placeholderIcon: 'panorama',
                onImageChange: { $action: 'spaceStore.updateSpaceImage', args: ['coverImage', '$arg'] },
              },
            },
            {
              type: 'Row',
              props: { gap: '300', p: '600' },
              children: [
                // Profile picture
                {
                  type: 'EditableImage',
                  props: {
                    src: '$space.avatar',
                    alt: 'Profile picture',
                    fit: 'cover',
                    width: '120px',
                    height: '120px',
                    r: 'pill',
                    ring: '0 0 0 3px var(--we-color-neutral-500)',
                    placeholderIcon: 'users-three',
                    onImageChange: { $action: 'spaceStore.updateSpaceImage', args: ['avatar', '$arg'] },
                  },
                },
                // Space Details
                {
                  type: 'Column',
                  props: { p: '400', gap: '200', ax: 'center' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '600', textAlign: 'center' },
                      children: ['$space.name'],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '400', textAlign: 'center', mb: '400' },
                      children: ['$space.description'],
                    },
                  ],
                },
              ],
            },

            // Navigation
            {
              type: 'Row',
              props: { p: '400', gap: '200' },
              children: [
                {
                  type: '$each',
                  props: {
                    items: [
                      { label: 'About', icon: 'book-open', segment: 'about', path: './about' },
                      { label: 'Cards', icon: 'cards-three', segment: 'cards', path: './cards' },
                      { label: 'Graph', icon: 'graph', segment: 'graph', path: './graph' },
                      { label: 'Globe', icon: 'globe-hemisphere-west', segment: 'globe', path: './globe' },
                      // { label: 'Signals', icon: 'heart', segment: 'signals', path: './signals' },
                      // { label: 'Flux', icon: 'chat-circle', segment: 'flux', path: './flux' },
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
                        { type: 'we-text', props: { fontSize: '500' }, children: ['$view.label'] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
