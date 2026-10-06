/**
 * `@we/clock`: a moment being looked at, and the playback that moves it.
 *
 * Framework-neutral and dependency-free. The host keeps clocks by name in a {@link ClockRegistry}; a
 * template reads and drives them through a store, a module through the `clocks` kernel, and a
 * component — a globe — is handed one and follows it directly, every frame, without anything above it
 * re-rendering.
 */
export {
  browserScheduler,
  Clock,
  type ClockCause,
  type ClockListener,
  type ClockScheduler,
  type ClockSettings,
  type ClockState,
  throttle,
} from './clock';
export { ClockRegistry } from './registry';
export { DAY, parseDuration, toIso, toTime, utcDay } from './time';
