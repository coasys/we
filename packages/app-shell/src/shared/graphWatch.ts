/**
 * Following one graph read: what `GraphHost.watch` does with the subscription it opens.
 *
 * Its own file so the timing is testable without mounting a graph — the subscription is a plain
 * object here, and the callbacks are the only way out.
 */

import type { LivePage as Page, LiveQuery } from '@we/backend-shared';

/** The part of a live query this needs. */
export type LiveRead<T> = Pick<LiveQuery<Page<T>>, 'first' | 'subscribe' | 'dispose'>;

export interface FollowOptions {
  /**
   * The ids the graph's last read of this same question returned, or `undefined` when there was
   * none to compare with.
   */
  seen: () => readonly string[] | undefined;
  /** Something changed that the graph has not read. */
  onChange: () => void;
  /** The backend would not subscribe. */
  onError: (error: unknown) => void;
}

/** The key a read and the watch on it share: the same entity, dataset and options. */
export function readKey(entity: string | string[], dataset: string | undefined, options: unknown): string {
  return JSON.stringify([entity, dataset ?? '', options]);
}

/** The ids of a page of rows. */
export function idsOf(rows: readonly unknown[]): string[] {
  return rows.map((row) => {
    const id = (row as { id?: unknown } | null)?.id;
    return typeof id === 'string' || typeof id === 'number' ? String(id) : '';
  });
}

/** Whether two id lists hold different records. Order is ignored: a union read may come back reordered. */
function differ(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return true;
  const sorted = [...b].sort();
  return [...a].sort().some((id, i) => id !== sorted[i]);
}

/** Follow a read; returns the function that stops following it. */
export function followRead<T>(subscription: LiveRead<T>, { seen, onChange, onError }: FollowOptions): () => void {
  let live = true;
  /*
    The first result is the current state, not a change — unless it is not the state the graph read.

    The graph reads its seeds with `findAll` and opens this after, so a write landing between the two
    is in the first result and in no later snapshot: the query has no earlier state to differ from.
    That first result is compared with what the read returned for the same question, and a difference
    is a change. One that matches is not, so opening a graph does not re-run every seed for a state it
    already has. With no read to compare with, nothing is reported.

    Every snapshot after the first is a change. A live query is only called once it has a result, so
    a write landing while it opens is already in that result.
  */
  subscription.subscribe((snapshot) => {
    if (!live || snapshot.status !== 'ready' || !snapshot.data) return;
    if (!snapshot.initial) return onChange();
    const read = seen();
    if (read !== undefined && differ(read, idsOf(snapshot.data.results))) onChange();
  });
  subscription.first.catch((error: unknown) => {
    if (live) onError(error);
  });

  return () => {
    live = false;
    subscription.dispose();
  };
}
