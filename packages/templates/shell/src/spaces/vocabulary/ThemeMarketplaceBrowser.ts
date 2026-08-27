import type { SchemaNode } from '@we/schema-shared';
import { marketplaceList } from '@we/template-kit';

/**
 * The compact form, for the panel inside space settings.
 *
 * Installs into the *space*, matching the template browser beside it. It used to call
 * `themeStore.installFromMarketplace`, which writes to your personal library — so the same button
 * on the same page meant "give this community a theme" for templates and "put this in my account"
 * for themes. The space-scoped counterpart simply did not exist until now.
 */
export const themeMarketplaceBrowser: SchemaNode = marketplaceList({
  entity: 'Theme',
  as: 'marketplaceTheme',
  label: 'themes',
  emptyIcon: 'paint-bucket',
  layout: 'list',
  card: {
    mode: 'compact',
    installed: { $: 'find(themeStore.spaceThemes, { name: marketplaceTheme.name }).version' },
    onInstall: { $action: 'themeStore.installToSpace', args: ['$marketplaceTheme.id'] },
    isLoading: { $: 'themeStore.operationLoading == `space-install:${marketplaceTheme.id}`' },
  },
});
