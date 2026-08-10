import type { SchemaNode } from '@we/schema-shared';
import { marketplaceList } from '@we/template-kit';

/** The compact form, for the panel inside space settings. */
export const themeMarketplaceBrowser: SchemaNode = marketplaceList({
  entity: 'Theme',
  as: 'marketplaceTheme',
  label: 'themes',
  emptyIcon: 'paint-bucket',
  layout: 'list',
  card: {
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
      $eq: [{ $store: 'themeStore.operationLoading' }, { $concat: ['marketplace-install:', '$marketplaceTheme.id'] }],
    },
  },
});
