import type { RouteSchema } from '@we/schema-shared';

export const aboutRoute: RouteSchema = {
  path: '/about',
  type: 'Column',
  props: { gap: '400' },
  children: [
    {
      type: 'Column',
      props: { p: '400', r: '400', bg: 'neutral-100', gap: '300' },
      children: [
        {
          type: 'Row',
          props: { gap: '200' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
              children: ['Name'],
            },
            {
              type: 'we-text',
              props: { fontSize: '400' },
              children: [{ $store: 'spaceStore.space.name' }],
            },
          ],
        },
        {
          type: 'Row',
          props: { gap: '200' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
              children: ['Description'],
            },
            {
              type: 'we-text',
              props: { fontSize: '400' },
              children: [
                {
                  $if: {
                    condition: { $store: 'spaceStore.space.description' },
                    then: { $store: 'spaceStore.space.description' },
                    else: 'No description',
                  },
                },
              ],
            },
          ],
        },
        {
          type: 'Row',
          props: { gap: '200' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
              children: ['UUID'],
            },
            {
              type: 'we-text',
              props: { fontSize: '400', fontFamily: 'mono', color: 'neutral-400' },
              children: [{ $store: 'spaceStore.space.uuid' }],
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $store: 'spaceStore.space.visibility' },
            then: {
              type: 'Row',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
                  children: ['Visibility'],
                },
                {
                  type: 'we-text',
                  props: { fontSize: '400' },
                  children: [{ $store: 'spaceStore.space.visibility' }],
                },
              ],
            },
          },
        },
      ],
    },
  ],
};
