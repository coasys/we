import type { SchemaNode } from '@we/schema-shared';
import { marketplaceList } from '@we/template-kit';

/**
 * Sections, as their own shelf.
 *
 * A view is stored as an ordinary `Template` record — same install flow, same publish path, same
 * versioning — so this route differs from the templates one by a single `where`. That the two share
 * everything else is the point: nothing about being a section earns its own machinery, and a
 * separate entity type would have bought a second copy of all of it.
 *
 * What it does earn is a separate shelf, because the two answer different questions. "What should
 * this space look like" and "what should this space have in it" are not alternatives, and a browser
 * that mixed them would offer a Discord-shaped shell next to a calendar page as though you were
 * choosing between them.
 */
export const viewsRoute: SchemaNode = marketplaceList({
  entity: 'Template',
  as: 'template',
  label: 'sections',
  where: { role: 'view' },
  emptyIcon: 'squares-four',
  emptyBody: 'Be the first to publish a section to the marketplace.',
  sortable: true,
  include: { screenshots: true },
  card: {
    mode: 'marketplace',
    // Slug *and* author: a marketplace is a shared space, so two agents can publish under the same
    // slug and only one of them is the one you installed.
    installed: { $: 'find(templateStore.myTemplates, { id: template.slug, author: template.author }).templateVersion' },
    onInstall: { $action: 'templateStore.installFromMarketplace', args: [{ $: 'template.id' }] },
    onDelete: { $action: 'templateStore.deleteMarketplaceTemplate', args: [{ $: 'template.id' }] },
    isLoading: { $: 'templateStore.operationLoading == `marketplace-install:${template.id}`' },
  },
});
