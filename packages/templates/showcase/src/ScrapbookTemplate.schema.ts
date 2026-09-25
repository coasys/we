/**
 * A spread somebody laid out by hand — the same posts as the Timeline template, placed rather than
 * arranged.
 *
 * The other templates in this package differ from one another in *arrangement*: a feed, a grid, a
 * board, a calendar. Every one of them derives where things go from the data. This one does not.
 * Its whole subject is a composition an author chose — photographs at odd angles, overlapping,
 * captions tucked into the gaps, running for two and a half screens of scroll — which is the case
 * the layout system had no way to express until there was somewhere to say *what space these
 * coordinates are in*.
 *
 * So it is the demonstration of exactly one thing: `Canvas` plus an `artboard`, and `x` / `y` /
 * `rotate` on ordinary components. There is no scrapbook content type, no placement record and no
 * new store call. A space that has been collecting posts for a year renders as a scrapbook by
 * switching template, and switching back loses nothing, because nothing was converted.
 *
 * ## What it is honest about
 *
 * - **The author placed these, not the reader.** Dragging a photo somewhere and having it stay
 *   needs a placement per pair and a manipulation layer, neither of which is here. The coordinates
 *   below are the template's, and the same for everybody.
 * - **An artboard is a declared size, so this template bounds what it puts on one.** The spread
 *   takes the six most recent posts with pictures; the rest are on `/wall`, arranged. A canvas is
 *   the wrong shape for an unbounded list, and a template that placed one would either overflow its
 *   own coordinate space or have to invent coordinates it did not author.
 * - **It gets small on a phone.** Uniform scale means one authored layout is never *broken* — but a
 *   1200-wide spread in a 380-wide window is drawn at a third, caption text included. That is the
 *   trade the default `fit` makes, and the reason the wall exists beside it.
 */
import type { SchemaNode } from '@we/schema-shared';
import { emptyState, mediaGrid } from '@we/template-kit';

import { composerModal, KIND } from './shared.ts';

/**
 * The coordinate space every number below is in.
 *
 * 1200 wide because that is a comfortable measure for a two-column spread and divides into the
 * positions cleanly; 2600 tall because that is what the six placed photographs plus the closing
 * note come to. Both are the author's units, and neither is a guess about a display — at the
 * default `fit` the canvas scales the whole thing to whatever width it lands in.
 */
const ARTBOARD = { width: 1200, height: 2600 };

/** How many photographs the spread has coordinates for. Beyond this there is the wall. */
const PLACED = 6;

/*
  Where the photographs go, as three tables read by row position.

  Written as literals indexed by `index` rather than as six hand-written nodes, because the scraps
  are *records* — they arrive from a query and there may be four of them or none. This is what the
  freeform-canvas note means by coordinates coming from data: the template authored the arrangement
  and the space supplies what fills it.

  A stepped diagonal rather than a grid. Columns alternate wide-left and wide-right with two
  narrower drops between, so the eye zig-zags down the page the way it does across a real spread,
  and consecutive photographs are never edge-aligned.
*/
const SCRAP_X = '[70, 620, 300, 700, 90, 560]';
const SCRAP_Y = '[560, 760, 1180, 1440, 1840, 2060]';
const SCRAP_ROTATE = '[-4, 3, -2, 5, -3, 2]';
const SCRAP_WIDTH = "['460px', '420px', '380px', '400px', '440px', '460px']";

/** A photograph as a scrap: the picture, a white border, a shadow, and a tilt. */
const photograph: SchemaNode = {
  type: 'Column',
  props: {
    x: { $: `${SCRAP_X}[index]` },
    y: { $: `${SCRAP_Y}[index]` },
    rotate: { $: `${SCRAP_ROTATE}[index]` },
    width: { $: `${SCRAP_WIDTH}[index]` },
    // Later scraps sit in front, so the overlaps read as a pile somebody built up rather than as an
    // accident of load order. A raw number is legal on `zIndex`, not only the named layers.
    zIndex: { $: '10 + index' },
    bg: 'surface',
    p: '300',
    gap: '200',
    r: '200',
    shadow: 'lg',
  },
  children: [
    {
      type: 'we-image',
      props: {
        src: { $: 'scrap.$firstImage.src' },
        alt: { $: 'scrap.$firstImage.altText' },
        fit: 'cover',
        loading: 'lazy',
        width: '100%',
        r: '100',
        styles: { 'aspect-ratio': '4 / 3' },
      },
    },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-muted', truncate: true },
      children: [{ $: "scrap.title ?? scrap.textContent ?? ''" }],
    },
  ],
};

