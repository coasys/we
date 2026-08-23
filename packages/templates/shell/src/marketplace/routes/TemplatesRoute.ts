import type { SchemaNode } from '@we/schema-shared';
import { marketplaceList } from '@we/template-kit';

export const templatesRoute: SchemaNode = marketplaceList({
  entity: 'Template',
  as: 'template',
  label: 'templates',
  // `not: 'view'` rather than `'shell'`: every template published before views existed has no role
  // stored, and asking for the positive value would empty the shelf of everything already on it.
  where: { role: { not: 'view' } },
  emptyIcon: 'layout',
  emptyBody: 'Be the first to publish a template to the marketplace.',
  sortable: true,
  include: { screenshots: true },
  card: {
    mode: 'marketplace',
    // Matched on slug *and* author: a marketplace is a shared space, so two agents can publish
    // templates under the same slug and only one of them is the one you installed.
    installed: {
      $find: {
        items: { $store: 'templateStore.myTemplates' },
        where: { id: '$template.slug', author: '$template.author' },
        select: 'templateVersion',
      },
    },
    onInstall: { $action: 'templateStore.installFromMarketplace', args: ['$template.id'] },
    onDelete: { $action: 'templateStore.deleteMarketplaceTemplate', args: ['$template.id'] },
    isLoading: {
      $eq: [{ $store: 'templateStore.operationLoading' }, { $concat: ['marketplace-install:', '$template.id'] }],
    },
  },
});
