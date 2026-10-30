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

/** What a node's children hold: text, a node, or an expression. */
type Child = NonNullable<SchemaNode['children']>[number];

/**
 * One step of where a view is: Calls, then the call. `when` is an expression for a step that is only
 * sometimes there — the definition under a kind of Social DNA, the workflow open on the Workflows page.
 * `onClick` goes there; the last step shown is where somebody already is, and is not a button.
 */
export interface Crumb {
  label: Child;
  onClick?: SchemaProp;
  when?: string;
}

/** A crumb's words, at the bar's size. No weight of its own, so a theme's heading weight reaches it — light in Glow. */
const crumbText = (label: Child, extra: Record<string, unknown> = {}): SchemaNode => ({
  type: 'we-text',
  props: { variant: 'heading-sm', truncate: true, minWidth: '0', ...extra },
  children: [label],
});

/** A step on the way here: muted, a button where it goes somewhere, and the caret to the next. */
const crumbStep = (crumb: Crumb): SchemaNode => ({
  type: 'Row',
  // Shrinks before the step somebody is on, but only so far: each keeps a word or two.
  props: { gap: '100', ay: 'center', minWidth: '0', maxWidth: '40%', flexShrink: 1 },
  children: [
    crumb.onClick
      ? {
          type: 'we-button',
          props: {
            variant: 'bare',
            minWidth: '0',
            color: 'text-muted',
            hoverProps: { color: 'text' },
            onClick: crumb.onClick,
          },
          children: [crumbText(crumb.label)],
        }
      : crumbText(crumb.label, { color: 'text-muted' }),
    { type: 'we-icon', props: { name: 'caret-right', size: 'sm', color: 'text-muted', flexShrink: 0 } },
  ],
});

/**
 * The crumbs as nodes. A step is where somebody is when no step after it is shown, so a trail whose
 * later steps come and go (`when`) draws its last one plain and every one before it as a way back.
 */
const trail = (crumbs: Crumb[]): SchemaNode[] =>
  crumbs.map((crumb, i) => {
    const later = crumbs.slice(i + 1).map((c) => c.when ?? 'true');
    const here = crumbText(crumb.label, { flexShrink: 1 });
    const node: SchemaNode = !later.length
      ? here
      : later.includes('true')
        ? crumbStep(crumb)
        : {
            type: '$if',
            props: { condition: { $: `!((${later.join(') || (')}))` }, then: here, else: crumbStep(crumb) },
          };
    return crumb.when ? { type: '$if', props: { condition: { $: crumb.when }, then: node } } : node;
  });

/**
 * A view's bar: the way back to the tree, where this is, and whatever the view offers.
 *
 * Where this is reads as a trail — Calls › the call, People › a person, Social DNA › Signal types ›
 * Like — every step but the last a way back up to it.
 *
 * `beside` sits against the title rather than at the far end — what acts on the name itself, such as
 * the pencil that renames a call. The title still truncates first, so a long name never pushes it out.
 */
export const viewBar = (
  crumbs: Crumb[],
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
      children: [...trail(crumbs), ...beside],
    },
    ...aside,
    modeSwitch,
  ],
});