/**
 * A scrap that is not a photograph — a title card, a caption, a torn note.
 *
 * A helper rather than six written-out Columns because the only thing that differs between them is
 * where they sit and what they say, and a table of coordinates is legible in a way six near-identical
 * nodes are not.
 */
function note(opts: {
  x: number;
  y: number;
  rotate: number;
  width: string;
  z?: number;
  tone?: 'paper' | 'tape' | 'plain';
  children: SchemaNode[];
}): SchemaNode {
  const tone = opts.tone ?? 'paper';
  return {
    type: 'Column',
    props: {
      x: opts.x,
      y: opts.y,
      rotate: opts.rotate,
      width: opts.width,
      zIndex: opts.z ?? 30,
      gap: '200',
      ...(tone === 'paper' && { bg: 'surface-sunken', p: '400', r: '200', shadow: 'md' }),
      ...(tone === 'tape' && {
        // Masking tape: a warm translucent band, drawn with a gradient rather than an asset so the
        // template stays a single file of data.
        bgImage: 'linear-gradient(105deg, rgba(226, 200, 140, 0.85), rgba(214, 186, 122, 0.7))',
        height: '38px',
        r: '0',
      }),
    },
    children: opts.children,
  };
}

/** The spread itself. Everything in here is placed against {@link ARTBOARD}. */
const spread: SchemaNode = {
  type: 'Canvas',
  props: { artboard: ARTBOARD, width: '100%' },
  /*
    Hoisted rather than left on the `$each`, for the ordinary reason — the count is readable from
    outside the loop, so the empty state and the spread cannot disagree about how many there are —
    and for one particular to a canvas: the limit is the artboard's, and it belongs beside it.
  */
  $queries: {
    scraps: {
      entity: 'CollectionBlock',
      where: { kind: KIND.post, author: { not: { $: 'spaceStore.mutedDids' } } },
      order: { createdAt: 'desc' },
      limit: PLACED,
      include: { $firstImage: { from: 'children', limit: 1 } },
    },
  },
  children: [
    note({
      x: 90,
      y: 80,
      rotate: -2,
      width: '620px',
      tone: 'plain',
      children: [
        {
          type: 'we-text',
          props: { variant: 'heading-xl', fontFamily: 'boldonse' },
          children: [{ $: 'spaceStore.currentSpace.name' }],
        },
        {
          type: 'we-text',
          props: { variant: 'ingress', color: 'text-muted' },
          children: [{ $: "spaceStore.currentSpace.description ?? ''" }],
        },
      ],
    }),
    note({ x: 700, y: 150, rotate: 8, width: '180px', z: 40, tone: 'tape', children: [] }),
    note({
      x: 660,
      y: 300,
      rotate: 3,
      width: '420px',
      children: [
        {
          type: 'we-text',
          props: { variant: 'body' },
          children: ['Everything on this page is a post in this space. Nothing here is a scrapbook.'],
        },
      ],
    }),
    {
      type: '$each',
      props: { items: { $: 'local.scraps' }, as: 'scrap' },
      children: [
        {
          /*
            Only rows carrying a picture. A spread is a promise that every scrap is something to
            look at, and an empty white frame at an angle reads as a broken image rather than as a
            post that happened to be text.
          */
          type: '$if',
          props: { condition: { $: 'scrap.$firstImage.src' }, then: photograph },
        },
      ],
    },
    /*
      The closing note arrives as you reach it.

      `$animate` wraps the placed scrap rather than the other way round: the wrapper is the element
      the observer watches, and it is a child of the artboard, so it is what carries the
      coordinates. Placing the inner node instead would translate it away from a wrapper still
      sitting at the origin — the reveal would fire for a box nowhere near the content.
    */
    {
      type: '$animate',
      props: {
        scrollReveal: -80,
        enterTransition: [
          { type: 'fade', duration: 600 },
          { type: 'slide', direction: 'up', distance: '48px', duration: 700 },
        ],
      },
      children: [
        note({
          x: 120,
          y: 2380,
          rotate: -1,
          width: '520px',
          children: [
            {
              type: 'we-text',
              props: { variant: 'subheading' },
              children: ['That is the end of the spread.'],
            },
            {
              type: 'we-text',
              props: { color: 'text-muted' },
              children: ['Everything else this space holds is on the wall.'],
            },
            {
              type: 'we-button',
              props: {
                variant: 'secondary',
                size: 'sm',
                alignSelf: 'start',
                onClick: { $action: 'routeStore.navigate', args: ['./wall'] },
              },
              children: ['Open the wall'],
            },
          ],
        }),
      ],
    },
    {
      /*
        Phrased as "nothing here" rather than as an `else` on "something here": the spread's scraps
        are drawn by the `$each` above, so the branch with content is not a node this could be the
        other arm of. A `$if` with only an `else` is refused, and rightly — it reads as a missing
        `then` rather than as a deliberate one-sided test.
      */
      type: '$if',
      props: {
        condition: { $: 'local.scrapsLoaded && count(local.scraps) == 0' },
        then: note({
          x: 90,
          y: 620,
          rotate: -1,
          width: '520px',
          children: [
            emptyState({
              icon: 'image',
              label: 'pictures',
              message: 'Add a post with a picture in it and it will be pasted in here.',
            }),
          ],
        }),
      },
    },
  ],
};

