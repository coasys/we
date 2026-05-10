import type { RouteSchema } from '@we/schema-shared';

export const fluxRoute: RouteSchema = {
  path: '/flux',
  type: 'Column',
  props: { p: '600', gap: '500', ax: 'start' },
  $localState: { createOpen: { type: 'boolean', initial: false } },
  children: [
    // Title
    { type: 'we-text', props: { fontSize: '600', fontWeight: 'bold' }, children: ['Flux'] },

    {
      type: '$each',
      props: {
        items: {
          $query: {
            model: 'Message',
            perspectiveStore: 'spaceStore.perspective',
            order: { timestamp: 'desc' },
            limit: 50,
          },
        },
        as: 'message',
      },
      children: [
        {
          type: 'Column',
          props: { bg: 'neutral-0', border: '1px solid neutral-200', r: '300', p: '400', gap: '200', mb: '200' },
          children: [
            {
              type: 'we-html',
              props: { content: '$message.body' },
            },
          ],
        },
      ],
    },
  ],
};
