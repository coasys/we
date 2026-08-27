import type { SchemaNode } from '@we/schema-shared';
import { marketplaceList } from '@we/template-kit';

export const themesRoute: SchemaNode = marketplaceList({
  entity: 'Theme',
  as: 'theme',
  label: 'themes',
  emptyIcon: 'paint-bucket',
  emptyBody: 'Be the first to publish a theme to the marketplace.',
  sortable: true,
  include: { screenshots: true },
  card: {
    mode: 'marketplace',
    installed: { $: 'find(themeStore.installedThemes, { name: theme.name }).version' },
    onInstall: { $action: 'themeStore.installFromMarketplace', args: ['$theme.id'] },
    onDelete: { $action: 'themeStore.deleteMarketplaceTheme', args: ['$theme.id'] },
    // Namespaced, so one row's spinner does not appear on every row.
    isLoading: { $: 'themeStore.operationLoading == `marketplace-install:${theme.id}`' },
  },
});
