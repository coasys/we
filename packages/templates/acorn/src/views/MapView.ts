import type { TemplateSchema } from '@we/schema-shared';

/**
 * The outcome tree as a map — the view Acorn is named for (`MapView`).
 *
 * The module's `acorn.mapView` part draws it (S2-8): Acorn's tree as tidy trees side by side,
 * siblings in sibling order, each card the statement with its computed scope and status, and a
 * double-click on a card opening the expanded outcome. Always Acorn's Classic layout, whatever the
 * project's layering algorithm. The map edits as Acorn's does (S2-9): a new root or child outcome, a
 * line dragged from one card to another, Delete on a line or a card. Moving a card to another parent
 * or another place among its siblings is not here yet.
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
  // The section wears Acorn itself, so it looks the same inside any shell.
  theme: { themeName: 'acorn' },
  type: 'Column',
  props: { 'data-acorn-view': 'map', bg: 'page', minHeight: '100%', p: '500', gap: '300', width: '100%' },
  children: [
    {
      type: 'we-text',
      props: { fontSize: '600', fontWeight: 'bold' },
      children: ['Map'],
    },
    { type: '$part', props: { id: 'acorn.mapView' } },
  ],
};
