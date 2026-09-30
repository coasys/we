/**
 * Packing a set of fixed-aspect boxes into a rectangle, as large as they will go.
 *
 * The question a video call asks and a photo wall asks: given N things that are all 16:9, and a box
 * somebody has dragged to some shape, how many columns makes them biggest? A wide box wants them
 * side by side, a tall one wants them stacked, and the crossover depends on N.
 *
 * ## Why this is not CSS
 *
 * `repeat(auto-fill, minmax(…))` answers a different question — "how many fit across" — using width
 * alone, so it gives four columns of postage stamps in a tall box. The answer here needs both axes,
 * and picking the best of several candidates is an argmax, which CSS has no way to express:
 * `repeat()` takes an integer and `calc()` cannot choose between alternatives. Every serious
 * implementation of this measures and solves; so does this one.
 *
 * ## Why it is a pure function and not a component
 *
 * Two callers need the same answer and only one of them is laying anything out. `Grid` uses it to
 * set its tracks; the call module uses it to tell the host what shape its panel wants at
 * fit-to-content. If the arrangement lived only inside the component, the second caller could only
 * guess at it.
 */

export interface TilingBox {
  /** Content-box width available to the tiles, in px. */
  width: number;
  /** Content-box height available to the tiles, in px. */
  height: number;
}

export interface TilingOptions {
  /** Width ÷ height of one tile. 16/9 for video. */
  aspect: number;
  /** Gap between tiles, in px, on both axes. */
  gap?: number;
  /**
   * The arrangement currently on screen, if any.
   *
   * Given one, an alternative has to be **meaningfully** better to displace it — see
   * {@link HYSTERESIS}. Without that, dragging a panel across a threshold flickers between two
   * arrangements, because the two are by definition almost equally good exactly there.
   */
  current?: Tiling;
}

export interface Tiling {
  columns: number;
  rows: number;
}

/**
 * How much better a challenger must be to displace the current arrangement: 4%.
 *
 * Small enough that a deliberate resize switches promptly, large enough that the jitter of a drag
 * does not. The cost of the wrong choice inside that band is a few percent of tile size; the cost of
 * flapping is a layout that visibly shakes while being resized.
 */
const HYSTERESIS = 1.04;

/** How large one tile comes out at a given column count — the thing being maximised. */
function tileWidth(count: number, columns: number, box: TilingBox, aspect: number, gap: number): number {
  const rows = Math.ceil(count / columns);
  const cellWidth = (box.width - (columns - 1) * gap) / columns;
  const cellHeight = (box.height - (rows - 1) * gap) / rows;
  // The tile is whichever dimension runs out first: a wide cell is limited by its height, a tall
  // one by its width. This is exactly the letterboxing a fixed column count produces, made
  // measurable so it can be minimised.
  return Math.min(cellWidth, cellHeight * aspect);
}

/**
 * The arrangement that makes the tiles largest.
 *
 * Ties go to fewer rows, which reads as more "across" than "down" and matches what people expect of
 * a video call at small counts.
 */
export function solveTiling(count: number, box: TilingBox, options: TilingOptions): Tiling {
  const { aspect, gap = 0, current } = options;
  if (count <= 1) return { columns: 1, rows: Math.max(1, count) };
  // Nothing measured yet, or a box with no room: answer something usable rather than dividing by
  // zero. One row is what a stage shows before its first resize lands.
  if (!(box.width > 0) || !(box.height > 0)) return current ?? { columns: count, rows: 1 };

  let best = { columns: 1, rows: count, size: -1 };
  for (let columns = 1; columns <= count; columns++) {
    const size = tileWidth(count, columns, box, aspect, gap);
    const rows = Math.ceil(count / columns);
    if (size > best.size || (size === best.size && rows < best.rows)) best = { columns, rows, size };
  }

  if (current && current.columns >= 1 && current.columns <= count) {
    const currentSize = tileWidth(count, current.columns, box, aspect, gap);
    if (best.size < currentSize * HYSTERESIS) {
      return { columns: current.columns, rows: Math.ceil(count / current.columns) };
    }
  }

  return { columns: best.columns, rows: best.rows };
}

/** Parse a CSS aspect-ratio value — `'16 / 9'`, `'16/9'`, `'1.777'` — into a number. */
export function parseAspect(value: string | number | undefined, fallback = 16 / 9): number {
  if (typeof value === 'number') return value > 0 ? value : fallback;
  if (!value) return fallback;
  const [w, h] = String(value).split('/');
  const width = parseFloat(w);
  const height = h === undefined ? 1 : parseFloat(h);
  if (!(width > 0) || !(height > 0)) return fallback;
  return width / height;
}
