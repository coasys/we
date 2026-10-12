/**
 * A list in time order that loads more as the reader reaches an edge — a transcript, a feed, a
 * channel's messages — with the newest at the bottom or the top.
 *
 * ## Two choices, and why they are separate
 *
 * **Which end the window is anchored to** (`fromStart`): following the live end, the newest rows are
 * loaded and the window grows back in time; read from the start, the oldest are loaded and it grows
 * forward. That is a question about what is being read, and it changes the query.
 *
 * **Which way round the rows are drawn** (`orientation`): `newestBottom`, as a chat reads, or
 * `newestTop`, as a feed does. That is a reader's preference and changes nothing about what is
 * loaded — only which edge holds what, so which edge is pinned, which edge loads more, and which
 * corner each jump button means.
 *
 * The four combinations come down to one question: is the anchored end at the bottom? It is when the
 * reader follows the live end with the newest at the bottom, or reads from the start with the newest
 * at the top. Everything below is that question, asked once.
 *
 * ## The rows stay the caller's
 *
 * A timeline's query, its rows and its markers live wherever the caller keeps them — the transcript
 * keeps them in a part a template can place elsewhere. So this is three pieces that agree by
 * construction rather than one node that owns the list: {@link timeline} is the scroller,
 * {@link timelineOrder} turns the queried rows into the order they are drawn in, and
 * {@link timelineMoreAt} says which edge the "more is coming" marker belongs at. The query itself
 * asks newest-first while following the live end and oldest-first from the start — the order a
 * window grows in.
 *
 * Names no store: the anchor and the orientation arrive as expressions.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import { panelScroll } from './panelShell.ts';

/** The two ways round a timeline is drawn. */
export type TimelineOrientation = 'newestBottom' | 'newestTop';

/** Whether the anchored end is the bottom one — see the module comment. An expression. */
function anchoredAtBottom(fromStart: string, orientation: string): string {
  return `((${fromStart}) == ((${orientation}) == 'newestTop'))`;
}

/**
 * The rows in the order they are drawn, top to bottom.
 *
 * `items` is the query's answer, newest-first while following the live end and oldest-first from the
 * start. Reversed exactly when the anchored end is the bottom — which is also when the scroller is
 * pinned there — so the row nearest the anchor is always the first the query returned.
 */
export function timelineOrder(items: string, fromStart: string, orientation: string): string {
  return `(${anchoredAtBottom(fromStart, orientation)} ? reverse(${items}) : ${items})`;
}

/**
 * Whether the "more is coming" marker belongs at this edge: the one away from the anchor, which is
 * where the window grows. Pair it with the marker's own `data-we-more` set to the same edge, so the
 * scroller's jump button at that end asks for the other end's query instead of scrolling.
 */
export function timelineMoreAt(end: 'start' | 'end', fromStart: string, orientation: string): string {
  const atBottom = anchoredAtBottom(fromStart, orientation);
  return end === 'start' ? atBottom : `!${atBottom}`;
}

export interface TimelineOptions {
  /** True while the window is anchored at the oldest end. An expression. */
  fromStart: string;
  /** `newestBottom` or `newestTop`. An expression, so a reader's preference can drive it. */
  orientation: string;
  /** The rows, their query, and the markers — see {@link timelineOrder} and {@link timelineMoreAt}. */
  children: SchemaNode[];
  /** Grow the window back in time, while following the live end. */
  onLoadOlder: SchemaProp;
  /** Grow it forward, while reading from the start. */
  onLoadNewer: SchemaProp;
  /** Re-anchor at the newest end — "back to now". */
  onJumpNewest: SchemaProp;
  /** Re-anchor at the oldest end — "from the beginning". */
  onJumpOldest: SchemaProp;
  /** How far before an edge the next page is asked for, in pixels. About a panel's height. */
  runway?: number;
  /** The panel's padding token — see `panelScroll`. */
  inset?: string;
}

/**
 * The scroller of a timeline: pinned at the anchored end, loading more at the other, with a jump to
 * each end that re-anchors rather than scrolling to the edge of what happens to be loaded.
 *
 * Loading is guarded by which end is anchored and not by whether there is more — the rows are the
 * caller's, inside this node, and an event on the scroller reaches its ancestors, never the content.
 * So reaching the far edge of a fully loaded list asks once for a page that comes back unchanged.
 */
export function timeline(opts: TimelineOptions): SchemaNode {
  const atBottom = anchoredAtBottom(opts.fromStart, opts.orientation);
  const topIsNewest = `(${opts.orientation}) == 'newestTop'`;
  const grow: SchemaProp = {
    $if: { condition: { $: opts.fromStart }, then: opts.onLoadNewer, else: opts.onLoadOlder },
  };
  const runway = opts.runway ?? 400;
  return panelScroll({
    ...(opts.inset ? { inset: opts.inset } : {}),
    // Pinned where the anchor is: at the bottom it follows new rows in, at the top it holds still
    // while they arrive below — which is the natural behaviour of a top-anchored scroll.
    pin: { $: `${atBottom} ? 'end' : ''` },
    jump: 'both',
    onJumpStart: { $if: { condition: { $: topIsNewest }, then: opts.onJumpNewest, else: opts.onJumpOldest } },
    onJumpEnd: { $if: { condition: { $: topIsNewest }, then: opts.onJumpOldest, else: opts.onJumpNewest } },
    nearStart: runway,
    onNearStart: { $if: { condition: { $: atBottom }, then: grow } },
    nearEnd: runway,
    onNearEnd: { $if: { condition: { $: `!${atBottom}` }, then: grow } },
    children: opts.children,
  });
}
