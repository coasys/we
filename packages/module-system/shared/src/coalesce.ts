/**
 * One run at a time per key, and at most one more queued behind it.
 *
 * For work that reads or settles something and is safe to repeat, asked for by several callers at
 * once: a call that arrives while a run is going joins the single run queued after it, and that
 * run starts only when the current one has finished. So three callers cost two runs, not three
 * running side by side, and no caller is answered by a run that started before it asked — a run
 * already going may have read the state from before the change the caller is asking about.
 *
 * Calls under one key must ask for the same work: a caller that joins the queued run gets that
 * run's result, not one of its own `work`.
 *
 * Not `oneAtATime` (app-shell), which orders writes and runs every one of them. This drops the
 * repeats, which is right only for work whose second run in a row adds nothing.
 */
export function coalesceByKey(): <T>(key: string, work: () => Promise<T>) => Promise<T> {
  const running = new Map<string, Promise<unknown>>();
  const queued = new Map<string, Promise<unknown>>();

  function start<T>(key: string, work: () => Promise<T>): Promise<T> {
    const run = work();
    running.set(key, run);
    const done = () => {
      if (running.get(key) === run) running.delete(key);
    };
    run.then(done, done);
    return run;
  }

  return function coalesce<T>(key: string, work: () => Promise<T>): Promise<T> {
    const waiting = queued.get(key);
    if (waiting) return waiting as Promise<T>;
    const current = running.get(key);
    if (!current) return start(key, work);

    // After the current run, whether it succeeded or failed: its failure is its own callers'.
    const next = current
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => {
        queued.delete(key);
        return start(key, work);
      });
    queued.set(key, next);
    return next;
  };
}
