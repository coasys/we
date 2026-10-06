/**
 * Rows over time: which of a layer's rows show at the moment its clock is at, and how strongly.
 *
 * ## What a template says
 *
 * `time` names the field holding each row's moment (`"createdAt"`, `"startDate"`), and nothing
 * else is needed: rows from before the moment show, rows from after it do not, so playing a month
 * shows things appearing as they happened. `window` keeps only the recent ones (`"7d"`), which reads
 * as "where is it busy now" rather than "how did it grow", and those leaving it fade out over the
 * last quarter of the window rather than vanishing, unless `fade` is false.
 *
 * A layer with no `time`, or a globe following no clock, or a clock nobody has set, draws every row,
 * exactly as it would have before any of this existed.
 *
 * A row whose field holds no readable moment is drawn throughout: it can be placed, and nothing says
 * when it stops being true.
 *
 * ## What a style reads
 *
 * Each row shown carries `data.age`, in days since its moment, so a rule can make the newest stand
 * out: `{ "when": { "data.age": { "lt": 1 } }, "style": { "size": 18 } }`.
 *
 * ## Drawing only when it changes
 *
 * A clock moves every frame and redrawing every frame would be wasted on almost all of them, since
 * what is shown changes only when a row's moment is crossed or a fading row steps down. Rows are
 * sorted once by moment, so what shows is a range of that list, and {@link TimeIndex.signature}
 * names that range — plus the step of any fade under way — in a string. A layer redraws when the
 * string changes, and {@link followTime} is the loop that asks.
 */
import { parseDuration, toTime } from '@we/clock';
import type { LayerClock } from '@we/globe-protocol';

import type { Row } from './rows';
import { readPath } from './rows';

export interface TimeOptions {
  /** The field holding each row's moment: a date, a date-time, or milliseconds. Absent: no time. */
  time?: string;
  /** Only rows this recent show: `"7d"`, `"12h"`, or milliseconds. Absent: everything up to the moment. */
  window?: string | number;
  /** Whether rows leaving the window fade out over its last quarter. Default true. */
  fade?: boolean;
}

/** What a layer draws at one moment. */
export interface TimeSlice {
  rows: Row[];
  /** Days since the row's moment, or undefined for a row with none. Read by a style as `data.age`. */
  age(row: Row): number | undefined;
  /** How strongly the row shows, 0 to 1: 1, except for one fading out of the window. */
  fade(row: Row): number;
}

const DAY = 86_400_000;
/** The share of the window, at its old end, over which rows fade out. */
const FADE_SHARE = 0.25;
/** Fades step in eighths, so a layer redraws a few times as a row fades rather than every frame. */
const FADE_STEPS = 8;

interface Timed {
  row: Row;
  time: number;
}

