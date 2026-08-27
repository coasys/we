import type { SchemaNode } from '@we/schema-shared';
import { marketplaceList } from '@we/template-kit';

/** The compact form, for the panel inside space settings — installs to the space, not to you. */
export const marketplaceBrowser: SchemaNode = marketplaceList({
  entity: 'Template',
  as: 'marketplaceTemplate',
  label: 'templates',
  emptyIcon: 'layout',
  layout: 'list',
  card: {
    mode: 'compact',
    installLabel: 'Install to Space',
    installed: { $: 'count(filter(templateStore.spaceTemplates, { id: marketplaceTemplate.slug }))' },
    onInstall: { $action: 'templateStore.installToSpace', args: ['$marketplaceTemplate.id'] },
  },
});
