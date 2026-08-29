import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import type { Content } from '../types.ts';

/**
 * A small square standing for one record — a post, a space, a person, an image.
 *
 * It is what follows the pointer during a drag, and what a grid of gathered things is made of. One
 * fragment for both, because they are the same claim: *this is that thing*, at a size where the
 * only honest content is a picture and a name.
 *
 * ## Why a fragment rather than a primitive
 *
 * Because it is arrangement. There is no measurement in it, no focus management, no browser API —
 * a box, a picture, two lines of text. The argument for a primitive was that `@we/drag` cannot
 * mount a fragment, which is true and beside the point: the package does not mount it, the **host**
 * does, through the renderer seam `setGhostRenderer` opens. That is the graph engine's arrangement
 * for card content, second occurrence, and it exists precisely so the thing being drawn can stay on
 * the data side of the line.
 *
 * Which matters here more than usual. What a record looks like is exactly the kind of thing a
 * community will want to change, and a fragment can be forked, themed and — once fragments are
 * distributable at all — shared. A primitive freezes it into whatever WE shipped.
 *
 * ## What it can draw, in order
 *
 * `thumbnail`, then `content`, then the icon. Each is what the *source* had in hand at the moment
 * of the drag: nothing here resolves anything, because a ghost has to exist on the frame the
 * gesture begins and a Pocket row may point into a dataset the reader has never joined.
 *
 * `content` is the interesting one — a real rendering of the composition, laid out at
 * `contentWidth` and scaled down into the tile, which is how a post shows its own picture without
 * anybody denormalising one onto it. Text at this size is texture rather than words, which is the
 * same conclusion the graph's `contentMinZoom` reached about card content on a zoomed-out board.
 */
export interface RecordCardOptions {
  /** The label — a title, a name, the first line of a post. */
  label?: Content;
  /** A Phosphor name, drawn when there is no picture and no content. */
  icon?: SchemaProp;
  /** A picture standing for the record: a cover, an avatar, an image's `src`. Wins over `content`. */
  thumbnail?: SchemaProp;
  /**
   * The composition itself, as a node — a `BlockRenderer`, for a post. Laid out at `contentWidth`
   * and scaled into the tile, so it reads as a thumbnail of the real thing.
   */
  content?: SchemaNode;
  /** Who made it. Any part may be omitted; with none of them the line is not drawn. */
  byline?: { name?: Content; avatar?: SchemaProp; hash?: SchemaProp };
  /** When, as anything `we-timestamp` takes. Shown beside the byline. */
  date?: SchemaProp;
  /** Where it came from — a space's name. Shown in the byline's place when there is no byline. */
  source?: Content;
  /** The edge of the square. */
  size?: string;
  /** The width `content` is laid out at before being scaled down. */
  contentWidth?: string;
  /** Dimmed and un-pointable, for the tile under the pointer rather than the one in the grid. */
  ghost?: boolean;
}

const DEFAULT_SIZE = '100px';
/*
  Wide enough that a paragraph wraps the way it does in a feed, so the scaled result reads as a page
  of text rather than as one long line. Narrower and every block becomes a column of single words.
*/
const DEFAULT_CONTENT_WIDTH = '320px';

/**
 * The ratio to draw `content` at.
 *
 * Computed here where both are plain pixel values, and left to CSS where either is not: `scale()`
 * accepts a `calc()`, so a caller sizing a tile in `em` or a custom property still works — it just
 * cannot be checked at authoring time.
 */
function scaleFactor(size: string, contentWidth: string): string {
  const px = (value: string) => (/^\d+(\.\d+)?px$/.test(value) ? Number.parseFloat(value) : null);
  const outer = px(size);
  const inner = px(contentWidth);
  if (outer !== null && inner !== null && inner > 0) return (outer / inner).toFixed(4);
  return `calc(${size} / ${contentWidth})`;
}

/**
 * A gradient from the surface colour up to nothing, so a caption stays readable over any picture.
 *
 * Built from the role rather than from black: a light theme's tiles are pale, and a black scrim on
 * one reads as a bruise. `color-mix` against `transparent` is how a role gets an alpha — the token
 * set has no translucent variants, deliberately, since which of them would be needed is unknowable.
 */
const SCRIM = [
  'linear-gradient(to top',
  'var(--we-role-surface) 0%',
  'color-mix(in srgb, var(--we-role-surface) 78%, transparent) 55%',
  'transparent 100%)',
].join(', ');

