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
      type: 'Search',
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
                  type: 'TemplateCard',
                  props: {
                    template: '$marketplaceTheme',
                    mode: 'compact',
                    installed: {
                      $find: {
                        items: { $store: 'themeStore.installedThemes' },
                        where: { name: '$marketplaceTheme.name' },
                        select: 'version',
                      },
                    },
                    onInstall: { $action: 'themeStore.installFromMarketplace', args: ['$marketplaceTheme.id'] },
                    isLoading: {
                      $eq: [
                        { $store: 'themeStore.operationLoading' },
                        { $concat: ['marketplace-install:', '$marketplaceTheme.id'] },
                      ],
                    },
                  },
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
              props: { textAlign: 'center' },
              children: ['No themes available in the marketplace yet.'],
            },
          ],
        },
      },
    },
  ],
};