const header: SchemaNode = {
  type: 'Row',
  props: {
    width: '100%',
    ax: 'between',
    ay: 'center',
    px: '500',
    py: '300',
    bg: 'surface',
    borderBottom: '1px solid border',
    position: 'sticky',
    top: '0',
    zIndex: 'sticky',
  },
  $localState: { composeOpen: { type: 'boolean', initial: false } },
  children: [
    {
      type: 'we-button',
      props: { variant: 'bare', onClick: { $action: 'routeStore.navigate', args: ['.'] } },
      children: [
        {
          type: 'we-text',
          props: { variant: 'heading-sm' },
          children: [{ $: 'spaceStore.currentSpace.name' }],
        },
      ],
    },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        {
          type: 'we-button',
          props: { variant: 'ghost', size: 'sm', onClick: { $action: 'routeStore.navigate', args: ['./wall'] } },
          children: [{ type: 'we-icon', props: { name: 'squares-four' } }, 'Wall'],
        },
        {
          type: 'we-button',
          props: { variant: 'primary', size: 'sm', onClick: { $setLocal: 'composeOpen', value: true } },
          children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Add'],
        },
        composerModal({ openLocal: 'composeOpen', title: 'Add to the scrapbook', kind: KIND.post }),
      ],
    },
  ],
};

export const scrapbookTemplate = {
  meta: {
    name: 'Scrapbook',
    description: 'The space as a spread somebody laid out by hand — placed, not arranged.',
    icon: 'scissors',
  },
  type: 'Column',
  props: { bg: 'page', width: '100%', minHeight: '100%' },
  children: [header, { type: '$routes' }],
  routes: [
    {
      path: '/',
      type: 'Column',
      props: { width: '100%', ax: 'center', px: '400', py: '500' },
      children: [
        {
          type: 'Column',
          props: { width: '100%', maxWidth: 'var(--we-layout-lg)' },
          children: [spread],
        },
      ],
    },
    {
      /*
        The same records, arranged rather than placed — and the honest home for a list that has no
        end. The contrast is the point: the spread is a composition, the wall is a query.
      */
      path: '/wall',
      type: 'Column',
      props: { width: '100%', ax: 'center', p: '400', gap: '400' },
      children: [
        {
          type: 'Column',
          props: { width: '100%', maxWidth: 'var(--we-layout-lg)', gap: '400' },
          children: [
            { type: 'we-text', props: { variant: 'heading-md' }, children: ['Everything else'] },
            mediaGrid({
              kind: KIND.post,
              empty: emptyState({ icon: 'image', label: 'pictures' }),
            }),
          ],
        },
      ],
    },
    {
      path: '*',
      type: 'Column',
      props: { p: '600', ax: 'center' },
      children: [{ type: 'we-text', props: { color: 'text-faint' }, children: ['Not found.'] }],
    },
  ],
};
