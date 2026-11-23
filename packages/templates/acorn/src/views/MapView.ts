import type { TemplateSchema } from '@we/schema-shared';

/**
 * The outcome tree as a map — the view Acorn is named for.
 *
 * A stub where the canvas lands in S2-8: the section exists so a space can already turn the
 * map on and so the list of what it will draw is real data rather than a screenshot of one.
 * The connections that become the tree's edges are queried here already, as the count line.
 */
export const acornMapView: TemplateSchema = {
  meta: {
    name: 'Map',
    description: 'The outcome tree drawn as a zoomable map — stub until the canvas lands in S2-8',
    icon: 'map-pin',
    role: 'view',
    segment: 'map',
    requires: { modules: ['acorn'] },
  },
  type: 'Column',
  props: { p: '500', gap: '300', width: '100%', maxWidth: 'var(--we-layout-lg)', mx: 'auto' },
  children: [
    {
      type: 'we-text',
      props: { fontSize: 'xl', fontWeight: 'bold' },
      children: ['Map'],
    },
    {
      type: 'we-text',
      props: { tone: 'secondary' },
      children: ['The outcome-tree canvas lands in S2-8. These are the outcomes it will draw:'],
    },
    {
      type: '$each',
      props: {
        items: { $query: { entity: 'AcornOutcome', order: { timestampCreated: 'asc' } } },
        as: 'outcome',
      },
      children: [
        {
          type: 'we-text',
          props: { fontWeight: 'medium' },
          children: [{ $: 'outcome.content' }],
        },
      ],
    },
  ],
};
