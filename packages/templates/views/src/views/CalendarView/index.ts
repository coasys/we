import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { agentByline, emptyState, field, formModal } from '@we/template-kit';

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
 * A substring match over `startDate` rather than an equality on a date field, because the model
 * stores a datetime and the grid selects a day. It pushes down to the backend like any other filter,
 * so picking a date does not read the month and sift it here.
 *
 * ## Why `contains` and not `startsWith`, which is what this means
 *
 * `startsWith` is the honest spelling, and the AD4M adapter declares it non-native: its `where` has
 * no prefix operator, so the plan comes back with a `compute-up` gap and the renderer refuses the
 * query outright. The compute-up fallback the adapter's own comment promises is not wired into the
 * render path — a query that needs it fails loud rather than being run broadly and filtered here,
 * which is the correct conservative choice and also means the operator is unusable against AD4M
 * today. (In-memory it is native, and the dot below uses it through `$filter`, which is evaluated
 * client-side and has no such limit.)
 *
 * `contains` is exact for this data rather than an approximation of it: `startDate` is
 * `YYYY-MM-DDTHH:mm`, and a `YYYY-MM-DD` substring can only occur at position 0 — there is nowhere
 * else in a fixed-width datetime for a date to hide. It stops being exact the moment the format
 * does, which is why this comment exists.
 */
const eventsOnDay = {
  $query: {
    entity: 'EventBlock',
    where: { startDate: { contains: { $local: 'day' } } },
    order: { startDate: 'asc' },
    limit: 100,
  },
};

/** Step a month. The carets flank the label rather than sitting off to one side. */
const step = (by: number, icon: string): SchemaNode => ({
  type: 'we-button',
  props: {
    size: 'sm',
    variant: 'ghost',
    square: true,
    // Paging is arithmetic on an offset, which is the one calculation the schema layer can do —
    // `$setLocal` sets a literal and adds a constant, nothing else — so every source reads the same
    // offset and the template only ever adds to it.
    onClick: { $setLocal: 'monthOffset', by },
  },
  children: [{ type: 'we-icon', props: { name: icon } }],
});

/**
 * Jump to any month, without a permanent second row of chrome.
 *
 * The alternative considered was a year line above the month line, each with its own carets. It
 * reads well in a mockup and costs more than it looks: four controls and a doubled header height,
 * permanently, on a view whose entire job is showing days — and it still only moves a year at a
 * time, so "next March" is two gestures rather than one.
 *
 * Opening it on the label instead keeps the resting state to one line, and lets a jump be a jump:
 * pick the year, pick the month, done. It is also where people already click.
 */
