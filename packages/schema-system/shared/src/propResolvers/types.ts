import type { ReactivityPort } from '@we/reactivity';

export type Props = Record<string, unknown>;

/**
 * The memo a resolver is given when there is nothing to track: an event handler, a promise callback,
 * a test. It answers with an accessor like any memo, over the value read once, now.
 *
 * Its identity is how a resolver knows not to tag the result as reactive — see the expression
 * resolver for why that matters.
 */
export const noMemo: ReactivityPort['memo'] = (fn) => {
  const value = fn();
  return () => value;
};
