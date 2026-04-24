import type { SignalTypeData } from '@we/components/solid';

/**
 * A SignalType configured for display in the bar.
 *
 * `id` is the perspective URI of the stored SignalType entity.
 * When absent the bar renders in **preview mode**: controls are fully
 * interactive but no Signal instances are persisted to the graph.
 * This allows AI-authored schemas to prototype the feel of a signal
 * system before the backing SignalType records have been created.
 */
export interface SignalBarTypeConfig extends SignalTypeData {
  id?: string;
  name?: string;
}

/** Pre-computed per-type signal state, derived externally from raw Signal instances */
export interface SignalTypeState {
  myValue: number | null;
  aggregate: number;
}

/**
 * @ai A row of signal controls (like, vote, rating, etc.) for a content node.
 *
 * Pass `signalTypes` to configure which signals to show. Each entry maps to
 * one `SignalControl`. If a type has an `id` and `state` is provided, live
 * signal counts + the current user's value are displayed.
 *
 * When `state` is absent (or the type has no `id`), the bar renders in
 * preview mode: controls are visible and interactive but nothing persists.
 * This is the expected state while prototyping with the AI.
 *
 * The outer container (e.g. componentRegistry wrapper) is responsible for
 * fetching Signal instances and passing computed `state`; SignalBar itself
 * is purely presentational.
 *
 * @example
 * // Schema template — add a like button to posts:
 * { type: 'SignalBar', props: { nodeId: '$post.baseExpression', signalTypes: [{ icon: '❤️', display: 'icon', rangeMin: 0, rangeMax: 1, name: 'Like' }] } }
 *
 * @example
 * // Schema template — like + 5-star quality rating:
 * { type: 'SignalBar', props: { nodeId: '$post.baseExpression', signalTypes: [
 *   { icon: '❤️', display: 'icon', rangeMin: 0, rangeMax: 1, name: 'Like' },
 *   { icon: '⭐', display: 'horizontal-icons', rangeMin: 0, rangeMax: 5, name: 'Quality' }
 * ]}}
 */
export interface SignalBarProps {
  /** Base expression URI of the WeNode being signalled */
  nodeId?: string;
  /** Which signal types to display, in order */
  signalTypes: SignalBarTypeConfig[];
  /**
   * Pre-computed per-type state, index-aligned with `signalTypes`.
   * A null entry means the data for that type is still loading (shows skeleton aggregate).
   * When the prop itself is absent, all types render in preview mode.
   */
  state?: (SignalTypeState | null)[];
  /** Called when the user submits a signal. No-op in preview mode (type has no id). */
  onSignal?: (type: SignalBarTypeConfig, value: number) => void;
  class?: string;
  styles?: Record<string, string | number>;
}
