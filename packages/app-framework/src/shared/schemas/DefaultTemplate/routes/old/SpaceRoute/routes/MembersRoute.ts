import type { RouteSchema } from '@we/schema-shared';

export const membersRoute: RouteSchema = {
  path: '/members',
  type: 'Column',
  props: { gap: '300' },
  children: [
    {
      type: 'Column',
      props: { p: '600', ay: 'center', ax: 'center', gap: '200' },
      children: [
        { type: 'we-icon', props: { name: 'users', color: 'neutral-300', size: '48px' } },
        {
          type: 'we-text',
          props: { fontSize: '400', color: 'neutral-400' },
          children: ['Members list coming soon'],
        },
      ],
    },
  ],
};
