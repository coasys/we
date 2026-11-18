import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { VIEWS_MARKER } from '@we/schema-shared';

/**
 * The section strip — the space's own resolved section list, read the same way the routes were
 * built, so the two can never drift. `spaceStore.viewNav` is the nav-shaped view of that list;
 * `expandViewRoutes` below is the route-shaped one. The default section is whichever the space's
 * `enabledViews` lists first — for the Acorn fixture, the outcomes list — and the expansion's
 * index redirect lands a member there; the shell declares the list's *place*, not its order.
 */
const acornNavBar: SchemaNode = {
  type: 'Row',
  props: {
    bg: 'surface',
    borderBottom: '1px solid border',
    px: '400',
    py: '300',
    gap: '300',
    ay: 'center',
  },
  children: [
    { type: 'we-icon', props: { name: 'squirrel' } },
    {
      type: 'we-text',
      props: { fontWeight: 'semibold', truncate: true },
      children: [{ $: 'spaceStore.currentSpace.name' }],
    },
    {
      // The space's own section list — not a literal one, for the reason the marker below exists.
      type: 'Row',
      props: { gap: '200', ml: 'auto' },
      children: [
        {
          type: '$each',
          props: { items: { $: 'spaceStore.viewNav' }, as: 'view' },
          children: [
            {
              type: 'we-button',
              props: {
                variant: { $: "routeStore.segments[2] == view.segment ? 'solid' : 'ghost'" },
                onClick: { $invoke: 'routeStore.navigate', args: [{ $: 'view.path' }] },
              },
              children: [
                { type: 'we-icon', props: { name: { $: 'view.icon' } } },
                { type: 'we-text', children: [{ $: 'view.label' }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/**
 * The Acorn shell: a nav strip over the space's sections.
 *
 * One route level — `/space/:spaceId` — holds the marker the host expands into one route per
 * resolved view. Everything past the dataset gate is deliberately plain for v0: no project
 * picker (a mounted perspective is one project), no expanded-outcome route, no write path.
 * Those land in S2-2/S2-3, on top of the same marker rather than beside it.
 */
export const acornTemplate: TemplateSchema = {
  meta: {
    name: 'Acorn',
    description: 'An Acorn project — its outcome tree, priorities and members — as a WE space',
    icon: 'squirrel',
    role: 'shell',
    // The views call the acorn module's expression functions; a deployment without the module
    // sees the reason rather than a blank section.
    requires: { modules: ['acorn'] },
  },
  type: 'Column',
  props: { bg: 'page', minHeight: '100%' },
  children: [{ type: '$routes' }],
  routes: [
    {
      path: '/space/:spaceId',
      children: [
        {
          type: '$if',
          props: {
            condition: { $: 'datasetStore.currentDataset' },
            then: {
              type: 'Column',
              children: [
                acornNavBar,
                { type: 'Column', props: { height: '100dvh', width: '100%' }, children: [{ type: '$routes' }] },
              ],
            },
          },
        },
      ],
      // The space's sections go here, whatever they turn out to be.
      routes: [{ path: VIEWS_MARKER }],
    },
  ],
};
