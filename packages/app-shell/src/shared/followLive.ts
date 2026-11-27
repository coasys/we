/**
 * Following a live query from a store: the one way a store turns a backend's `LiveQuery` handle into
 * what it holds.
 *
 * Every follow a store wrote by hand had the same five parts: dispose the handle when the owner goes,
 * ignore anything that arrives for an input the store has moved on from, apply each page, warn when
 * the handle cannot open, and — for a list where an empty answer is not "none" (a policy, settings)
 * — read the stored rows once instead, saying the rows are loaded only once that read is in. Each
 * store had its own copy of the guard flag and its own idea of when "loaded" was true. They live
 * here, once, against the reactivity port, so a store on any host follows a query the same way.
 *
 * {@link followLive} is called inside the effect or root that owns the follow, and applies pages
 * through the caller's own function: every store that follows a query also does something of its
 * own with what arrives (maps it, keys it, reads again when a page names something missing), so the
 * rows are the store's to hold, not this module's.
 */
import type { LivePage, LiveQuery } from '@we/backend-shared';
import type { ReactivityPort } from '@we/reactivity';

/** A handle on pages of `T`. */
export type FollowedQuery<T> = LiveQuery<LivePage<T>>;

/**
 * Where the handle comes from: the handle itself, or a function that opens one, perhaps after
 * something else has to happen first (a shape installed, a record looked up).
 *
 * The function is handed `current`, which turns false once the follow has been superseded, so it can
 * skip opening a handle nobody would follow. Answering `undefined` follows nothing and settles
 * nothing. Throwing, or rejecting, counts as a failure to open with nothing stored to fall back on:
 * the step before the handle is what failed, not the handle.
 */
export type FollowSource<T> = FollowedQuery<T> | ((current: () => boolean) => FollowOpened<T>);

/** What opening a handle answers with. */
export type FollowOpened<T> = FollowedQuery<T> | undefined | Promise<FollowedQuery<T> | undefined>;

export interface FollowLiveOptions<T, V> {
  /** Who is following, for the warnings: `SpaceStore`. */
  store: string;
  /** What is being followed, for the warnings: `the space’s policy`. */
  what: string;
  /**
   * What a page is turned into before it is applied. May be async: pages are then applied newest
   * last, and a page superseded by a newer one while it was being turned is dropped. A map that
   * throws, or rejects, leaves that page out with a warning. Without one the rows are applied as
   * they are.
   */
  map?: (rows: T[]) => V | Promise<V>;
  /**
   * Take one page. `initial` is true for the page the handle opened on, and for stored rows read
   * when it could not open. Never called once the follow has been superseded. An apply that throws
   * is warned about, and that page counts as not taken.
   */
  apply: (value: V, initial: boolean) => void;
  /**
   * Read the stored rows once when no page was taken: the handle failed to open, or the newest page
   * when it opened could not be mapped or applied. `apply` defaults to the follow's own `apply`, called
   * with `initial` true.
   */
  stored?: { read: () => Promise<V>; apply?: (value: V) => void };
  /**
   * Told once whether the rows are in: true when the handle opened and its newest page was taken, or
   * the stored rows were; false when neither. `error` is why the handle did not open, when it did not
   * (set alongside true when stored rows stood in). Never called once the follow has been superseded.
   */
  settled?: (loaded: boolean, error?: Error) => void;
}

const asError = (reason: unknown): Error => (reason instanceof Error ? reason : new Error(String(reason)));

const isPromiseLike = <V>(value: unknown): value is PromiseLike<V> =>
  typeof (value as { then?: unknown } | null)?.then === 'function';

/**
 * Follow a live query for as long as the current owner lives.
 *
 * Call it inside the effect (or root) that owns the follow, synchronously: its disposal is
 * registered with that owner through `onCleanup`. When the effect re-runs for a new input, the old
 * follow is superseded there — its handle disposed, and nothing it was still waiting on (an open, a
 * map, a stored read) applies or settles anything after that. That is the stale-result guard every
 * store used to keep as a `stopped` flag.
 */
export function followLive<T, V = T[]>(
  reactivity: Pick<ReactivityPort, 'onCleanup'>,
  source: FollowSource<T>,
  options: FollowLiveOptions<T, V>,
): void {
  const { store, what, apply, stored, settled } = options;
  const map = options.map ?? ((rows: T[]) => rows as unknown as V);
  let current = true;
  let watch: FollowedQuery<T> | undefined;
  reactivity.onCleanup(() => {
    current = false;
    watch?.dispose();
  });
  const isCurrent = () => current;
  const settle = (loaded: boolean, error?: Error) => {
    if (current) settled?.(loaded, error);
  };
  const couldNotRead = (error: unknown) => {
    if (current) console.warn(`${store}: could not read ${what}`, error);
    return false;
  };

  /*
    Whether the newest page is in. A page that lands while an earlier one is still being mapped
    replaces it, so "loaded" waits for the newest rather than for whichever was asked first.
  */
  let pushed = 0;
  let taken: Promise<boolean> = Promise.resolve(false);
  const take = (rows: T[], initial: boolean) => {
    const turn = ++pushed;
    const land = (value: V): boolean => {
      if (!current || turn !== pushed) return false;
      apply(value, initial);
      return true;
    };
    try {
      const value = map(rows);
      if (isPromiseLike<V>(value)) {
        taken = Promise.resolve(value).then(land).catch(couldNotRead);
      } else {
        taken = Promise.resolve(land(value));
      }
    } catch (error) {
      taken = Promise.resolve(couldNotRead(error));
    }
  };

  const follow = async (live: FollowedQuery<T>) => {
    watch = live;
    live.subscribe((snapshot) => {
      if (current && snapshot.status === 'ready' && snapshot.data) take(snapshot.data.results, snapshot.initial);
    });
    let held = false;
    let openError: Error | undefined;
    try {
      await live.first;
      let seen: Promise<boolean> | undefined;
      while (seen !== taken) held = await (seen = taken);
    } catch (error) {
      // Disposing the handle on supersession rejects `first` too; that is not a failure.
      if (!current) return;
      openError = asError(error);
      console.warn(`${store}: could not watch ${what}`, error);
    }
    if (!current) return;
    if (held) return settle(true);
    if (!stored) return settle(false, openError);
    // No page reached the store, and an empty store is not "none" here: read what is stored, once.
    try {
      const value = await stored.read();
      if (!current) return;
      if (stored.apply) stored.apply(value);
      else apply(value, true);
      settle(true, openError);
    } catch (error) {
      couldNotRead(error);
      settle(false, openError ?? asError(error));
    }
  };

  const failedToOpen = (error: unknown) => {
    if (!current) return;
    console.warn(`${store}: could not watch ${what}`, error);
    settle(false, asError(error));
  };

  if (typeof source !== 'function') return void follow(source);
  let opened: FollowOpened<T>;
  try {
    opened = source(isCurrent);
  } catch (error) {
    return failedToOpen(error);
  }
  if (!isPromiseLike<FollowedQuery<T> | undefined>(opened)) {
    if (opened) void follow(opened);
    return;
  }
  Promise.resolve(opened).then((live) => {
    if (!live) return;
    if (!current) return live.dispose();
    void follow(live);
  }, failedToOpen);
}
