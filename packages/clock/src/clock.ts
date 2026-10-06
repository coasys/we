/**
 * A clock: the moment something is showing, and the playback that moves it.
 *
 * ## What it is for
 *
 * A globe playing a month of events, a transcript scrolled to where a recording is, a facilitator's
 * ten minutes counting down for everybody in a call. Each is a *moment* that something draws, and
 * a way of moving it — played, dragged to, or followed from somewhere else. Two things following the
 * same clock show the same moment by construction, which is the whole reason it is an object rather
 * than a number each of them keeps.
 *
 * ## Exact every frame, read as often as needed
 *
 * While it plays, a clock moves every animation frame and tells its listeners each time, with the
 * cause `'tick'`. Something drawing — a layer, a scrubber's thumb — can follow that cheaply. Anything
 * that does real work per change (a template re-rendering, a store publishing) should not, and
 * {@link throttle} is the way to listen at a slower rate while still hearing every play, pause and
 * seek at once. The `'change'` cause is those: anything that is not time simply passing.
 *
 * ## The moment can be unset
 *
 * `at` is `null` until somebody sets it — seeks, or presses play. Null means "no particular moment",
 * and what follows a clock draws everything then. So a globe given a clock looks exactly as it did
 * without one until somebody touches the controls, which is what a page that merely *can* play should
 * look like before it does.
 *
 * ## Its range comes from what follows it
 *
 * `from` and `to` can be set outright. Usually they are not, because nobody writing a template knows
 * them: a template cannot find the earliest of a list of dates. So each follower *contributes* the
 * span its own data covers ({@link Clock.contribute}), and the range is the union of those, until a
 * range is set explicitly.
 *
 * ## Driven from outside
 *
 * Time does not always come from the clock's own frames. A video's position, a peer's moment relayed
 * by presence: {@link Clock.drive} hands the clock a reading it takes every frame instead of
 * advancing itself.
 */
import { parseDuration } from './time';

export interface ClockState {
  /** The moment shown, in milliseconds since 1970. `null` until somebody sets it: show everything. */
  at: number | null;
  /** The start of the range: as set, else the earliest any follower contributed. */
  from: number | null;
  /** The end of the range, the same way. */
  to: number | null;
  playing: boolean;
  /** A multiplier on how fast it plays. 1 by default; 2 plays twice as fast. */
  speed: number;
  /** Seconds to play the whole range at speed 1. Ignored when `rate` is set. */
  duration: number;
  /**
   * Milliseconds of the clock's time per millisecond of real time, for a clock that runs at a fixed
   * pace whatever its range — 1 is real time, which a countdown wants. Null plays the range in
   * `duration` seconds instead.
   */
  rate: number | null;
  /** Whether it starts again from `from` on reaching `to`, rather than stopping there. */
  loop: boolean;
  /** Whether something outside the clock is setting its moment. See {@link Clock.drive}. */
  driven: boolean;
}

/** Why listeners are hearing from the clock: time passed (`tick`), or anything else (`change`). */
export type ClockCause = 'tick' | 'change';

export type ClockListener = (state: ClockState, cause: ClockCause) => void;

/** What a clock may be told about itself all at once. A span may be written as text: `"7d"`. */
export interface ClockSettings {
  from?: number | null;
  to?: number | null;
  speed?: number;
  /** Seconds, or a span (`"30s"`, `"2m"`) to play the whole range in. */
  duration?: number | string;
  rate?: number | null;
  loop?: boolean;
}

/** How a clock gets its frames and the real time between them. Injected, so a test can step it. */
export interface ClockScheduler {
  now(): number;
  /** Run `callback` before the next frame; returns a cancel. */
  frame(callback: () => void): () => void;
}

export const browserScheduler: ClockScheduler = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  frame(callback) {
    if (typeof requestAnimationFrame === 'function') {
      const handle = requestAnimationFrame(() => callback());
      return () => cancelAnimationFrame(handle);
    }
    const handle = setTimeout(callback, 16);
    return () => clearTimeout(handle);
  },
};

const DEFAULT_DURATION = 30;
const MIN_SPEED = 1 / 64;
const MAX_SPEED = 64;

export class Clock {
  private at: number | null = null;
  private explicitFrom: number | null = null;
  private explicitTo: number | null = null;
  private readonly extents = new Map<string, readonly [number, number]>();
  private playing = false;
  private speed = 1;
  private duration = DEFAULT_DURATION;
  private rate: number | null = null;
  private loop = false;
  private driver: (() => number | null) | null = null;
  private readonly listeners = new Set<ClockListener>();
  private cancelFrame: (() => void) | null = null;
  private lastFrame = 0;
  private snapshot: ClockState | null = null;

