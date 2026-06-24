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
        condition: { $count: { items: { $local: 'marketplaceTemplates' } } },
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
                    p: '400',
                    r: '300',
                    border: '1px solid neutral-200',
                    bg: 'neutral-50',
                    gap: '300',
                  },
                  children: [
                    // Left: icon + name + author
                    {
                      type: 'Row',
                      props: { ay: 'center', gap: '400' },
                      children: [
                        { type: 'we-icon', props: { name: 'layout', color: 'primary-500' } },
                        {
                          type: 'Column',
                          props: { gap: '300' },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '300', ay: 'center' },
                              children: [
                                {
                                  type: 'we-text',
                                  props: { fontWeight: '600', truncate: true },
                                  children: ['$marketplaceTemplate.name'],
                                },
                                {
                                  type: 'we-badge',
                                  props: { variant: 'neutral', size: 'xs' },
                                  children: [{ $concat: ['v', '$marketplaceTemplate.version'] }],
                                },
                              ],
                            },
                            {
                              type: '$agent',
                              props: { did: '$marketplaceTemplate.author', as: 'author' },
                              children: [
                                {
                                  type: 'Row',
                                  props: { ay: 'center', gap: '300' },
                                  children: [
                                    {
                                      type: 'we-avatar',
                                      props: {
                                        size: 'xs',
                                        image: '$author.avatar',
                                        initials: { $concat: ['$author.firstName', ' ', '$author.lastName'] },
                                      },
                                    },
                                    {
                                      type: 'we-text',
                                      props: { fontSize: '400', color: 'neutral-600', truncate: true },
                                      children: [{ $concat: ['$author.firstName', ' ', '$author.lastName'] }],
                                    },
                                    {
                                      type: 'we-timestamp',
                                      props: {
                                        value: '$marketplaceTemplate.createdAt',
                                        relative: true,
                                        color: 'neutral-400',
                                        fontSize: '400',
                                      },
                                    },
                                  ],
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
                          props: { variant: 'success', size: 'sm' },
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
                            onClick: { $action: 'templateStore.installToSpace', args: ['$marketplaceTemplate.id'] },
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
