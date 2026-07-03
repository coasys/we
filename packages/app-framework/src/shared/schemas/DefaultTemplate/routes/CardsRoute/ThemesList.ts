import type { SchemaNode } from '@we/schema-shared';

import { cardShell, gridWrapper } from './CardShell.ts';

export const themesList: SchemaNode = {
  type: 'Column',
  props: { gap: '0', width: '100%' },
  children: [
    gridWrapper([
      {
        type: '$each',
        props: {
          items: {
            $query: {
              model: 'Theme',
              where: { name: { contains: { $local: 'searchText' } } },
              order: { createdAt: { $local: 'sortDirection' } },
            },
          },
          as: 'theme',
        },
        children: [
          cardShell({
            header: [
              {
                type: 'Row',
                props: { ax: 'between', ay: 'center', width: '100%' },
                children: [
                  // Left: icon + name + author
                  {
                    type: '$agent',
                    props: { did: '$theme.author', as: 'themeAuthor' },
                    children: [
                      {
                        type: 'Row',
                        props: { ay: 'center', gap: '300' },
                        children: [
                          {
                            type: 'we-avatar',
                            props: { icon: '$theme.icon', size: 'sm' },
                          },
                          {
                            type: 'Column',
                            props: { gap: '100' },
                            children: [
                              {
                                type: 'we-text',
                                props: { fontWeight: 'semibold' },
                                children: ['$theme.name'],
                              },
                              {
                                type: 'we-text',
                                props: { variant: 'label' },
                                children: [{ $concat: ['@', '$themeAuthor.handle'] }],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  // Right: action buttons
                  {
                    type: 'Row',
                    props: { gap: '100' },
                    children: [
                      // Apply — switch to this theme (hidden if already active)
                      {
                        type: '$if',
                        props: {
                          condition: {
                            $ne: ['$theme.id', { $store: 'themeStore.currentThemeId' }],
                          },
                          then: {
                            type: 'we-button',
                            props: {
                              variant: 'ghost',
                              size: 'sm',
                              onClick: {
                                $action: 'themeStore.setCurrentTheme',
                                args: ['$theme.id'],
                              },
                            },
                            children: ['Apply'],
                          },
                        },
                      },
                      // Set as default — only the space author, only if not already default
                      {
                        type: '$if',
                        props: {
                          condition: {
                            $and: [
                              { $eq: [{ $store: 'spaceStore.currentSpace.author' }, { $store: 'adamStore.me.did' }] },
                              { $ne: ['$theme.id', { $store: 'spaceStore.currentSpace.defaultThemeId' }] },
                            ],
                          },
                          then: {
                            type: 'we-button',
                            props: {
                              variant: 'outline',
                              size: 'sm',
                              onClick: {
                                $action: 'model.update',
                                args: [
                                  'Space',
                                  { $store: 'spaceStore.currentSpace.id' },
                                  { defaultThemeId: '$theme.id' },
                                ],
                              },
                            },
                            children: ['Set as default'],
                          },
                        },
                      },
                      // Delete — only the theme author
                      {
                        type: '$if',
                        props: {
                          condition: {
                            $eq: ['$theme.author', { $store: 'adamStore.me.did' }],
                          },
                          then: {
                            type: 'we-button',
                            props: {
                              variant: 'ghost',
                              size: 'sm',
                              onClick: {
                                $action: 'model.delete',
                                args: ['Theme', '$theme.id'],
                              },
                            },
                            children: [{ type: 'we-icon', props: { name: 'trash' } }],
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
                type: 'Row',
                props: { gap: '200', ay: 'center' },
                children: [
                  {
                    type: 'we-badge',
                    props: { variant: 'neutral' },
                    children: [{ $concat: ['v', '$theme.version'] }],
                  },
                  {
                    type: '$if',
                    props: {
                      condition: {
                        $eq: ['$theme.id', { $store: 'spaceStore.currentSpace.defaultThemeId' }],
                      },
                      then: {
                        type: 'we-badge',
                        props: { variant: 'primary' },
                        children: ['Space default'],
                      },
                    },
                  },
                ],
              },
            ],
          }),
        ],
      },
    ]),
  ],
};
