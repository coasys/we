import type { SchemaNode } from '@we/schema-shared';

import { emptyState } from '../../EmptyState.ts';
import { cardList, cardShell } from './CardShell.ts';

export const usersList: SchemaNode = cardList({
  // The roster is already in the store, so this list is filtered in place rather than queried —
  // and its placeholder needs no fade-in delay, since "no members" is known on the first frame.
  items: {
    $filter: {
      items: { $store: 'spaceStore.members' },
      where: { handle: { contains: { $local: 'searchText' } } },
    },
  },
  as: 'user',
  empty: emptyState({ icon: 'user', label: 'members', searchable: true, delay: 0 }),
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
                initials: '$user.name',
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
                  children: ['$user.name'],
                },
                {
                  type: '$if',
                  props: {
                    condition: '$user.handle',
                    then: {
                      type: 'we-text',
                      props: { variant: 'label' },
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
              props: { variant: 'label' },
              children: ['$user.bio'],
            },
          },
        },
      ],
    }),
  ],
});
