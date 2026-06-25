import type { RouteSchema } from '@we/schema-shared';

export const aboutRoute: RouteSchema = {
  path: '/about',
  type: 'Column',
  props: { width: '100%', ax: 'center', height: 'calc(100vh - 72px)' },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: '1200px', gap: '500', px: '400', pt: '500' },
      children: [
        // ─── Name & Description ───────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '500', p: '500', bg: 'neutral-100', r: '400', border: '1px solid neutral-200' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '700', fontWeight: 'bold', color: 'primary-700' },
              children: ['About this space'],
            },

            // Name field
            {
              type: 'Column',
              props: { gap: '100' },
              children: [
                { type: 'we-text', props: { fontSize: '500', color: 'neutral-600' }, children: ['Name'] },
                {
                  type: 'we-text',
                  props: { fontSize: '700', fontWeight: 'bold' },
                  children: [{ $store: 'spaceStore.currentSpace.name' }],
                },
              ],
            },

            // Description field
            {
              type: 'Column',
              props: { gap: '100' },
              children: [
                { type: 'we-text', props: { fontSize: '500', color: 'neutral-600' }, children: ['Description'] },
                {
                  type: '$if',
                  props: {
                    condition: { $store: 'spaceStore.currentSpace.description' },
                    then: { type: 'we-text', children: [{ $store: 'spaceStore.currentSpace.description' }] },
                    else: {
                      type: 'we-text',
                      props: { color: 'neutral-500', italic: true },
                      children: ['No description...'],
                    },
                  },
                },
              ],
            },

            // Access
            {
              type: 'Row',
              props: { ay: 'center', gap: '400', py: '100' },
              children: [
                { type: 'we-icon', props: { name: 'lock-simple', color: 'primary-600' } },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '300' },
                      children: [
                        {
                          type: 'we-text',
                          props: { color: 'neutral-700', fontWeight: 'bold' },
                          children: ['Access:'],
                        },
                        {
                          type: 'we-text',
                          props: { fontWeight: 'bold' },
                          children: [
                            {
                              $if: {
                                condition: { $eq: [{ $store: 'spaceStore.currentSpace.access' }, 'shared'] },
                                then: 'Shared',
                                else: 'Personal',
                              },
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: 'we-text',
                      props: { color: 'neutral-700', fontSize: '400' },
                      children: [
                        {
                          $if: {
                            condition: { $eq: [{ $store: 'spaceStore.currentSpace.access' }, 'shared'] },
                            then: 'Joinable by anyone with the link',
                            else: 'Only visible to you',
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },

            // Discovery
            {
              type: 'Row',
              props: { ay: 'center', gap: '400', py: '100' },
              children: [
                { type: 'we-icon', props: { name: 'globe', color: 'primary-600' } },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '300' },
                      children: [
                        {
                          type: 'we-text',
                          props: { color: 'neutral-700', fontWeight: 'bold' },
                          children: ['Discovery:'],
                        },
                        {
                          type: 'we-text',
                          props: { fontWeight: 'bold' },
                          children: [
                            {
                              $if: {
                                condition: { $eq: [{ $store: 'spaceStore.currentSpace.discovery' }, 'listed'] },
                                then: 'Listed',
                                else: 'Hidden',
                              },
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: 'we-text',
                      props: { color: 'neutral-700', fontSize: '400' },
                      children: [
                        {
                          $if: {
                            condition: { $eq: [{ $store: 'spaceStore.currentSpace.discovery' }, 'listed'] },
                            then: 'Appears on the WE discovery globe',
                            else: 'Not shown in global discovery',
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },

            // Location (if set)
            {
              type: '$if',
              props: {
                condition: { $store: 'spaceStore.currentSpace.location' },
                then: {
                  type: 'Row',
                  props: { ay: 'center', gap: '400', py: '100' },
                  children: [
                    { type: 'we-icon', props: { name: 'map-pin', color: 'primary-600' } },
                    {
                      type: 'Column',
                      props: { gap: '100' },
                      children: [
                        {
                          type: 'Row',
                          props: { gap: '300' },
                          children: [
                            {
                              type: 'we-text',
                              props: { color: 'neutral-700', fontWeight: 'bold' },
                              children: ['Location:'],
                            },
                            {
                              type: 'we-text',
                              props: { fontWeight: 'bold' },
                              children: [
                                {
                                  $concat: [
                                    { $store: 'spaceStore.currentSpace.location.city' },
                                    ', ',
                                    { $store: 'spaceStore.currentSpace.location.country' },
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
              },
            },

            // History
            {
              type: 'Row',
              props: { ay: 'center', gap: '400', py: '100' },
              children: [
                { type: 'we-icon', props: { name: 'clock', color: 'primary-600' } },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '300' },
                      children: [
                        {
                          type: 'we-text',
                          props: { color: 'neutral-700', fontWeight: 'bold' },
                          children: ['Created:'],
                        },
                        {
                          type: 'we-timestamp',
                          props: {
                            value: { $store: 'spaceStore.currentSpace.createdAt' },
                            relative: true,
                            fontWeight: 'bold',
                          },
                        },
                      ],
                    },
                    {
                      type: 'Row',
                      props: { gap: '200', ay: 'center' },
                      children: [
                        { type: 'we-text', props: { color: 'neutral-700', fontSize: '400' }, children: ['By'] },
                        {
                          type: '$agent',
                          props: { did: { $store: 'spaceStore.currentSpace.author' }, as: 'agent' },
                          children: [
                            {
                              type: 'we-avatar',
                              props: {
                                image: '$agent.avatar',
                                hash: { $store: 'spaceStore.currentSpace.author' },
                                size: 'xs',
                              },
                            },
                            {
                              type: 'we-text',
                              props: { color: 'neutral-700', fontSize: '400', truncate: true, maxWidth: '160px' },
                              children: [{ $concat: ['$agent.firstName', ' ', '$agent.lastName'] }],
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
    },
  ],
};
