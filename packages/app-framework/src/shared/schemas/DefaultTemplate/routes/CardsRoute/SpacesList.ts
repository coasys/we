import type { SchemaNode } from '@we/schema-shared';

import { cardShell, gridWrapper } from './CardShell.ts';

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
            props: { ax: 'between', ay: 'center', width: '100%' },
            $localState: { confirmDeleteOpen: { type: 'boolean', initial: false } },
            children: [
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
                    props: { fontWeight: 'semibold' },
                    children: ['$space.name'],
                  },
                ],
              },
              {
                type: '$if',
                props: {
                  condition: { $eq: [{ $store: 'spaceStore.currentSpace.author' }, { $store: 'adamStore.me.did' }] },
                  then: {
                    type: 'Row',
                    props: { gap: '100' },
                    children: [
                      {
                        type: 'we-button',
                        props: {
                          variant: 'ghost',
                          size: 'sm',
                          onClick: { $setLocal: 'confirmDeleteOpen', value: true },
                        },
                        children: [{ type: 'we-icon', props: { name: 'trash', color: 'danger-400' } }],
                      },
                      {
                        type: '$if',
                        props: {
                          condition: { $local: 'confirmDeleteOpen' },
                          then: {
                            type: 'we-modal',
                            props: { close: { $setLocal: 'confirmDeleteOpen', value: false } },
                            children: [
                              {
                                type: 'we-text',
                                props: { fontWeight: 'semibold' },
                                children: ['Remove from discovery?'],
                              },
                              {
                                type: 'we-text',
                                props: { color: 'neutral-600' },
                                children: [
                                  'This will remove this space from the global discovery listing. The space and all its content will remain intact.',
                                ],
                              },
                              {
                                type: 'Row',
                                props: { ax: 'end', gap: '200' },
                                children: [
                                  {
                                    type: 'we-button',
                                    props: {
                                      variant: 'ghost',
                                      onClick: { $setLocal: 'confirmDeleteOpen', value: false },
                                    },
                                    children: ['Cancel'],
                                  },
                                  {
                                    type: 'we-button',
                                    props: {
                                      variant: 'danger',
                                      onClick: {
                                        $action: 'model.delete',
                                        args: ['Space', '$space.id'],
                                        onSuccess: [{ $setLocal: 'confirmDeleteOpen', value: false }],
                                      },
                                    },
                                    children: ['Remove'],
                                  },
                                ],
                              },
                            ],
                          },
                        },
                      },
                    ],
                  },
                },
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
                props: { variant: 'label', color: 'neutral-500' },
                children: ['$space.description'],
              },
            },
          },
        ],
      }),
    ],
  },
]);
