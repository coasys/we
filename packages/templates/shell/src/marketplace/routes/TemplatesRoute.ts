import type { SchemaNode } from '@we/schema-shared';

const emptyState: SchemaNode = {
  type: 'Column',
  props: { flex: '1', ax: 'center', ay: 'center', gap: '300', p: '600' },
  children: [
    { type: 'we-icon', props: { name: 'layout', size: 'xl', color: 'neutral-300' } },
    {
      type: 'we-text',
      props: { textAlign: 'center' },
      children: ['No templates available yet'],
    },
    {
      type: 'we-text',
      props: { variant: 'label', textAlign: 'center' },
      children: ['Be the first to publish a template to the marketplace.'],
    },
  ],
};

export const templatesRoute: SchemaNode = {
  type: 'Column',
  props: { flex: '1', p: '500', gap: '400', ax: 'center', minHeight: '100%' },
  $localState: {
    search: { type: 'string', initial: '' },
    sort: { type: 'string', initial: 'desc' },
  },
  $queries: {
    templates: {
      entity: 'Template',
      dataset: 'datasetStore.marketplaceDataset',
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
          type: 'Search',
          props: {
            bg: 'neutral-0',
            border: '1px solid neutral-300',
            placeholder: 'Search templates…',
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
        condition: { $count: { items: { $local: 'templates' } } },
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
                        items: { $local: 'templates' },
                        where: { name: { contains: { $local: 'search' } } },
                      },
                    },
                    as: 'template',
                  },
                  children: [
                    {
                      type: 'TemplateCard',
                      props: {
                        template: '$template',
                        mode: 'marketplace',
                        installed: {
                          $find: {
                            items: { $store: 'templateStore.myTemplates' },
                            where: { id: '$template.slug', author: '$template.author' },
                            select: 'templateVersion',
                          },
                        },
                      },
                    },
                  ],
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