const monthPicker: SchemaNode = {
  type: '$if',
  props: {
    condition: { $local: 'pickerOpen' },
    then: {
      type: 'Column',
      props: {
        position: 'absolute',
        zIndex: 20,
        width: '260px',
        gap: '200',
        bg: 'surface-sunken',
        border: '1px solid border',
        r: '400',
        p: '300',
        shadow: 'lg',
        // Centred under the label it belongs to. `styles` rather than DS props because centring by
        // transform has no token, and `top` as a percentage is not a space value.
        styles: { top: 'calc(100% + 4px)', left: '50%', transform: 'translateX(-50%)' },
      },
      children: [
        {
          type: 'Row',
          props: { width: '100%', ay: 'center' },
          children: [
            // A year is twelve months, which the schema can add on its own.
            step(-12, 'caret-left'),
            {
              type: 'we-text',
              props: {
                flex: '1',
                textAlign: 'center',
                fontWeight: 'semibold',
                text: { $source: { name: 'yearLabel', options: { offset: { $local: 'monthOffset' } } } },
              },
            },
            step(12, 'caret-right'),
          ],
        },
        {
          type: 'Row',
          props: { width: '100%', gap: '100', wrap: true },
          children: [
            {
              type: '$each',
              props: {
                items: { $source: { name: 'calendarMonths', options: { offset: { $local: 'monthOffset' } } } },
                as: 'month',
              },
              children: [
                {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    width: 'calc(33.33% - 6px)',
                    variant: { $if: { condition: '$month.isShown', then: 'secondary', else: 'ghost' } },
                    // The offset is computed by the source and read off the row, because
                    // `$setLocal` cannot work out how far away a month is. `from` takes a context
                    // path, so the arithmetic arrives as data.
                    onClick: [
                      { $setLocal: 'monthOffset', from: '$month.offset' },
                      { $setLocal: 'pickerOpen', value: false },
                    ],
                    // The real current month stays marked even while another year is on screen,
                    // so "where am I relative to now" survives paging away.
                    color: { $if: { condition: '$month.isThisMonth', then: 'accent-text', else: '' } },
                  },
                  children: ['$month.label'],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

/**
 * The month, centred, with the way through them either side.
 *
 * Centring is done with equal-width flanks rather than `ax: 'center'` on the row: with "Today"
 * present on one side only, a centred row would push the month off-centre exactly when the button
 * appears — so the heading would shift sideways as you paged away from now, which is the one thing
 * a fixed heading must not do.
 */
const monthNav: SchemaNode = {
  type: 'Row',
  props: { width: '100%', ay: 'center', position: 'relative' },
  children: [
    { type: 'Row', props: { width: '84px' } },
    {
      type: 'Row',
      props: { flex: '1', ax: 'center', ay: 'center', gap: '100' },
      children: [
        step(-1, 'caret-left'),
        {
          type: 'we-button',
          props: {
            variant: 'bare',
            px: '200',
            py: '100',
            r: '300',
            hoverProps: { bg: 'surface-hover' },
            onClick: { $toggleLocal: 'pickerOpen' },
          },
          children: [
            {
              type: 'we-text',
              props: {
                fontWeight: 'semibold',
                text: { $source: { name: 'monthLabel', options: { offset: { $local: 'monthOffset' } } } },
              },
            },
          ],
        },
        step(1, 'caret-right'),
      ],
    },
    {
      type: 'Row',
      props: { width: '84px', ax: 'end' },
      children: [
        {
          /*
            Only when it would do something.

            "Today" on a calendar already showing today is a button that cannot be pressed to any
            effect, and one sitting there permanently reads as a label for the month beside it —
            which is what made the old header ambiguous: "Today" next to "August 2026" looks like
            it is naming what you are looking at.
          */
          type: '$if',
          props: {
            condition: { $local: 'monthOffset' },
            then: {
              type: 'we-button',
              props: { size: 'xs', variant: 'ghost', onClick: { $setLocal: 'monthOffset', value: 0 } },
              children: ['Today'],
            },
          },
        },
      ],
    },
    /*
      Clicking away closes the picker.

      A full-viewport catcher behind the panel, because the schema layer has no click-outside and a
      popover that only closes via the control that opened it is a trap on touch. Transparent and
      beneath the panel in the stack, so it swallows the next click anywhere else and nothing more.
    */
    {
      type: '$if',
      props: {
        condition: { $local: 'pickerOpen' },
        then: {
          type: 'div',
          props: {
            style: { position: 'fixed', inset: '0', zIndex: 10 },
            onClick: { $setLocal: 'pickerOpen', value: false },
          },
        },
      },
    },
    monthPicker,
  ],
};

/**
 * The month grid — a fragment, not a component.
 *
 * Every cell here is template-owned: the dot could be an event chip, a count, a heat-map square, and
 * a community could fork this into a week view without touching code. That is the point of building
 * it this way rather than reaching for the `Calendar` component, which owns its own grid and can
 * only be styled from outside.
 *
 * The days come from `$source`, which is the one thing a schema cannot compute for itself — which
 * weekday the 1st falls on, how long the month is, how many cells make whole weeks. Code answers
 * that; the drawing is data. Same division the graph makes between an expander and a renderer.
 *
 * `Calendar` still exists and is still the right thing for *picking* a date — it is a form control.
 * This is a data view that happens to be shaped like one.
 */
const monthGrid: SchemaNode = {
  type: 'Column',
  props: { width: '100%', gap: '300', bg: 'surface-sunken', border: '1px solid border', r: '500', p: '400' },
  children: [
    monthNav,

    // ── Weekday headings ─────────────────────────────────────────────────────
    {
      type: 'Row',
      props: { width: '100%', gap: '100' },
      children: [
        {
          type: '$each',
          props: { items: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'], as: 'weekday' },
          children: [
            {
              type: 'Row',
              props: { flex: '1', ax: 'center' },
              children: [{ type: 'we-text', props: { variant: 'footnote', color: 'text-muted', text: '$weekday' } }],
            },
          ],
        },
      ],
    },

    // ── The days ─────────────────────────────────────────────────────────────
    {
      type: 'Row',
      props: { width: '100%', gap: '100', styles: { 'flex-wrap': 'wrap' } },
      children: [
        {
          type: '$each',
          props: {
            items: { $source: { name: 'calendarMonth', options: { offset: { $local: 'monthOffset' } } } },
            as: 'cell',
          },
          children: [
            {
              type: 'Column',
              props: {
                // Seven to a row, by width rather than by a grid the schema cannot express.
                width: 'calc(14.28% - 6px)',
                minHeight: '92px',
                gap: '050',
                p: '100',
                r: '300',
                cursor: 'pointer',
                overflow: 'hidden',
                /*
                  Selection is a tint and an outline rather than a solid fill.

                  A filled cell was right when the cell held one number; with titles in it the fill
                  wins every contrast fight against its own contents, and the chips have to be
                  restyled to survive it. The outline says "this one" just as clearly and leaves
                  what is inside legible.
                */
                bg: {
                  $if: {
                    condition: { $eq: ['$cell.date', { $local: 'day' }] },
                    then: 'accent-muted',
                    else: { $if: { condition: '$cell.inMonth', then: '', else: 'page' } },
                  },
                },
                border: {
                  $if: {
                    condition: { $eq: ['$cell.date', { $local: 'day' }] },
                    then: '1px solid primary-500',
                    else: '1px solid transparent',
                  },
                },
                hoverProps: {
                  bg: {
                    $if: {
                      condition: { $eq: ['$cell.date', { $local: 'day' }] },
                      then: 'accent-muted',
                      else: 'surface-sunken',
                    },
                  },
                },
                /*
                  Clicking the selected day again clears the selection.

                  The `$if` sits *inside* the handler array so it is evaluated when the click
                  happens rather than when the cell renders — entries resolve lazily, which is what
                  lets one handler read the state it is about to change.

                  Worth having even though "Show all" does the same job: pressing a thing again to
                  undo it is the first thing anyone tries, and a selection that can only be
                  released from a control somewhere else reads as stuck rather than as filtered.
                */
                onClick: [
                  {
                    $if: {
                      condition: { $eq: ['$cell.date', { $local: 'day' }] },
                      then: { $setLocal: 'day', value: '' },
                      else: { $setLocal: 'day', from: '$cell.date' },
                    },
                  },
                ],
              },
              children: [
                {
                  // The date, top-left, the way every month view puts it — and today's in a filled
                  // disc, which is the one convention people read without being taught.
                  type: 'Row',
                  props: {
                    width: '20px',
                    height: '20px',
                    ax: 'center',
                    ay: 'center',
                    r: 'pill',
                    bg: { $if: { condition: '$cell.isToday', then: 'accent', else: '' } },
                  },
                  children: [
                    {
                      type: 'we-text',
                      props: {
                        fontSize: '100',
                        text: '$cell.day',
                        // Today first — its disc decides the colour. Then the neighbouring months,
                        // which stay visible but recede.
                        color: {
                          $if: {
                            condition: '$cell.isToday',
                            then: 'on-accent',
                            else: { $if: { condition: '$cell.inMonth', then: 'text', else: 'text-faint' } },
                          },
                        },
                        fontWeight: { $if: { condition: '$cell.isToday', then: 'semibold', else: '' } },
                      },
                    },
                  ],
                },
                /*
                  What is actually on that day.

                  Two titles, then a marker if there are more — the shape every month view uses,
                  and the reason is that a month view answers "what kind of week is this" at a
                  glance and hands the detail to the day panel below. A dot could say only that
                  *something* was there; a title says whether it is worth clicking.

                  `$filter` rather than a per-cell `$query`: one subscription for the month is
                  hoisted once and sifted 42 times, where 42 queries would be 42 subscriptions for
                  data the grid already holds.
                */
                {
                  type: '$each',
                  props: {
                    items: {
                      $filter: {
                        items: eventsQuery,
                        where: { startDate: { startsWith: '$cell.date' } },
                        limit: 2,
                      },
                    },
                    as: 'mark',
                  },
                  children: [
                    {
                      type: 'we-text',
                      props: {
                        width: '100%',
                        fontSize: '100',
                        truncate: true,
                        px: '100',
                        r: '200',
                        text: '$mark.title',
                        // Faded for the neighbouring months, so a busy 1st of next month does not
                        // read as part of the month being looked at.
                        bg: { $if: { condition: '$cell.inMonth', then: 'accent-muted', else: 'surface-sunken' } },
                        color: { $if: { condition: '$cell.inMonth', then: 'accent-text', else: 'text-muted' } },
                      },
                    },
                  ],
                },
                {
                  /*
                    "more" without a number, because the schema layer has no arithmetic — the count
                    of what is *not* shown is a subtraction it cannot do. The number matters less
                    than the fact that the cell is not the whole story, and clicking gives the rest.
                  */
                  type: '$if',
                  props: {
                    condition: {
                      $gt: [
                        {
                          $count: {
                            items: {
                              $filter: { items: eventsQuery, where: { startDate: { startsWith: '$cell.date' } } },
                            },
                          },
                        },
                        2,
                      ],
                    },
                    then: {
                      type: 'we-text',
                      props: { fontSize: '100', color: 'text-muted', px: '100', text: 'more…' },
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
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
  props: { width: '100%', gap: '200', bg: 'surface-sunken', r: '300', p: '400' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'calendar', color: 'accent-text' } },
        { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['$event.title'] },
        {
          type: 'we-text',
          props: { fontSize: '200', color: 'text', ml: 'auto' },
          children: [{ type: 'we-timestamp', props: { value: '$event.startDate' } }],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: '$event.description',
        then: { type: 'we-text', props: { color: 'text' }, children: ['$event.description'] },
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
            { type: 'we-icon', props: { name: 'map-pin', color: 'text-muted' } },
            { type: 'we-text', props: { fontSize: '200', color: 'text' }, children: ['$event.location'] },
          ],
        },
      },
    },
    agentByline({ did: '$event.author', as: 'organiser', timestamp: '$event.createdAt' }),
  ],
};

/**
 * Creating an event by hand — the other way records get here, beside extraction.
 *
 * The drafts are declared on the modal, so closing discards them. See the same note on the tasks
 * composer for why that beats clearing them in `onSuccess`.
 */
const composer: SchemaNode = formModal({
  open: { $local: 'composerOpen' },
  close: { $setLocal: 'composerOpen', value: false },
  title: 'New event',
  size: 'sm',
  localState: {
    draftTitle: { type: 'string', initial: '' },
    draftStart: { type: 'string', initial: '' },
    draftLocation: { type: 'string', initial: '' },
  },
  children: [
    field({ name: 'draftTitle', label: 'What is it?', placeholder: 'Design review' }),
    field({
      name: 'draftStart',
      label: 'When',
      // The same control `EventBlock`'s own editor uses, so a hand-made event and an extracted
      // one carry the same format — which is what lets the grid read both.
      props: { type: 'datetime-local' },
    }),
    field({ name: 'draftLocation', label: 'Where', placeholder: 'Optional' }),
  ],
  // Title and a time are what the model requires; anything else is optional here too.
  disabled: { $or: [{ $not: { $local: 'draftTitle' } }, { $not: { $local: 'draftStart' } }] },
  discardWhen: {
    $or: [{ $local: 'draftTitle' }, { $local: 'draftStart' }, { $local: 'draftLocation' }],
  },
  submitLabel: 'Add event',
  submit: {
    $action: 'model.create',
    args: [
      'EventBlock',
      {
        title: { $local: 'draftTitle' },
        startDate: { $local: 'draftStart' },
        location: { $local: 'draftLocation' },
      },
    ],
  },
});

export const calendarView: TemplateSchema = {
  meta: {
    name: 'Calendar',
    description: "The space's events on a month grid",
    icon: 'calendar',
    role: 'view',
    segment: 'calendar',
  },
  type: 'Column',
  props: { width: '100%', ax: 'center', p: '500' },
  $localState: {
    /** The day the grid has selected, `YYYY-MM-DD`. Empty means "everything scheduled". */
    day: { type: 'string', initial: '' },
    /** Months from today the grid is showing. Paged by `$setLocal … by`, reset by "Today". */
    monthOffset: { type: 'number', initial: 0 },
    /** The jump-to-month panel under the heading. */
    pickerOpen: { type: 'boolean', initial: false },
    /** The gate only — the drafts behind it live on the composer itself. */
    composerOpen: { type: 'boolean', initial: false },
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
                      // The date as a person would say it. `we-timestamp` parses the cell's own
                      // `YYYY-MM-DD` and formats it in the reader's locale, so the heading is not
                      // the machine-readable key the grid matches on.
                      type: 'we-timestamp',
                      props: {
                        value: { $local: 'day' },
                        dateStyle: 'full',
                        // The typography props rather than `we-text`'s `variant`/`uppercase`
                        // shorthands, which are that element's own and not part of the DS layers a
                        // timestamp inherits.
                        fontSize: '100',
                        textTransform: 'uppercase',
                        color: 'text-muted',
                      },
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
                    /*
                      An empty day says so, and offers the thing you are most likely here to do.

                      Worth a real branch rather than rendering nothing: a day with no events and a
                      day whose events have not loaded look identical otherwise, and picking a date
                      to find the panel silently empty reads as the click having failed.
                    */
                    else: {
                      type: 'Column',
                      props: { width: '100%', gap: '300', ay: 'start', bg: 'surface-sunken', r: '300', p: '400' },
                      children: [
                        {
                          type: 'we-text',
                          props: { color: 'text-muted' },
                          children: ['Nothing scheduled on this day.'],
                        },
                        {
                          type: 'we-button',
                          props: {
                            size: 'sm',
                            variant: 'secondary',
                            /*
                              Opens the composer, without prefilling the date — which it should do,
                              and cannot. `$setLocal` sets a literal (`value`) or reads a path off
                              the event or context (`from`); the selected day is a `$local`, which
                              is neither, and `datetime-local` needs a time appended to it anyway.
                              Closing that gap means letting `value` resolve through the prop
                              system, which is a change to every existing `$setLocal` and wants
                              deciding on its own rather than in passing here.
                            */
                            onClick: { $setLocal: 'composerOpen', value: true },
                          },
                          children: ['Add an event'],
                        },
                      ],
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
                      props: { variant: 'footnote', color: 'text-muted', uppercase: true },
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
