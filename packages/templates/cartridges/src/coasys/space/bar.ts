import type { SchemaNode, SchemaProp } from '@we/schema-shared';

/**
 * The bar across the top of every view beside the tree: the way back to a folded sidebar, what the
 * view is, and whatever it offers. Shared by the channel views and the pages a tree group opens.
 */

/**
 * The way back to a folded sidebar, where its own button cannot be. "Sidebar" rather than "tree":
 * the lane holds the space's header, its search and the call beside the tree.
 */
const showTree: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "'tree' in shellStore.collapsedLanes" },
    then: {
      type: 'we-tooltip',
      props: { content: 'Show the sidebar', placement: 'bottom' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'md',
            square: true,
            label: 'Show the sidebar',
            onClick: { $invoke: 'shellStore.setLaneCollapsed', args: ['tree', false] },
          },
          children: [{ type: 'we-icon', props: { name: 'sidebar-simple' } }],
        },
      ],
    },
  },
};

/**
 * A view's bar: the way back to the tree, what this is, and whatever the view offers.
 *
 * `beside` sits against the title rather than at the far end — what acts on the name itself, such as
 * the pencil that renames a call. The title still truncates first, so a long name never pushes it out.
 */
export const viewBar = (
  title: SchemaNode['children'],
  /** A glyph's name, or an expression choosing one. */
  icon: SchemaProp,
  aside: SchemaNode[] = [],
  beside: SchemaNode[] = [],
): SchemaNode => ({
  type: 'Row',
  props: { gap: '300', ay: 'center', px: '500', py: '300', borderBottom: '1px solid border', minHeight: '56px' },
  children: [
    showTree,
    { type: 'we-icon', props: { name: icon, color: 'text-muted' } },
    {
      type: 'Row',
      props: { flex: '1', minWidth: '0', gap: '100', ay: 'center' },
      children: [
        {
          type: 'we-text',
          // No weight of its own, so a theme's heading weight reaches it — light in Glow.
          props: { variant: 'heading-sm', truncate: true, minWidth: '0' },
          children: title,
        },
        ...beside,
      ],
    },
    ...aside,
  ],
});
