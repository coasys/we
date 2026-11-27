/**
 * ClockStore — the app's clocks, as a template reads and drives them.
 *
 * A clock is a moment being shown and the playback that moves it (`@we/clock`). Things that show a
 * moment follow one by name — a globe given `clock: "events"` — and a template puts the controls
 * beside them: a play button, a scrubber, the date. All of them are the one registry in
 * `shared/clocks.ts`, which is also what a module reaches through the `clocks` kernel, so a name is
 * the same clock everywhere.
 *
 * ## Published a few times a second, not every frame
 *
 * A playing clock moves every frame, and what follows it directly (a globe's layers) moves with it.
 * A template does not: an expression re-evaluating sixty times a second would re-render whatever reads
 * it, for a label nobody can read that fast. So each clock is published here at most five times a
 * second while it plays, and at once on everything else — play, pause, a seek, a new range — so a
 * button never lags a press.
 *
 * ## Presentation lives here
 *
 * `atIso`, `fromIso`, `toIso`, `atLabel` and `ticks` exist because a schema has no dates: a
 * `we-timestamp` takes an ISO string, and nothing in a schema could choose between hours and years. `progress` is the moment as a fraction of the range, which is what a slider moves along.
 */
import {
  type Clock,
  type ClockSettings,
  type ClockState,
  type ClockTick,
  clockTicks,
  momentLabel,
  throttle,
  toIso,
  toTime,
} from '@we/clock';
import type { Accessor, ReactivityPort } from '@we/reactivity';

import { clockRegistry } from '../clocks';

/** One clock, ready to render. */
export interface ClockView {
  /** The moment shown, in milliseconds since 1970, or `null` when none is set: everything shows. */
  at: number | null;
  /** The same moment for a `we-timestamp`; empty when none is set. */
  atIso: string;
  /**
   * The moment written as precisely as the range calls for — with the time of day across a day or
   * two, the month alone across decades. Empty when none is set.
   */
  atLabel: string;
  /**
   * Marks along the range, `{ at, fraction, label }`, on round moments at the scale it calls for:
   * hours, days, months or years. Place each at `fraction` of a scrubber's width.
   */
  ticks: ClockTick[];
  from: number | null;
  fromIso: string;
  to: number | null;
  toIso: string;
  /** How far through its range, 0 to 1. 1 when no moment is set, which shows everything. */
  progress: number;
  playing: boolean;
  speed: number;
  loop: boolean;
  /** Whether play would do anything: it has a range to cross or a pace of its own. */
  canPlay: boolean;
}

export interface ClockStore {
  /** Every clock that exists, by name. A name nothing has used yet reads as undefined. */
  clocks: Accessor<Record<string, ClockView>>;
  play: (id: string) => void;
  pause: (id: string) => void;
  toggle: (id: string) => void;
  /** Show a moment: milliseconds, or an ISO date. `null` (or empty) goes back to showing everything. */
  seek: (id: string, at: number | string | null) => void;
  /** Show the moment this far through the range, 0 its start and 1 its end. */
  seekProgress: (id: string, progress: number) => void;
  setSpeed: (id: string, speed: number) => void;
  setLoop: (id: string, loop: boolean) => void;
  /** Change several settings at once: from, to, speed, duration ("30s"), rate, loop. */
  configure: (id: string, settings: ClockSettings) => void;
}

/** How often a playing clock is published to templates. */
const PUBLISH_INTERVAL = 200;

/** The marks for a range, kept until the range changes: they are worked out with the locale's dates. */
const tickCache = new WeakMap<Clock, { key: string; ticks: ClockTick[] }>();

function ticksOf(clock: Clock, state: ClockState): ClockTick[] {
  const key = `${state.from}:${state.to}`;
  const cached = tickCache.get(clock);
  if (cached?.key === key) return cached.ticks;
  const ticks = state.from !== null && state.to !== null ? clockTicks(state.from, state.to) : [];
  tickCache.set(clock, { key, ticks });
  return ticks;
}

function view(clock: Clock, state: ClockState): ClockView {
  return {
    at: state.at,
    atIso: toIso(state.at),
    atLabel: momentLabel(state.at, state.from, state.to),
    ticks: ticksOf(clock, state),
    from: state.from,
    fromIso: toIso(state.from),
    to: state.to,
    toIso: toIso(state.to),
    progress: clock.progress(),
    playing: state.playing,
    speed: state.speed,
    loop: state.loop,
    canPlay: state.rate !== null || (state.from !== null && state.to !== null && state.to > state.from),
  };
}

/**
 * The app's clock store, built where the host composes its stores. Its subscriptions to the clocks
 * go when the owner it is built under is disposed.
 */
export function createClockStore({ reactivity }: { reactivity: ReactivityPort }): ClockStore {
  const { signal, untrack, onCleanup } = reactivity;
  const [clocks, setClocks] = signal<Record<string, ClockView>>({});
  // The port's setter takes a value, so one clock's view is written over what the others hold now.
  const show = (id: string, clock: Clock, state: ClockState) =>
    setClocks({ ...untrack(clocks), [id]: view(clock, state) });

  const publish = (id: string, clock: Clock) => {
    const unsubscribe = throttle(clock, PUBLISH_INTERVAL, (state) => show(id, clock, state));
    show(id, clock, clock.get());
    return unsubscribe;
  };

  const unsubscribes = clockRegistry.ids().map((id) => publish(id, clockRegistry.get(id)));
  unsubscribes.push(clockRegistry.onCreate((id, clock) => unsubscribes.push(publish(id, clock))));
  onCleanup(() => unsubscribes.forEach((unsubscribe) => unsubscribe()));

  const clock = (id: string) => clockRegistry.get(String(id));

  const store: ClockStore = {
    clocks,
    play: (id) => clock(id).play(),
    pause: (id) => clock(id).pause(),
    toggle: (id) => clock(id).toggle(),
    seek: (id, at) => {
      if (at === null || at === '') return clock(id).seek(null);
      const time = toTime(at);
      if (time !== undefined) clock(id).seek(time);
    },
    seekProgress: (id, progress) => {
      const value = Number(progress);
      if (!Number.isFinite(value)) return;
      clock(id).seekFraction(value);
    },
    setSpeed: (id, speed) => clock(id).configure({ speed: Number(speed) }),
    setLoop: (id, loop) => clock(id).configure({ loop: loop === true }),
    configure: (id, settings) => clock(id).configure(settings ?? {}),
  };

  return store;
}
