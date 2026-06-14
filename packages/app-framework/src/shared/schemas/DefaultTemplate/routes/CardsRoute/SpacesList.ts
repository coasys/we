import type { SchemaNode } from '@we/schema-shared';

import { cardShell, gridWrapper } from './CardShell';

export const spacesList: SchemaNode = gridWrapper([
  {
    type: '$each',
    props: {
      items: {
        $query: {
          model: 'Space',
          where: {
            url: { not: { $store: 'adamStore.currentPerspectiveSharedCid' } },
            name: { contains: { $local: 'searchText' } },
          },
          order: { createdAt: { $local: 'sortBy' } },
        },
      },
      as: 'space',
    },
    children: [
      cardShell({
        header: [
          {
            type: 'Row',
            props: { ay: 'center', gap: '300' },
            children: [
              {
                type: 'we-avatar',
                props: { image: '$space.avatar', initials: '$space.name', size: 'sm' },
              },
              {
                type: 'we-text',
                props: { fontWeight: '600', color: 'neutral-800' },
                children: ['$space.name'],
              },
            ],
          },
        ],
        body: [
          {
            type: '$if',
            props: {
              condition: '$space.description',
              then: {
                type: 'we-text',
                props: { fontSize: '300', color: 'neutral-500' },
                children: ['$space.description'],
              },
            },
          },
        ],
      }),
    ],
  },
]);
