import type { RouteSchema } from '@we/schema-shared';

export const membersRoute: RouteSchema = {
  path: '/members',
  type: 'Column',
  props: { width: '100%', ax: 'center', height: 'calc(100vh - 72px)', overflow: 'auto' },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: '900px', gap: '400', px: '400', pt: '500' },
      children: [
        // Page heading
        {
          type: 'Row',
          props: { ay: 'center', gap: '300', pb: '200' },
          children: [
            { type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Members'] },
            {
              type: 'we-text',
              props: { fontSize: '400', color: 'neutral-500' },
              children: [{ $concat: ['(', { $count: { items: { $store: 'spaceStore.members' } } }, ')'] }],
            },
          ],
        },

        // Member grid
        {
          type: '$each',
          props: { items: { $store: 'spaceStore.members' }, as: 'member' },
          children: [
            {
              type: 'Row',
              props: { ay: 'center', gap: '400', p: '400', bg: 'neutral-25', r: '400', width: '100%' },
              children: [
                // Avatar
                {
                  type: '$if',
                  props: {
                    condition: '$member.avatar',
                    then: {
                      type: 'we-image',
                      props: { src: '$member.avatar', width: '48px', height: '48px', fit: 'cover', r: 'full' },
                    },
                    else: {
                      type: 'we-icon',
                      props: { name: 'user-circle', size: '48px', color: 'neutral-400' },
                    },
                  },
                },

                // Name + handle
                {
                  type: 'Column',
                  props: { gap: '100', flex: '1' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '400', fontWeight: '600', color: 'neutral-800' },
                      children: [{ $concat: ['$member.firstName', ' ', '$member.lastName'] }],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '300', color: 'neutral-500' },
                      children: [{ $concat: ['@', '$member.handle'] }],
                    },
                  ],
                },

                // Bio (if present)
                {
                  type: '$if',
                  props: {
                    condition: '$member.bio',
                    then: {
                      type: 'we-text',
                      props: { fontSize: '300', color: 'neutral-600', maxWidth: '300px' },
                      children: ['$member.bio'],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
