import type { TemplateSchema } from '@we/schema-shared';

/**
 * The outcome tree as a map — the view Acorn is named for (`MapView`).
 *
 * The module's `acorn.mapView` part draws it (S2-8): Acorn's tree as tidy trees side by side,
 * siblings in sibling order, each card the statement with its computed scope and status, and a
 * card opening the expanded outcome. Read-only — creating, connecting and moving are S2-9.
 *
 * It needs the graph module as well as Acorn's, because the canvas is the graph module's
 * `GraphView`.
 */
export const acornMapView: TemplateSchema = {
  meta: {
    name: 'Map',
    description: 'The outcome tree drawn as a zoomable map — each outcome a card, each connection a line',
    icon: 'map-pin',
    role: 'view',
    segment: 'map',
    requires: { modules: ['acorn', 'graph'] },
  },
  type: 'Column',
  props: { p: '500', gap: '300', width: '100%' },
  children: [
    {
      type: 'we-text',
      props: { fontSize: 'xl', fontWeight: 'bold' },
      children: ['Map'],
    },
    { type: '$part', props: { id: 'acorn.mapView' } },
  ],
};
