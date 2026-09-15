/**
 * What a record that is not a note says on a canvas card: what kind of thing it is, what it is
 * called, and everything it holds.
 *
 * A note is a composed document and draws itself — `BlockRenderer`, through the graph's `record`
 * content. Everything else used to draw its label and nothing more, so a task on the workshop's
 * canvas was a title on a coloured square: no state, no due date, and no sign that it was a task at
 * all rather than a note that happened to be short. This is the rest, derived from the model's own
 * declaration (`recordStore.displays`), so a model a community defined this morning gets a full card
 * with nothing written for it.
 *
 * Two halves, split where the data/code line falls. {@link canvasCard} is computation the expression
 * language lacks — a date in the reader's locale, a state's name and colour looked up by slug — and
 * is pure, so it is tested without mounting anything. {@link CANVAS_RECORD_CARD} is arrangement, a
 * fragment the host renders through `RenderSchema` the way `recordGhost` draws a record under a drag.
 */
import type { SchemaNode } from '@we/schema-shared';

import { modelLabel, type RecordDisplay } from './recordDisplay';

/** One value on a card: a caption, the value as text, and a colour to put beside it if it has one. */
export interface CanvasCardLine {
  /** The property — unique on a card, which is what keys the row. */
  name: string;
  /** The caption. Empty for a summary, which reads as the card's body and needs none. */
  label: string;
  text: string;
  /** A CSS colour for a disc before the text — a state's fill, a colour field's value — or empty. */
  swatch: string;
  /** A state's disc is round; a colour field's swatch is a square, since it is a sample, not a status. */
  swatchRadius: string;
}

export interface CanvasCard {
  /** The model's icon, for the header. */
  icon: string;
  /** The model's name, for the header — "Task", not `TaskBlock`. */
  kind: string;
  /** What the record is called, or empty when it has no name and the header has already said what it is. */
  title: string;
  /** The short values, one line each, in the order the model declares them. */
  lines: CanvasCardLine[];
  /** The prose — a summary, and any other long text — after the short values, where clipping costs least. */
  prose: CanvasCardLine[];
  /**
   * A record extraction made that nobody has kept — the seed's `data.pending`. Drawn with the
   * "suggested" badge a board card and a calendar event carry, so a draft is said in words on the
   * canvas too rather than by its fade and dashed edge alone.
   */
  pending: boolean;
}

/** A state as a card needs it: its slug, what the community calls it, and the colour it is drawn in. */
export interface CanvasCardState {
  slug: string;
  name: string;
  fill: string;
}

export interface CanvasCardInput {
  /** The entity name. */
  type: string;
  /** The name the graph resolved for the node — the same one every other surface shows. */
  label: string;
  /** The record's scalar properties, as the canvas seed read them. */
  data: Record<string, unknown> | undefined;
  /** `recordStore.displays[type]`, or undefined for a model the store does not know. */
  display: RecordDisplay | undefined;
  /** The space's task states, for a value from that vocabulary. */
  states: readonly CanvasCardState[];
  /** The reader's locale; the runtime's own when omitted. Taken so a test can pin it. */
  locale?: string;
}

/** Kinds a card cannot draw as a line of text: an edge, a picture, a file, a blob. */
const UNDRAWABLE = new Set(['relation', 'image', 'file', 'json']);

/**
 * Whether a value is worth a line.
 *
 * `false` is not: a card lists what a record *is*, and "All day: No" on every event is a line saying
 * nothing happened. `0` is — it is a count somebody wrote. An empty string, or a property never
 * written, is left to the inspector, which is where an empty field is offered for filling in.
 */
function holds(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && value !== false;
}

/**
 * A stored date as the reader writes one.
 *
 * A `date` is a calendar day with no time, and is read in UTC: `2026-09-14` parsed as midnight UTC is
 * the thirteenth anywhere west of Greenwich. Anything that will not parse is shown as it was stored
 * rather than as "Invalid Date", which would read as the card failing rather than the data being odd.
 */
