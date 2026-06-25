import type { SchemaNode } from '@we/schema-shared';

import { cardShell, gridWrapper } from './CardShell.ts';

export const usersList: SchemaNode = gridWrapper([
  {
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
      cardShell({
        header: [
          {
            type: 'Row',
            props: { ay: 'center', gap: '300' },
            children: [
              {
                type: 'we-avatar',
                props: {
                  image: '$user.avatar',
                  initials: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
                  size: 'sm',
                },
              },
              {
                type: 'Column',
                props: { gap: '100', flex: '1' },
                children: [
                  {
                    type: 'we-text',
                    props: { fontWeight: 'semibold' },
                    children: [{ $concat: ['$user.firstName', ' ', '$user.lastName'] }],
                  },
                  {
                    type: '$if',
                    props: {
                      condition: '$user.handle',
                      then: {
                        type: 'we-text',
                        props: { variant: 'label', color: 'neutral-500' },
                        children: [{ $concat: ['@', '$user.handle'] }],
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
        body: [
          {
            type: '$if',
            props: {
              condition: '$user.bio',
              then: {
                type: 'we-text',
                props: { variant: 'label', color: 'neutral-600' },
                children: ['$user.bio'],
              },
            },
          },
        ],
      }),
    ],
  },
]);