function lowerBound(timed: readonly Timed[], time: number, inclusive: boolean): number {
  // The first index whose time is greater than (or, inclusive, at least) `time`.
  let low = 0;
  let high = timed.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (inclusive ? timed[middle].time < time : timed[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** A layer's rows sorted by moment, ready to be sliced at any moment cheaply. */
export class TimeIndex {
  private readonly timed: Timed[];
  private readonly untimed: Row[];
  private readonly window: number | undefined;
  private readonly fadeSpan: number;
  private readonly times = new Map<Row, number>();

  constructor(
    readonly rows: readonly Row[],
    readonly options: TimeOptions,
  ) {
    const field = options.time;
    this.timed = [];
    this.untimed = [];
    if (field) {
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const time = toTime(readPath(row, field));
        if (time === undefined) this.untimed.push(row);
        else {
          this.timed.push({ row, time });
          this.times.set(row, time);
        }
      }
      this.timed.sort((a, b) => a.time - b.time);
    }
    this.window = parseDuration(options.window);
    this.fadeSpan = this.window !== undefined && options.fade !== false ? this.window * FADE_SHARE : 0;
  }

  /** Whether this layer follows time at all: it names a field. */
  get timedLayer(): boolean {
    return !!this.options.time;
  }

  /** The span the rows' moments cover, or null when none has one. */
  extent(): [number, number] | null {
    if (!this.timed.length) return null;
    return [this.timed[0].time, this.timed[this.timed.length - 1].time];
  }

  /** The range of sorted rows showing at `at`: those from `start` up to (not including) `end`. */
  private range(at: number): [number, number] {
    const end = lowerBound(this.timed, at, false);
    const start = this.window === undefined ? 0 : lowerBound(this.timed, at - this.window, false);
    return [start, end];
  }

  /**
   * A string that changes exactly when what is drawn at `at` changes. Unset moments, and layers
   * without time, always give the same one.
   */
  signature(at: number | null): string {
    if (!this.timedLayer || at === null) return 'all';
    const [start, end] = this.range(at);
    let step = '';
    if (this.fadeSpan > 0 && this.window !== undefined && start < end) {
      // Rows fade once older than this; the step only moves while one of them is showing.
      const fadingFrom = at - this.window + this.fadeSpan;
      if (this.timed[start].time <= fadingFrom) step = `:${Math.floor(at / (this.fadeSpan / FADE_STEPS))}`;
    }
    return `${start}-${end}${step}`;
  }

  /** What shows at `at`, or null when every row does: no time on this layer, or no moment set. */
  slice(at: number | null): TimeSlice | null {
    if (!this.timedLayer || at === null) return null;
    const [start, end] = this.range(at);
    const rows = [...this.untimed, ...this.timed.slice(start, end).map((entry) => entry.row)];
    const window = this.window;
    const fadeSpan = this.fadeSpan;
    return {
      rows,
      age: (row) => {
        const time = this.times.get(row);
        return time === undefined ? undefined : Math.max(0, at - time) / DAY;
      },
      fade: (row) => {
        const time = this.times.get(row);
        if (time === undefined || window === undefined || fadeSpan <= 0) return 1;
        const left = window - (at - time);
        if (left >= fadeSpan) return 1;
        // Stepped as the signature is, so what is drawn matches what was asked to be redrawn.
        return Math.max(0, Math.ceil((left / fadeSpan) * FADE_STEPS) / FADE_STEPS);
      },
    };
  }
}

/**
 * A layer's loop over time: it keeps the index for the layer's current rows, contributes their span
 * to the clock, and calls `redraw` when what shows changes — at most once a frame, and no more often
 * than `minInterval` milliseconds for a layer whose redraw is expensive (one that regroups rows, or
 * rebuilds a batch of shapes).
 *
 * With no clock, or no moment set, it never calls `redraw`: the layer draws its rows as they are.
 */
export function followTime(
  context: { clock: LayerClock; onCleanup(cleanup: () => void): void },
  redraw: () => void,
  options: { minInterval?: number } = {},
) {
  const minInterval = options.minInterval ?? 0;
  let index: TimeIndex | null = null;
  let drawn = 'all';
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let frame: number | null = null;

  const run = () => {
    frame = null;
    timer = null;
    if (!index) return;
    const next = index.signature(context.clock.at());
    if (next === drawn) return;
    drawn = next;
    last = performance.now();
    redraw();
  };

  const schedule = () => {
    if (frame !== null || timer !== null) return;
    const wait = minInterval - (performance.now() - last);
    if (wait > 0) timer = setTimeout(() => (frame = requestAnimationFrame(run)), wait);
    else frame = requestAnimationFrame(run);
  };

  const unsubscribe = context.clock.subscribe(() => {
    if (!index || index.signature(context.clock.at()) === drawn) return;
    schedule();
  });

  context.onCleanup(() => {
    unsubscribe();
    if (timer !== null) clearTimeout(timer);
    if (frame !== null) cancelAnimationFrame(frame);
    context.clock.extent(null);
  });

  return {
    /**
     * The slice to draw for these rows now. Call it from every redraw, with the layer's current
     * options: the rows are indexed again only when the array or the time options change.
     */
    slice(rows: readonly Row[] | undefined, time: TimeOptions): TimeSlice | null {
      const list = Array.isArray(rows) ? rows : [];
      if (
        !index ||
        index.rows !== list ||
        index.options.time !== time.time ||
        index.options.window !== time.window ||
        index.options.fade !== time.fade
      ) {
        index = new TimeIndex(list, { time: time.time, window: time.window, fade: time.fade });
        context.clock.extent(index.extent());
      }
      const at = context.clock.at();
      drawn = index.signature(at);
      return index.slice(at);
    },
  };
}
