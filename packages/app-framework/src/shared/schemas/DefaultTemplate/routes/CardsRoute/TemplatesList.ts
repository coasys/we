import type { SchemaNode } from '@we/schema-shared';

import { cardShell, gridWrapper } from './CardShell.ts';

export const templatesList: SchemaNode = {
  type: 'Column',
  props: { gap: '0', width: '100%' },
  children: [
    gridWrapper([
      {
        type: '$each',
        props: {
          items: {
            $query: {
              model: 'Template',
              where: { name: { contains: { $local: 'searchText' } } },
              order: { createdAt: { $local: 'sortBy' } },
            },
          },
          as: 'template',
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
                    props: { did: '$template.author', as: 'templateAuthor' },
                    children: [
                      {
                        type: 'Row',
                        props: { ay: 'center', gap: '300' },
                        children: [
                          {
                            type: 'we-avatar',
                            props: { icon: 'layout', size: 'sm' },
                          },
                          {
                            type: 'Column',
                            props: { gap: '100' },
                            children: [
                              {
                                type: 'we-text',
                                props: { fontWeight: 'semibold' },
                                children: ['$template.name'],
                              },
                              {
                                type: 'we-text',
                                props: { variant: 'label' },
                                children: [{ $concat: ['@', '$templateAuthor.handle'] }],
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
                      // Apply — switch to this template (hidden if already active)
                      {
                        type: '$if',
                        props: {
                          condition: {
                            $ne: ['$template.slug', { $store: 'templateStore.currentTemplate.id' }],
                          },
                          then: {
                            type: 'we-button',
                            props: {
                              variant: 'ghost',
                              size: 'sm',
                              onClick: {
                                $action: 'templateStore.switchTemplate',
                                args: ['$template.slug'],
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
                              { $ne: ['$template.slug', { $store: 'spaceStore.currentSpace.defaultTemplateId' }] },
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
                                  { defaultTemplateId: '$template.slug' },
                                ],
                              },
                            },
                            children: ['Set as default'],
                          },
                        },
                      },
                      // Delete — only the template author
                      {
                        type: '$if',
                        props: {
                          condition: {
                            $eq: ['$template.author', { $store: 'adamStore.me.did' }],
                          },
                          then: {
                            type: 'we-button',
                            props: {
                              variant: 'ghost',
                              size: 'sm',
                              onClick: {
                                $action: 'model.delete',
                                args: ['Template', '$template.id'],
                                onSuccess: [{ $action: 'templateStore.refreshSpaceTemplates' }],
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
                    children: [{ $concat: ['v', '$template.version'] }],
                  },
                  {
                    type: '$if',
                    props: {
                      condition: {
                        $eq: ['$template.slug', { $store: 'spaceStore.currentSpace.defaultTemplateId' }],
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
