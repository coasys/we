/**
 * Waiting for what a test cannot be told about: a record synced, a page that has drawn, a model that
 * has answered.
 */

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Rejects after `ms`: a call whose socket never opened neither resolves nor rejects. */
export function within(promise, ms, what = 'call') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, fail) => {
      timer = setTimeout(() => fail(new Error(`${what}: no answer in ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Polls `read` until `accept` holds for what it returns, or throws with the last value.
 *
 * A wait longer than a minute logs one line a minute: what it waits for, and for how long so far.
 * CI ends a job that writes nothing for a while (CircleCI's no-output timeout), and the real tier's
 * waits on a model can be longer than that taken together. The line has its own timer, so a read that
 * is slow to answer does not hold it back; and each read gets only what is left of the deadline, so a
 * read that never answers cannot extend it.
 */
export async function until(read, accept, { timeout = 60_000, interval = 500, what = 'condition' } = {}) {
  const start = Date.now();
  const deadline = start + timeout;
  const s = (ms) => `${Math.round(ms / 1_000)} s`;
  const heartbeat = setInterval(
    () => console.log(`[until] still waiting for ${what}: ${s(Date.now() - start)} of ${s(timeout)}`),
    60_000,
  );
  const late = Symbol('late');
  let last;
  const timedOut = (pending = '') =>
    new Error(`Timed out waiting for ${what}${pending}. Last: ${JSON.stringify(last, null, 1)?.slice(0, 2_000)}`);
  try {
    for (let first = true; ; first = false) {
      // The first read always happens; a later one only while there is time left for it.
      if (!first && Date.now() >= deadline) throw timedOut();
      let timer;
      let unanswered = false;
      try {
        const value = await Promise.race([
          Promise.resolve().then(read),
          new Promise((done) => (timer = setTimeout(() => done(late), Math.max(0, deadline - Date.now())))),
        ]);
        unanswered = value === late;
        if (!unanswered) {
          last = value;
          if (accept(last)) return last;
        }
      } catch (error) {
        last = `threw: ${error.message}`;
      } finally {
        clearTimeout(timer);
      }
      if (unanswered) throw timedOut(' (a read was still unanswered at the deadline)');
      await sleep(Math.max(0, Math.min(interval, deadline - Date.now())));
    }
  } finally {
    clearInterval(heartbeat);
  }
}