  constructor(
    settings: ClockSettings = {},
    private readonly scheduler: ClockScheduler = browserScheduler,
  ) {
    this.apply(settings);
  }

  /** The clock as it is now. The same object until something changes, so it can be compared. */
  get(): ClockState {
    if (this.snapshot) return this.snapshot;
    const [from, to] = this.range();
    this.snapshot = {
      at: this.at,
      from,
      to,
      playing: this.playing,
      speed: this.speed,
      duration: this.duration,
      rate: this.rate,
      loop: this.loop,
      driven: this.driver !== null,
    };
    return this.snapshot;
  }

  /**
   * Hear every change: each frame while it plays (`tick`), and everything else as it happens
   * (`change`). Returns the unsubscribe.
   */
  subscribe(listener: ClockListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  play(): void {
    if (this.playing) return;
    const [from, to] = this.range();
    // Nothing to play through: no range to cross, and no pace of its own to count at.
    if (this.rate === null && (from === null || to === null || to <= from)) return;
    // From the start when there is no moment yet, or the last play ran to the end.
    if (from !== null && (this.at === null || (to !== null && this.at >= to))) this.at = from;
    if (this.at === null) this.at = Date.now();
    this.playing = true;
    this.changed('change');
    this.schedule();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.changed('change');
    this.reschedule();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Show this moment. Kept inside the range when there is one. `null` returns to showing everything. */
  seek(at: number | null): void {
    const next = at === null ? null : this.clamp(at);
    if (next === this.at) return;
    this.at = next;
    this.changed('change');
  }

  /** Show the moment this far through the range, 0 its start and 1 its end. */
  seekFraction(fraction: number): void {
    const [from, to] = this.range();
    if (from === null || to === null || !Number.isFinite(fraction)) return;
    this.seek(from + (to - from) * Math.min(1, Math.max(0, fraction)));
  }

  /** How far through its range the moment is, 0 to 1; 1 when it is unset, which shows everything. */
  progress(): number {
    const [from, to] = this.range();
    if (this.at === null || from === null || to === null || to <= from) return 1;
    return Math.min(1, Math.max(0, (this.at - from) / (to - from)));
  }

  /** Change any of the settings at once. Only what is named changes. */
  configure(settings: ClockSettings): void {
    if (this.apply(settings)) {
      if (this.at !== null) this.at = this.clamp(this.at);
      this.changed('change');
    }
  }

  /**
   * Say which span this follower's data covers, so the range can include it; `null` withdraws it.
   * Keyed so each follower can replace or withdraw its own, and the range is always the union of
   * what is contributed now.
   */
  contribute(key: string, extent: readonly [number, number] | null): void {
    const previous = this.extents.get(key);
    if (extent === null) {
      if (!previous) return;
      this.extents.delete(key);
    } else {
      const [a, b] = extent;
      if (!Number.isFinite(a) || !Number.isFinite(b)) return;
      const next = [Math.min(a, b), Math.max(a, b)] as const;
      if (previous && previous[0] === next[0] && previous[1] === next[1]) return;
      this.extents.set(key, next);
    }
    if (this.at !== null) this.at = this.clamp(this.at);
    this.changed('change');
  }

  /**
   * Take the moment from `read` every frame rather than advancing it — a video's position, a peer's
   * moment. `null` hands it back. While driven, `play` and `pause` still say whether it is playing,
   * for whatever shows a button, but the moment is the driver's.
   */
  drive(read: (() => number | null) | null): void {
    if (read === this.driver) return;
    this.driver = read;
    this.changed('change');
    this.reschedule();
  }

  /** Stop listening to frames and forget every listener. */
  dispose(): void {
    this.cancelFrame?.();
    this.cancelFrame = null;
    this.listeners.clear();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private range(): [number | null, number | null] {
    let low: number | null = null;
    let high: number | null = null;
    for (const [a, b] of this.extents.values()) {
      low = low === null ? a : Math.min(low, a);
      high = high === null ? b : Math.max(high, b);
    }
    return [this.explicitFrom ?? low, this.explicitTo ?? high];
  }

  private clamp(at: number): number {
    const [from, to] = this.range();
    let next = at;
    if (from !== null) next = Math.max(from, next);
    if (to !== null) next = Math.min(to, next);
    return next;
  }

  private apply(settings: ClockSettings): boolean {
    const before = [this.explicitFrom, this.explicitTo, this.speed, this.duration, this.rate, this.loop];
    if ('from' in settings) this.explicitFrom = finiteOrNull(settings.from);
    if ('to' in settings) this.explicitTo = finiteOrNull(settings.to);
    if (settings.speed !== undefined && Number.isFinite(settings.speed) && settings.speed > 0) {
      this.speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, settings.speed));
    }
    if (settings.duration !== undefined) {
      const seconds =
        typeof settings.duration === 'number' ? settings.duration : (parseDuration(settings.duration) ?? 0) / 1000;
      if (Number.isFinite(seconds) && seconds > 0) this.duration = seconds;
    }
    if ('rate' in settings) {
      const rate = finiteOrNull(settings.rate);
      this.rate = rate !== null && rate > 0 ? rate : null;
    }
    if (settings.loop !== undefined) this.loop = settings.loop === true;
    const after = [this.explicitFrom, this.explicitTo, this.speed, this.duration, this.rate, this.loop];
    return after.some((value, index) => value !== before[index]);
  }

  private changed(cause: ClockCause): void {
    this.snapshot = null;
    const state = this.get();
    for (const listener of [...this.listeners]) {
      try {
        listener(state, cause);
      } catch (error) {
        console.error('[clock] A listener failed:', error);
      }
    }
  }

  /** Whether frames are wanted: while it plays, or while something drives it. */
  private wantsFrames(): boolean {
    return this.playing || this.driver !== null;
  }

  private reschedule(): void {
    if (this.wantsFrames()) this.schedule();
    else {
      this.cancelFrame?.();
      this.cancelFrame = null;
    }
  }

  private schedule(): void {
    if (this.cancelFrame) return;
    this.lastFrame = this.scheduler.now();
    this.cancelFrame = this.scheduler.frame(() => this.step());
  }

  private step(): void {
    this.cancelFrame = null;
    const now = this.scheduler.now();
    const elapsed = Math.max(0, now - this.lastFrame);
    this.lastFrame = now;
    if (this.driver) {
      const read = this.driver();
      const next = read === null ? null : this.clamp(read);
      if (next !== this.at) {
        this.at = next;
        this.changed('tick');
      }
    } else if (this.playing) {
      this.advance(elapsed);
    }
    if (this.wantsFrames()) this.cancelFrame = this.scheduler.frame(() => this.step());
  }

  private advance(elapsed: number): void {
    const [from, to] = this.range();
    const pace = this.rate ?? (from !== null && to !== null && to > from ? (to - from) / (this.duration * 1000) : 0);
    if (!pace) {
      this.playing = false;
      this.changed('change');
      return;
    }
    let next = (this.at ?? from ?? Date.now()) + elapsed * pace * this.speed;
    if (to !== null && next >= to) {
      if (this.loop && from !== null) next = from + ((next - from) % Math.max(1, to - from));
      else {
        this.at = to;
        this.playing = false;
        this.changed('change');
        return;
      }
    }
    this.at = next;
    this.changed('tick');
  }
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Listen to a clock at most once every `interval` milliseconds while it plays, and at once to
 * everything else — a play, a pause, a seek, a new range. For anything that does real work per
 * change: a store publishing to templates, a layer regrouping its rows.
 *
 * A tick that arrives too soon is not dropped but held, and delivered when the interval is up if no
 * other has been by then. Without that, a clock driven from outside that stops moving would leave the
 * listener a few frames behind for good: nothing after the last tick would ever come to carry it.
 */
export function throttle(
  clock: Pick<Clock, 'subscribe' | 'get'>,
  interval: number,
  listener: (state: ClockState) => void,
  scheduler: Pick<ClockScheduler, 'now'> = browserScheduler,
): () => void {
  let last = -Infinity;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  const deliver = (state: ClockState) => {
    if (trailing !== null) clearTimeout(trailing);
    trailing = null;
    last = scheduler.now();
    listener(state);
  };
  const unsubscribe = clock.subscribe((state, cause) => {
    const wait = interval - (scheduler.now() - last);
    if (cause === 'change' || wait <= 0) return deliver(state);
    if (trailing === null) trailing = setTimeout(() => deliver(clock.get()), wait);
  });
  return () => {
    unsubscribe();
    if (trailing !== null) clearTimeout(trailing);
  };
}
