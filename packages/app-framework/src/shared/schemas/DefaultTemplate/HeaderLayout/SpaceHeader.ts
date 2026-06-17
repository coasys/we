import type { SchemaNode } from '@we/schema-shared';

export const spaceHeader: SchemaNode = {
  type: '$single',
  props: {
    item: { $query: { model: 'Space', where: { url: { $store: 'adamStore.currentPerspectiveSharedCid' } } } },
    as: 'space',
  },
  children: [
    // ─── Header ───────────────────────────────────────────────────────────────
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
              props: { gap: '300', p: '400', mt: '400' },
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
                  props: { p: '400', gap: '300', maxWidth: '700px' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '700', fontWeight: 'bold' },
                      children: ['$space.name'],
                    },
                    {
                      type: '$if',
                      props: {
                        condition: '$space.description',
                        then: {
                          type: 'we-text',
                          props: { color: 'neutral-700', truncate: true },
                          children: ['$space.description'],
                        },
                        else: {
                          type: 'we-text',
                          props: { color: 'neutral-500', italic: true },
                          children: ['No description...'],
                        },
                      },
                    },
                    {
                      type: 'Row',
                      props: { gap: '400', ay: 'center', mt: '200' },
                      children: [
                        {
                          type: 'AvatarStack',
                          props: {
                            // avatars: [
                            //   { initials: 'Alice Baker', hash: 'abc123' },
                            //   { initials: 'Bob Carter', hash: 'def456' },
                            //   { initials: 'Carol Davis', hash: 'ghi789' },
                            //   { initials: 'Dan Evans', hash: 'jkl012' },
                            //   { initials: 'Eva Foster', hash: 'mno345' },
                            //   { initials: 'Frank Green', hash: 'pqr678' },
                            //   { initials: 'Grace Hill', hash: 'stu901' },
                            //   { initials: 'Harry Irving', hash: 'vwx234' },
                            //   { initials: 'Isla Jones', hash: 'yz1234' },
                            //   { initials: 'Jack King', hash: 'abc567' },
                            // ],
                            avatars: {
                              $map: {
                                items: { $store: 'spaceStore.members' },
                                select: {
                                  image: '$item.avatar',
                                  initials: { $concat: ['$item.firstName', ' ', '$item.lastName'] },
                                },
                              },
                            },
                            max: 5,
                            size: 'sm',
                            ring: '0 0 0 2px var(--we-color-neutral-500)',
                          },
                        },
                        {
                          type: 'Row',
                          props: { gap: '100', ay: 'center' },
                          children: [
                            {
                              type: 'we-number',
                              props: {
                                value: { $count: { items: { $store: 'spaceStore.members' } } },
                                shorten: true,
                                color: 'neutral-600',
                              },
                            },
                            {
                              type: 'we-text',
                              props: { color: 'neutral-500' },
                              children: [
                                {
                                  $plural: {
                                    count: { $count: { items: { $store: 'spaceStore.members' } } },
                                    one: 'Member',
                                    other: 'Members',
                                  },
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
            },
            // Sentinel — zero-height marker used by scrollPast in the sticky nav below
            {
              type: 'div',
              props: { id: 'space-header-sentinel' },
              styles: { height: '0px', pointerEvents: 'none' },
            },
          ],
        },
      ],
    },

    // Sticky navigation
    {
      type: 'Row',
      props: {
        bg: 'neutral-100',
        ax: 'center',
        position: 'sticky',
        zIndex: 'sticky',
        top: '0',
        left: '0',
        borderBottom: '1px solid neutral-200',
      },
      children: [
        // Mini-profile (fades in once the header has scrolled out of view)
        {
          type: '$animate',
          props: {
            scrollPast: 'space-header-sentinel',
            enterTransition: { type: 'fade', duration: 250 },
            exitTransition: { type: 'fade', duration: 200 },
          },
          children: [
            {
              type: 'Row',
              props: { position: 'absolute', left: '16px', top: '0', bottom: '0', ay: 'center', gap: '400' },
              children: [
                {
                  type: 'we-avatar',
                  props: { image: '$space.avatar', initials: '$space.name', size: 'lg' },
                },
                {
                  type: 'we-text',
                  props: { fontWeight: '600' },
                  children: ['$space.name'],
                },
              ],
            },
          ],
        },
        {
          type: 'Column',
          props: { width: '100%', maxWidth: '1200px' },
          children: [
            {
              type: 'Row',
              props: { ay: 'center', ax: 'between', p: '400' },
              children: [
                // Navigation
                {
                  type: 'Row',
                  props: { gap: '200' },
                  children: [
                    {
                      type: '$each',
                      props: {
                        items: [
                          { label: 'About', icon: 'book-open', segment: 'about', path: './about' },
                          { label: 'Cards', icon: 'cards-three', segment: 'cards', path: './cards' },
                          // { label: 'Graph', icon: 'graph', segment: 'graph', path: './graph' },
                          { label: 'Globe', icon: 'globe-hemisphere-west', segment: 'globe', path: './globe' },
                          { label: 'Settings', icon: 'gear', segment: 'settings', path: './settings' },
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
    },
  ],
};
