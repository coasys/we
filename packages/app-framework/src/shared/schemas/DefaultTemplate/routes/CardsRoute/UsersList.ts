import type { SchemaNode } from '@we/schema-shared';

export const usersList: SchemaNode = {
  type: '$each',
  props: {
    items: {
      $filter: {
        items: { $store: 'spaceStore.members' },
        where: { handle: { contains: { $local: 'searchText' } } },
      },
    },
    as: 'user',
  },
  children: [
    {
      type: 'Row',
      props: {
        ay: 'center',
        gap: '400',
        p: '400',
        bg: 'neutral-100',
        r: '400',
        border: '1px solid neutral-200',
      },
      children: [
        {
          type: 'we-avatar',
          props: {
            image: '$user.avatar',
            initials: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
            size: 'md',
          },
        },
        {
          type: 'Column',
          props: { gap: '100', flex: '1' },
          children: [
            {
              type: 'we-text',
              props: { fontWeight: '600', color: 'neutral-800' },
              children: [{ $concat: ['$user.firstName', ' ', '$user.lastName'] }],
            },
            {
              type: '$if',
              props: {
                condition: '$user.handle',
                then: {
                  type: 'we-text',
                  props: { fontSize: '300', color: 'neutral-500' },
                  children: [{ $concat: ['@', '$user.handle'] }],
                },
              },
            },
            {
              type: '$if',
              props: {
                condition: { $and: ['$user.bio', { $ne: [{ $local: 'displayMode' }, 'compact'] }] },
                then: {
                  type: 'we-text',
                  props: { fontSize: '300', color: 'neutral-600' },
                  children: ['$user.bio'],
                },
              },
            },
          ],
        },
      ],
    },
  ],
};
