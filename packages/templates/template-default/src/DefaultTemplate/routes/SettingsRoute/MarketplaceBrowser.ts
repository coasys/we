import type { SchemaNode } from '@we/schema-shared';

export const marketplaceBrowser: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  $localState: {
    search: { type: 'string', initial: '' },
  },
  $queries: {
    marketplaceTemplates: {
      entity: 'Template',
      dataset: 'adamStore.marketplacePerspective',
      subscribe: true,
    },
  },
  children: [
    {
      type: 'Search',
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
                  type: 'TemplateCard',
                  props: {
                    template: '$marketplaceTemplate',
                    mode: 'compact',
                    installLabel: 'Install to Space',
                    installed: {
                      $count: {
                        items: {
                          $filter: {
                            items: { $store: 'templateStore.spaceTemplates' },
                            where: { id: '$marketplaceTemplate.slug' },
                          },
                        },
                      },
                    },
                    onInstall: {
                      $action: 'templateStore.installToSpace',
                      args: ['$marketplaceTemplate.id'],
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
            { type: 'we-icon', props: { name: 'layout', size: 'xl', color: 'neutral-300' } },
            {
              type: 'we-text',
              props: { textAlign: 'center' },
              children: ['No templates available in the marketplace yet.'],
            },
          ],
        },
      },
    },
  ],
};
