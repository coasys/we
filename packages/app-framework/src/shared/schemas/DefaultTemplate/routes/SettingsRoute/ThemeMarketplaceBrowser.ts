import type { SchemaNode } from '@we/schema-shared';

export const themeMarketplaceBrowser: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  $localState: {
    search: { type: 'string', initial: '' },
  },
  $queries: {
    marketplaceThemes: {
      model: 'Theme',
      perspective: 'adamStore.marketplacePerspective',
      subscribe: true,
    },
  },
  children: [
    {
      type: 'SearchInput',
      props: {
        placeholder: 'Search themes…',
        value: { $local: 'search' },
        onSearch: { $setLocal: 'search', from: '$arg' },
        width: '100%',
      },
    },
    {
      type: '$if',
      props: {
        condition: { $count: { items: { $local: 'marketplaceThemes' } } },
        then: {
          type: 'Column',
          props: { gap: '200' },
          children: [
            {
              type: '$each',
              props: {
                items: {
                  $filter: {
                    items: { $local: 'marketplaceThemes' },
                    where: { name: { contains: { $local: 'search' } } },
                  },
                },
                as: 'marketplaceTheme',
              },
              children: [
                {
                  type: 'Row',
                  props: { ay: 'center', ax: 'between', p: '300', r: '300', bg: 'neutral-50' },
                  children: [
                    {
                      type: 'Row',
                      props: { ay: 'center', gap: '300' },
                      children: [
                        { type: 'we-icon', props: { name: '$marketplaceTheme.icon' } },
                        { type: 'we-text', props: { fontWeight: '600' }, children: ['$marketplaceTheme.name'] },
                      ],
                    },
                    {
                      type: '$if',
                      props: {
                        condition: {
                          $count: {
                            items: {
                              $filter: {
                                items: { $store: 'themeStore.installedThemes' },
                                where: { name: '$marketplaceTheme.name' },
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
                            onClick: { $action: 'themeStore.installFromMarketplace', args: ['$marketplaceTheme.id'] },
                          },
                          children: ['Install'],
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
            { type: 'we-icon', props: { name: 'paint-bucket', size: 'xl', color: 'neutral-300' } },
            {
              type: 'we-text',
              props: { color: 'neutral-400', textAlign: 'center' },
              children: ['No themes available in the marketplace yet.'],
            },
          ],
        },
      },
    },
  ],
};
