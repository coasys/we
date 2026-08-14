import type { RouteSchema, SchemaNode } from '@we/schema-shared';
import { agentByline, emptyState } from '@we/template-kit';

/**
 * The space's events, as a month and as a list.
 *
 * Two readings of one query, because a calendar answers "what does this month look like" and a list
 * answers "what is next" — and the second is the question anyone actually opens this route with.
 * The grid alone would be a picture of density; the list alone would lose the shape of a week.
 *
 * ## Where the events come from
 *
 * Ordinary `EventBlock` records, whoever made them. Some are composed by hand; some are written by
 * the extraction pass over a call transcript, which is the point — a meeting where somebody said
 * "let's do the design review next Tuesday at 3" puts that on the calendar without anyone filling
 * in a form. Nothing here distinguishes the two, deliberately: an event is an event, and provenance
 * belongs on the record rather than in a second list.
 *
 * ## Dates
 *
 * `startDate` is `YYYY-MM-DDTHH:mm`, and the grid's cells are days. The `Calendar` component
 * truncates rather than requiring the caller to — a schema has no string operator to slice a
 * datetime with, so demanding date-only strings would make the component unusable by the only data
 * that feeds it.
 */
const eventsQuery = {
  $query: { entity: 'EventBlock', order: { startDate: 'asc' }, limit: 200 },
};

/** The month grid, with a dot on every day something happens. */
const monthGrid: SchemaNode = {
  type: 'Calendar',
  props: {
    // `$map` over a `$query` is the one composition the renderer hoists into a live subscription,
    // so the grid re-marks itself as events arrive rather than on a reload.
    events: {
      $map: {
        items: eventsQuery,
        select: { id: '$item.id', date: '$item.startDate', label: '$item.title' },
      },
    },
    styles: { width: '100%' },
  },
};

/**
 * One event, as a row.
 *
 * Shows the author the same way a post does. That is worth more here than it looks: an event nobody
 * composed — one a model heard in a call — carries the DID of whoever was transcribing, so the byline
 * is the thread back to the conversation it came from.
 */
const eventRow: SchemaNode = {
  type: 'Column',
  props: { width: '100%', gap: '200', bg: 'neutral-50', r: '300', p: '400' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'calendar', color: 'primary-700' } },
        { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['$event.title'] },
        {
          type: 'we-text',
          props: { fontSize: '200', color: 'neutral-700', ml: 'auto' },
          children: [{ type: 'we-timestamp', props: { value: '$event.startDate' } }],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: '$event.description',
        then: { type: 'we-text', props: { color: 'neutral-700' }, children: ['$event.description'] },
      },
    },
    {
      type: '$if',
      props: {
        condition: '$event.location',
        then: {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'map-pin', color: 'neutral-500' } },
            { type: 'we-text', props: { fontSize: '200', color: 'neutral-700' }, children: ['$event.location'] },
          ],
        },
      },
    },
    agentByline({ did: '$event.author', as: 'organiser', timestamp: '$event.createdAt' }),
  ],
};

export const calendarRoute: RouteSchema = {
  path: '/calendar',
  type: 'Column',
  props: { width: '100%', ax: 'center', p: '500' },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: 'var(--we-layout-lg)', gap: '400' },
      children: [
        { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Calendar'] },
        monthGrid,
        {
          type: '$if',
          props: {
            condition: { $count: { items: eventsQuery } },
            then: {
              type: 'Column',
              props: { width: '100%', gap: '300' },
              children: [
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'neutral-500', uppercase: true },
                  children: ['Scheduled'],
                },
                {
                  type: '$each',
                  props: { items: eventsQuery, as: 'event' },
                  children: [eventRow],
                },
              ],
            },
            else: emptyState({
              icon: 'calendar',
              label: 'events',
              message:
                'Nothing scheduled yet. Add an event, or record a call — extraction writes down the times people agree on.',
            }),
          },
        },
      ],
    },
  ],
};
