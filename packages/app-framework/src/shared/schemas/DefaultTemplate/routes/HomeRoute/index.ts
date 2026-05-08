import type { RouteSchema } from '@we/schema-shared';

export const homeRoute: RouteSchema = {
  path: '/home',
  type: 'Column',
  children: [
    { type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Welcome to the Home Route'] },
  ],
};