export function recordCard(opts: RecordCardOptions): SchemaNode {
  const size = opts.size ?? DEFAULT_SIZE;
  const contentWidth = opts.contentWidth ?? DEFAULT_CONTENT_WIDTH;

  return {
    type: 'Column',
    props: {
      position: 'relative',
      width: size,
      height: size,
      minWidth: size,
      r: '400',
      bg: 'surface',
      border: '1px solid border',
      overflow: 'hidden',
      // A ghost is feedback, not a control: it must never take the pointer, and it should read as
      // in-flight rather than as one more tile that happens to be floating.
      ...(opts.ghost && { pointerEvents: 'none', shadow: 'lg', opacity: 0.95 }),
    },
    children: [media(opts, size, contentWidth), ...caption(opts)],
  };
}

/** The picture, the scaled content, or the icon — whichever the source had. */
function media(opts: RecordCardOptions, size: string, contentWidth: string): SchemaNode {
  const fill = { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%' } as const;

  const icon: SchemaNode = {
    type: 'Column',
    props: { ...fill, bg: 'surface-sunken', ax: 'center', ay: 'center' },
    children: [{ type: 'we-icon', props: { name: opts.icon ?? 'file', size: 'lg', color: 'text-faint' } }],
  };

  const drawn: SchemaNode = opts.content
    ? {
        type: 'Column',
        props: { ...fill, bg: 'surface', overflow: 'hidden' },
        children: [
          {
            /*
              Laid out at its natural width and shrunk, rather than rendered into a 100px box.
              Rendering it small would re-flow every paragraph into a column one word wide; scaling
              keeps the shape of the composition, which is the only thing legible at this size.

              `transform-origin` matters as much as the scale: the default centre would leave the
              tile showing the middle of the document, and what somebody recognises a post by is
              its top.
            */
            type: 'Column',
            props: {
              width: contentWidth,
              transform: `scale(${scaleFactor(size, contentWidth)})`,
              // No DS prop covers this, and there is no sensible one to add: it exists only to pair
              // with a transform, which is itself an escape hatch.
              styles: { 'transform-origin': 'top left' },
              // The pointer never reaches a ghost, but a grid tile is clickable as a whole and the
              // content inside it must not intercept that.
              pointerEvents: 'none',
            },
            children: [opts.content],
          },
        ],
      }
    : icon;

  // `thumbnail` is an expression, so which of these applies is only known at render time. The
  // content-or-icon choice is made here, at authoring time, because a node either exists or does not.
  if (opts.thumbnail === undefined) return drawn;
  return {
    type: '$if',
    props: {
      condition: opts.thumbnail,
      then: {
        type: 'we-image',
        props: { src: opts.thumbnail, fit: 'cover', ...fill },
      },
      else: drawn,
    },
  };
}

/**
 * The name, and who or where it came from.
 *
 * Overlaid rather than placed under the picture: at this size a caption in flow would take a third
 * of the tile and leave a stamp of the thing it is naming.
 */
function caption(opts: RecordCardOptions): SchemaNode[] {
  const secondLine: SchemaNode[] = [];

  // `hash` alone is enough to draw something: it produces an identicon, which is what an
  // unresolved person looks like everywhere else in WE and is never two blank discs.
  if (opts.byline?.name !== undefined || opts.byline?.avatar !== undefined || opts.byline?.hash !== undefined) {
    secondLine.push({
      type: 'we-avatar',
      props: {
        ...(opts.byline.avatar !== undefined && { image: opts.byline.avatar }),
        ...(opts.byline.name !== undefined && { initials: opts.byline.name }),
        ...(opts.byline.hash !== undefined && { hash: opts.byline.hash }),
        size: 'xxs',
      },
    });
  }

  const words = opts.byline?.name ?? opts.source;
  if (words !== undefined) {
    secondLine.push({
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-muted', truncate: true, flex: '1', minWidth: '0' },
      children: [words],
    });
  }

  if (opts.date !== undefined) {
    secondLine.push({
      type: 'we-timestamp',
      props: { value: opts.date, relative: true, fontSize: '100', color: 'text-faint', flexShrink: '0' },
    });
  }

  if (opts.label === undefined && !secondLine.length) return [];

  return [
    {
      type: 'Column',
      props: {
        position: 'absolute',
        bottom: '0',
        left: '0',
        width: '100%',
        p: '200',
        gap: '0',
        bgImage: SCRIM,
      },
      children: [
        ...(opts.label === undefined
          ? []
          : [
              {
                type: 'we-text',
                props: { variant: 'footnote', fontWeight: 'semibold', truncate: true, width: '100%' },
                children: [opts.label],
              } as SchemaNode,
            ]),
        ...(secondLine.length
          ? [{ type: 'Row', props: { gap: '100', ay: 'center', width: '100%' }, children: secondLine } as SchemaNode]
          : []),
      ],
    },
  ];
}
