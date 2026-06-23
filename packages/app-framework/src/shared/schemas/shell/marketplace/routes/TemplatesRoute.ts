import type { SchemaNode } from '@we/schema-shared';

const templateCard: SchemaNode = {
  type: 'Column',
  props: {
    bg: 'neutral-0',
    r: '400',
    border: '1px solid neutral-200',
    p: '400',
    gap: '300',
    hoverProps: { border: '1px solid primary-300', shadow: 'sm' },
    transition: 'box-shadow 150ms ease',
  },
  children: [
    // Header: icon + name + delete
    {
      type: 'Row',
      props: { ay: 'center', ax: 'between' },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center', flex: '1', minWidth: '0' },
          children: [
            { type: 'we-icon', props: { name: 'layout', size: 'md', color: 'primary-500' } },
            {
              type: 'we-text',
              props: { fontWeight: '600', truncate: true },
              children: ['$template.name'],
            },
          ],
        },
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
                  args: ['Template', '$template.id', { perspective: 'adamStore.marketplacePerspective' }],
                },
              },
              children: [{ type: 'we-icon', props: { name: 'trash' } }],
            },
          },
        },
      ],
    },

    // Version + origin row
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        {
          type: 'we-badge',
          props: { variant: 'neutral', size: 'sm' },
          children: [{ $concat: ['v', '$template.version'] }],
        },
        {
          type: '$if',
          props: {
            condition: '$template.slug',
            then: {
              type: 'we-text',
              props: { fontSize: '300', color: 'neutral-400', truncate: true },
              children: ['$template.slug'],
            },
          },
        },
      ],
    },

    // Spacer
    { type: 'Column', props: { flex: '1' } },

    // Footer: author + install button
    {
      type: 'Row',
      props: { ax: 'between', ay: 'center', mt: '100' },
      children: [
        {
          type: 'we-text',
          props: { fontSize: '200', color: 'neutral-400', truncate: true, maxWidth: '140px' },
          children: ['$template.author'],
        },
        {
          type: 'we-button',
          props: {
            variant: 'primary',
            size: 'sm',
            loading: {
              $eq: [
                { $store: 'templateStore.operationLoading' },
                { $concat: ['marketplace-install:', '$template.id'] },
              ],
            },
            onClick: {
              $action: 'templateStore.installFromMarketplace',
              args: ['$template.id'],
            },
          },
          children: ['Install'],
        },
      ],
    },
  ],
};

const emptyState: SchemaNode = {
  type: 'Column',
  props: { flex: '1', ax: 'center', ay: 'center', gap: '300', p: '600' },
  children: [
    { type: 'we-icon', props: { name: 'layout', size: 'xl', color: 'neutral-300' } },
    {
      type: 'we-text',
      props: { fontSize: '500', color: 'neutral-400', textAlign: 'center' },
      children: ['No templates available yet'],
    },
    {
      type: 'we-text',
      props: { fontSize: '300', color: 'neutral-400', textAlign: 'center' },
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
      model: 'Template',
      perspective: 'adamStore.marketplacePerspective',
      order: { createdAt: { $local: 'sort' } },
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
                  children: [templateCard],
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
