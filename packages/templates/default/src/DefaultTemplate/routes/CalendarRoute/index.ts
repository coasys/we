import type { RouteSchema, SchemaNode } from '@we/schema-shared';
import { agentByline, emptyState, field } from '@we/template-kit';

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

/**
 * The same events, narrowed to the selected day.
 *
 * `startsWith` over `startDate` rather than an equality on a date field, because the model stores a
 * datetime and the grid selects a day — the prefix *is* the day. It pushes down to the backend like
 * any other filter, so picking a date does not read the month and sift it here.
 */
const eventsOnDay = {
  $query: {
    entity: 'EventBlock',
    where: { startDate: { startsWith: { $local: 'day' } } },
    order: { startDate: 'asc' },
    limit: 100,
  },
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
    value: { $local: 'day' },
    // Picking a day filters the list below it. A grid full of dots you cannot ask a question of is
    // a picture of a month; this is the question it invites.
    onSelect: { $setLocal: 'day', from: '$arg' },
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

/** Creating an event by hand — the other way records get here, beside extraction. */
const composer: SchemaNode = {
  type: '$if',
  props: {
    condition: { $local: 'composerOpen' },
    then: {
      type: 'we-modal',
      props: { close: { $setLocal: 'composerOpen', value: false } },
      children: [
        { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['New event'] },
        field({ name: 'draftTitle', label: 'What is it?', placeholder: 'Design review' }),
        field({
          name: 'draftStart',
          label: 'When',
          // The same control `EventBlock`'s own editor uses, so a hand-made event and an extracted
          // one carry the same format — which is what lets the grid read both.
          props: { type: 'datetime-local' },
        }),
        field({ name: 'draftLocation', label: 'Where', placeholder: 'Optional' }),
        {
          type: 'Row',
          props: { ax: 'end', gap: '200' },
          children: [
            {
              type: 'we-button',
              props: { variant: 'ghost', onClick: { $setLocal: 'composerOpen', value: false } },
              children: ['Cancel'],
            },
            {
              type: 'we-button',
              props: {
                // Title and a time are what the model requires; anything else is optional here too.
                disabled: { $or: [{ $not: { $local: 'draftTitle' } }, { $not: { $local: 'draftStart' } }] },
                onClick: {
                  $action: 'model.create',
                  args: [
                    'EventBlock',
                    {
                      title: { $local: 'draftTitle' },
                      startDate: { $local: 'draftStart' },
                      location: { $local: 'draftLocation' },
                    },
                  ],
                  onSuccess: [
                    { $setLocal: 'composerOpen', value: false },
                    { $setLocal: 'draftTitle', value: '' },
                    { $setLocal: 'draftStart', value: '' },
                    { $setLocal: 'draftLocation', value: '' },
                  ],
                },
              },
              children: ['Add event'],
            },
          ],
        },
      ],
    },
  },
};

export const calendarRoute: RouteSchema = {
  path: '/calendar',
  type: 'Column',
  props: { width: '100%', ax: 'center', p: '500' },
  $localState: {
    /** The day the grid has selected, `YYYY-MM-DD`. Empty means "everything scheduled". */
    day: { type: 'string', initial: '' },
    composerOpen: { type: 'boolean', initial: false },
    draftTitle: { type: 'string', initial: '' },
    draftStart: { type: 'string', initial: '' },
    draftLocation: { type: 'string', initial: '' },
  },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: 'var(--we-layout-lg)', gap: '400' },
      children: [
        {
          type: 'Row',
          props: { width: '100%', ay: 'center', gap: '300' },
          children: [
            { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Calendar'] },
            {
              type: 'we-button',
              props: { size: 'sm', ml: 'auto', onClick: { $setLocal: 'composerOpen', value: true } },
              children: ['New event'],
            },
          ],
        },
        monthGrid,
        composer,

        // ── A day, when one is picked ────────────────────────────────────────
        {
          type: '$if',
          props: {
            condition: { $local: 'day' },
            then: {
              type: 'Column',
              props: { width: '100%', gap: '300' },
              children: [
                {
                  type: 'Row',
                  props: { width: '100%', ay: 'center', gap: '200' },
                  children: [
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'neutral-500', uppercase: true, text: { $local: 'day' } },
                    },
                    {
                      // Getting back to everything, without hunting for the selected cell.
                      type: 'we-button',
                      props: { size: 'xs', variant: 'ghost', ml: 'auto', onClick: { $setLocal: 'day', value: '' } },
                      children: ['Show all'],
                    },
                  ],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $count: { items: eventsOnDay } },
                    then: {
                      type: '$each',
                      props: { items: eventsOnDay, as: 'event' },
                      children: [eventRow],
                    },
                    else: {
                      type: 'we-text',
                      props: { color: 'neutral-500', italic: true },
                      children: ['Nothing on this day.'],
                    },
                  },
                },
              ],
            },

            // ── Everything, when no day is picked ────────────────────────────
            else: {
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
          },
        },
      ],
    },
  ],
};
