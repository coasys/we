/**
 * Following one graph read: what `GraphHost.watch` does with the subscription it opens.
 *
 * Its own file so the timing is testable without mounting a graph — the subscription is a plain
 * object here, and the callbacks are the only way out.
 */

/** The part of a live query this needs — `subscribe` resolves with the answer as it stands. */
export interface LiveRead<T> {
  subscribe(cb: (rows: T[]) => void): Promise<T[]>;
  dispose(): void;
}

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
    The first answer is the current state, not a change — unless it is not the state the graph read.

    The graph reads its seeds with `findAll` and subscribes after, so a write landing between the
    two is in `subscribe`'s first answer and in no callback: the subscription has no earlier state
    to differ from. That first answer is compared with what the read returned for the same
    question, and a difference is a change. A first answer that matches is not one, so opening a
    graph does not re-run every seed for a state it already has. With no read to compare with,
    nothing is reported — the graph is as it was before this compared anything.

    `pending` covers a callback arriving before the first answer: a write landing then is a real
    change, and dropping it would lose exactly the update that arrived while the graph was opening.
    It and a differing first answer are one change, reported once.
  */
  let primed = false;
  let pending = false;

  subscription
    .subscribe(() => {
      if (!live) return;
      if (!primed) {
        pending = true;
        return;
      }
      onChange();
    })
    .then((initial) => {
      primed = true;
      if (!live) return;
      const read = seen();
      const moved = read !== undefined && Array.isArray(initial) && differ(read, idsOf(initial));
      if (pending || moved) onChange();
    })
    .catch(onError);

  return () => {
    live = false;
    subscription.dispose();
  };
}
