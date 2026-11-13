export function sleep(ms: number): Promise<void>;

/** Rejects after `ms` with `<what>: no answer in <ms>ms`. */
export function within<T>(promise: Promise<T>, ms: number, what?: string): Promise<T>;

export interface UntilOptions {
  /** How long to wait in all, in ms. Default one minute. */
  timeout?: number;
  /** How long between reads, in ms. Default half a second. */
  interval?: number;
  /** What is waited for, for the timeout's error and the once-a-minute heartbeat line. */
  what?: string;
}

/** Polls `read` until `accept` holds for what it returns, or throws with the last value. */
export function until<T>(read: () => T | Promise<T>, accept: (value: T) => unknown, options?: UntilOptions): Promise<T>;
