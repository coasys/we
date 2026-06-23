import type { SchemaNode } from '@we/schema-shared';

export const marketplaceBrowser: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  $localState: {
    search: { type: 'string', initial: '' },
  },
  $queries: {
    marketplaceTemplates: {
      model: 'Template',
      perspective: 'adamStore.marketplacePerspective',
      subscribe: true,
    },
  },
  children: [
    {
      type: 'SearchInput',
      props: {
        placeholder: 'Search marketplace…',
        value: { $local: 'search' },
        onSearch: { $setLocal: 'search', from: '$arg' },
        width: '100%',
      },
    },
    {
      type: '$if',
      props: {
        condition: {
          $gt: [{ $count: { items: { $local: 'marketplaceTemplates' } } }, 0],
        },
        then: {
          type: 'Column',
          props: { gap: '200' },
          children: [
            {
              type: '$each',
              props: {
                items: {
                  $filter: {
                    items: { $local: 'marketplaceTemplates' },
                    where: { name: { contains: { $local: 'search' } } },
                  },
                },
                as: 'marketplaceTemplate',
              },
              children: [
                {
                  type: 'Row',
                  props: {
                    ay: 'center',
                    ax: 'between',
                    p: '300',
                    r: '300',
                    border: '1px solid neutral-200',
                    bg: 'neutral-0',
                    gap: '300',
                  },
                  children: [
                    // Left: icon + name + author
                    {
                      type: 'Row',
                      props: { ay: 'center', gap: '300', flex: '1', minWidth: '0' },
                      children: [
                        { type: 'we-icon', props: { name: 'layout', color: 'primary-500' } },
                        {
                          type: 'Column',
                          props: { gap: '50', flex: '1', minWidth: '0' },
                          children: [
                            {
                              type: 'we-text',
                              props: { fontWeight: '600', truncate: true },
                              children: ['$marketplaceTemplate.name'],
                            },
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                {
                                  type: 'we-badge',
                                  props: { variant: 'neutral', size: 'sm' },
                                  children: [{ $concat: ['v', '$marketplaceTemplate.version'] }],
                                },
                                {
                                  type: 'we-text',
                                  props: { fontSize: '300', color: 'neutral-400', truncate: true },
                                  children: ['$marketplaceTemplate.author'],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    // Right: installed badge or install button
                    {
                      type: '$if',
                      props: {
                        condition: {
                          $count: {
                            items: {
                              $filter: {
                                items: { $store: 'templateStore.spaceTemplates' },
                                where: { id: '$marketplaceTemplate.slug' },
                              },
                            },
                          },
                        },
                        then: {
                          type: 'we-badge',
                          props: { variant: 'success' },
                          children: ['Installed'],
                        },
                        else: {
                          type: 'we-button',
                          props: {
                            variant: 'secondary',
                            size: 'sm',
                            loading: {
                              $eq: [
                                { $store: 'templateStore.operationLoading' },
                                { $concat: ['space-install:', '$marketplaceTemplate.id'] },
                              ],
                            },
                            onClick: {
                              $action: 'templateStore.installToSpace',
                              args: ['$marketplaceTemplate.id'],
                            },
                          },
                          children: ['Install to Space'],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        else: {
          type: 'Column',
          props: { ay: 'center', ax: 'center', p: '500', gap: '200' },
          children: [
            { type: 'we-icon', props: { name: 'layout', size: 'xl', color: 'neutral-300' } },
            {
              type: 'we-text',
              props: { color: 'neutral-400', textAlign: 'center' },
              children: ['No templates available in the marketplace yet.'],
            },
          ],
        },
      },
    },
  ],
};
