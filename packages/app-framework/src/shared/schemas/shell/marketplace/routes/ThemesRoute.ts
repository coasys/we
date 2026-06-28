import type { SchemaNode } from '@we/schema-shared';

const emptyState: SchemaNode = {
  type: 'Column',
  props: { flex: '1', ax: 'center', ay: 'center', gap: '300', p: '600' },
  children: [
    { type: 'we-icon', props: { name: 'paint-bucket', size: 'xl', color: 'neutral-300' } },
    {
      type: 'we-text',
      props: { textAlign: 'center' },
      children: ['No themes available yet'],
    },
    {
      type: 'we-text',
      props: { variant: 'label', textAlign: 'center' },
      children: ['Be the first to publish a theme to the marketplace.'],
    },
  ],
};

const themeCard: SchemaNode = {
  type: 'TemplateCard',
  props: {
    template: '$theme',
    mode: 'marketplace',
    installed: {
      $find: {
        items: { $store: 'themeStore.installedThemes' },
        where: { name: '$theme.name' },
        select: 'version',
      },
    },
    onInstall: { $action: 'themeStore.installFromMarketplace', args: ['$theme.id'] },
    onDelete: { $action: 'themeStore.deleteMarketplaceTheme', args: ['$theme.id'] },
    isLoading: {
      $eq: [{ $store: 'themeStore.operationLoading' }, { $concat: ['marketplace-install:', '$theme.id'] }],
    },
  },
};

export const themesRoute: SchemaNode = {
  type: 'Column',
  props: { flex: '1', p: '500', gap: '400', ax: 'center', minHeight: '100%' },
  $localState: {
    search: { type: 'string', initial: '' },
    sort: { type: 'string', initial: 'desc' },
  },
  $queries: {
    themes: {
      model: 'Theme',
      perspective: 'adamStore.marketplacePerspective',
      order: { createdAt: { $local: 'sort' } },
      include: { screenshots: true },
      subscribe: true,
    },
  },
  children: [
    // Filters
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', maxWidth: '1200px', width: '100%' },
      children: [
        {
          type: 'SearchInput',
          props: {
            bg: 'neutral-0',
            border: '1px solid neutral-300',
            placeholder: 'Search themes…',
            value: { $local: 'search' },
            onSearch: { $setLocal: 'search', from: '$arg' },
            width: '100%',
            maxWidth: '300px',
          },
        },
        {
          type: 'we-select',
          props: {
            value: { $local: 'sort' },
            options: [
              { value: 'desc', label: 'Newest first' },
              { value: 'asc', label: 'Oldest first' },
            ],
            onChange: { $setLocal: 'sort', from: '$event.detail' },
          },
        },
      ],
    },

    // Grid or empty state
    {
      type: '$if',
      props: {
        condition: { $count: { items: { $local: 'themes' } } },
        then: {
          type: 'Column',
          props: { flex: '1', gap: '0', maxWidth: '1200px', width: '100%' },
          children: [
            {
              type: 'Grid',
              props: { columns: 3, gap: '400', width: '100%' },
              children: [
                {
                  type: '$each',
                  props: {
                    items: {
                      $filter: {
                        items: { $local: 'themes' },
                        where: { name: { contains: { $local: 'search' } } },
                      },
                    },
                    as: 'theme',
                  },
                  children: [themeCard],
                },
              ],
            },
          ],
        },
        else: emptyState,
      },
    },
  ],
};
