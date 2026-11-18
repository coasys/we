/**
 * The latest of several overlapping async calls, so an earlier one that finishes late can tell it
 * was overtaken and discard its answer instead of publishing it.
 *
 * Each call asks for a check when it starts and asks it after every await. Starting another call,
 * or cancelling, makes every earlier check answer `false`.
 */
export interface Latest {
  /** Start a call. Every earlier call stops being current; the returned check says whether this one still is. */
  begin(): () => boolean;
  /** A check for the call already running, without starting a new one. */
  current(): () => boolean;
  /** Make every call so far stale — on a stop, or when what they were reading for has gone away. */
  cancel(): void;
}

export function latest(): Latest {
  let turn = 0;
  const check = (mine: number) => () => mine === turn;
  return {
    begin: () => check(++turn),
    current: () => check(turn),
    cancel: () => {
      turn += 1;
    },
  };
}
