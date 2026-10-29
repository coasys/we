import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import { DNA_FOCUS, dnaPage, IN_CANVAS, ON_DNA_PAGE, VIEW_PARAM } from './paths.ts';

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
 * Page or Canvas, at the end of every bar, in the same place whatever is chosen — see `canvas.ts`. Into
 * the address, which every navigation then carries. A Social DNA focus is kept either way: from the
 * canvas, Page goes to the Social DNA page with it; from that page, Canvas draws it over the canvas.
 */
const modeSwitch: SchemaNode = {
  type: 'Row',
  props: { gap: '100', p: '100', r: 'control', bg: 'surface-sunken', flexShrink: 0 },
  children: [
    { icon: 'file-text', label: 'Page', canvas: false },
    { icon: 'squares-four', label: 'Canvas', canvas: true },
  ].map(({ icon, label, canvas }) => ({
    type: 'we-button',
    props: {
      size: 'sm',
      variant: { $: `${canvas ? '' : '!'}(${IN_CANVAS}) ? 'soft' : 'ghost'` },
      onClick: canvas
        ? { $invoke: 'routeStore.setParam', args: [VIEW_PARAM, 'canvas'] }
        : {
            // Decided before anything moves: the page's address carries no `view`, so it is Page mode too.
            $if: {
              condition: { $: `${DNA_FOCUS} && !(${ON_DNA_PAGE})` },
              then: dnaPage(DNA_FOCUS),
              else: { $invoke: 'routeStore.setParam', args: [VIEW_PARAM, null] },
            },
          },
    },
    children: [{ type: 'we-icon', props: { name: icon } }, label],
  })),
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
    modeSwitch,
  ],
});
