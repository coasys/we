import type { SchemaNode } from '@we/schema-shared';

export const spacesList: SchemaNode = {
  type: '$each',
  props: {
    items: {
      $query: {
        model: 'Space',
        where: { name: { contains: { $local: 'searchText' } } },
        order: { createdAt: { $local: 'sortBy' } },
      },
    },
    as: 'space',
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
            image: '$space.avatar',
            initials: '$space.name',
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
              children: ['$space.name'],
            },
            {
              type: '$if',
              props: {
                condition: {
                  $and: ['$space.description', { $ne: [{ $local: 'displayMode' }, 'compact'] }],
                },
                then: {
                  type: 'we-text',
                  props: { fontSize: '300', color: 'neutral-500' },
                  children: ['$space.description'],
                },
              },
            },
          ],
        },
      ],
    },
  ],
};