function formatDate(value: unknown, kind: 'date' | 'datetime', locale: string | undefined): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const options: Intl.DateTimeFormatOptions =
    kind === 'date' ? { dateStyle: 'medium', timeZone: 'UTC' } : { dateStyle: 'medium', timeStyle: 'short' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function canvasCard(input: CanvasCardInput): CanvasCard {
  const { display, states } = input;
  const data = input.data ?? {};
  const lines: CanvasCardLine[] = [];
  const prose: CanvasCardLine[] = [];

  for (const field of display?.fields ?? []) {
    // The title is the heading and the media is not text; neither is a line.
    if (field.role === 'title' || field.role === 'media' || UNDRAWABLE.has(field.kind)) continue;
    const value = data[field.name];
    if (!holds(value)) continue;

    if (field.role === 'summary' || field.kind === 'longText') {
      prose.push({
        name: field.name,
        label: field.role === 'summary' ? '' : field.label,
        text: String(value),
        swatch: '',
        swatchRadius: '',
      });
      continue;
    }

    const line: CanvasCardLine = {
      name: field.name,
      label: field.label,
      text: String(value),
      swatch: '',
      swatchRadius: '',
    };
    if (field.vocabulary === 'taskState') {
      /*
        A slug from the community's own list, shown as what the community calls it and in its colour
        — "In review", not `in-review`. A slug nothing defines any more shows as itself, with no
        colour, so the card still says where the work is.
      */
      const state = states.find((candidate) => candidate.slug === value);
      if (state) {
        line.text = state.name || state.slug;
        line.swatch = state.fill;
        line.swatchRadius = '50%';
      }
    } else if (field.kind === 'date' || field.kind === 'datetime') {
      line.text = formatDate(value, field.kind, input.locale);
    } else if (field.kind === 'boolean') {
      line.text = 'Yes';
    } else if (field.kind === 'color') {
      line.swatch = String(value);
      line.swatchRadius = '2px';
    }
    lines.push(line);
  }

  return {
    icon: display?.icon || 'cube',
    kind: display?.label || modelLabel(input.type),
    // With no name of its own, the graph labels a node with its entity name — which the header says.
    title: input.label && input.label !== input.type ? input.label : '',
    lines,
    prose,
    pending: data.pending === true,
  };
}

/** Quieter than the value beside it: the card's own ink, faded, rather than a role measured against the page. */
const CAPTION = "line.label ? 'opacity: 0.65; margin-inline-end: 0.35em;' : 'display: none;'";

/**
 * The card, as a fragment. One name in scope, `card`, holding a {@link CanvasCard} the host keeps
 * current; it reads no store, which is why the host renders it with none.
 *
 * ## Native elements, and no `Row` or `Column`
 *
 * A card can be a triangle, a diamond, a pentagon, a hexagon or an ellipse. Text reaches those shapes
 * through two floats hugging the outline (`.we-graph__card-flow`), and a float shapes only the *lines*
 * laid out beside it. A flex box starts a formatting context of its own, which is placed clear of
 * both floats — they are the card's full height — so a header built as a `Row` would land below the
 * card and be clipped away on every shaped card. Everything here is a block whose contents are
 * inline, so each line wraps to whatever the shape leaves it, as a note's paragraphs do.
 *
 * ## No `$if`
 *
 * `$if` draws its branch inside two block wrappers, one of which sets `pointer-events: auto` — a
 * value would drop to a line of its own, and the card content, which keeps pointer events off so the
 * graph owns every gesture on a card, would grow a hole. Absent parts collapse instead: an empty
 * `div` has no height, and a caption or swatch with nothing to show is `display: none`.
 *
 * ## Inline `style`, in `em`
 *
 * Design-system props are not applied to native elements, and a role colour would be wrong here
 * anyway: the card's ink is chosen against its own fill. Sizes in `em`, so the card's content scale
 * and the graph's label size reach every part of it.
 */
export const CANVAS_RECORD_CARD: SchemaNode = {
  type: 'div',
  children: [
    /*
      What kind of thing this is, above what it is called. Small and quiet — the heading is what a
      card is read by, and this is what tells a task from an event at a glance when no lens is
      colouring them apart.
    */
    {
      type: 'div',
      props: { style: 'font-size: 0.8em; letter-spacing: 0.02em; margin-bottom: 0.15em;' },
      children: [
        /*
          "suggested", at the header's right end — the badge a draft carries on a board and in the
          calendar, in the same solid warning fill and ink. Floated rather than pushed by a flex row, for
          the reason in the doc above: a float still shapes the lines beside it inside a cut card. First
          in the header so it floats level with the kind.

          A span in `em` rather than `we-badge`. The primitive is a control-height box in pixels, which
          on a card whose every other size is `em` came out taller than the header row and pushed into
          the title under it — and did not shrink when the card's content was scaled down. Sized off the
          header's own text, it is one line of it, and scales with everything else on the card.

          The badge's proportions rather than its pixels: regular weight, a corner about a third of its
          height — which is what an `xs` badge's 8px radius on 24px comes to — and padding the width of
          half its text. A pill and bold text read as a different element from the one on the board.
        */
        {
          type: 'span',
          props: {
            style: {
              $: "card.pending ? 'float: right; margin-inline-start: 0.4em; padding: 0 0.5em; border-radius: 0.4em; font-size: 0.8em; font-weight: 400; line-height: 1.5; background: var(--we-role-warning); color: var(--we-role-on-warning);' : 'display: none;'",
            },
          },
          children: ['suggested'],
        },
        {
          type: 'span',
          props: { style: 'display: inline-flex; vertical-align: -0.15em; margin-inline-end: 0.3em; opacity: 0.7;' },
          children: [{ type: 'we-icon', props: { name: { $: 'card.icon' }, size: '1.1em' } }],
        },
        { type: 'span', props: { style: 'opacity: 0.7;' }, children: [{ $: 'card.kind' }] },
      ],
    },
    { type: 'div', props: { style: 'font-weight: 600;' }, children: [{ $: 'card.title' }] },
    {
      type: '$each',
      props: { items: { $: 'card.lines' }, as: 'line' },
      children: [
        {
          type: 'div',
          props: { style: 'margin-top: 0.2em;' },
          children: [
            { type: 'span', props: { style: { $: CAPTION } }, children: [{ $: 'line.label' }] },
            {
              type: 'span',
              props: {
                style: {
                  $: "line.swatch ? 'display: inline-block; width: 0.65em; height: 0.65em; margin-inline-end: 0.3em; vertical-align: 0.02em; box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 30%, transparent); border-radius: ' + line.swatchRadius + '; background: ' + line.swatch + ';' : 'display: none;'",
                },
              },
            },
            { type: 'span', children: [{ $: 'line.text' }] },
          ],
        },
      ],
    },
    // `pre-line` keeps the line breaks somebody typed.
    {
      type: '$each',
      props: { items: { $: 'card.prose' }, as: 'line' },
      children: [
        {
          type: 'div',
          props: { style: 'margin-top: 0.35em; white-space: pre-line;' },
          children: [
            { type: 'span', props: { style: { $: CAPTION } }, children: [{ $: 'line.label' }] },
            { type: 'span', children: [{ $: 'line.text' }] },
          ],
        },
      ],
    },
  ],
};
