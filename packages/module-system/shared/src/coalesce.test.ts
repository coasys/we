import { describe, expect, it } from 'vitest';

import { coalesceByKey } from './coalesce';

/** Work whose runs the test finishes by hand, numbered in the order they started. */
function controlled() {
  const finish: ((fail?: boolean) => void)[] = [];
  let runs = 0;
  const work = () => {
    runs += 1;
    const n = runs;
    return new Promise<number>((resolve, reject) =>
      finish.push((fail) => (fail ? reject(new Error(`run ${n} failed`)) : resolve(n))),
    );
  };
  return { work, finish, runs: () => runs };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('coalesceByKey', () => {
  it('runs once, then once more for every call made while it ran', async () => {
    const coalesce = coalesceByKey();
    const c = controlled();

    const first = coalesce('k', c.work);
    const second = coalesce('k', c.work);
    const third = coalesce('k', c.work);
    expect(c.runs()).toBe(1);

    c.finish[0]();
    expect(await first).toBe(1);
    await flush();
    expect(c.runs()).toBe(2);

    c.finish[1]();
    // Both asked while run 1 was going, so both are answered by run 2.
    expect(await second).toBe(2);
    expect(await third).toBe(2);
    expect(c.runs()).toBe(2);
  });

  it('queues behind the queued run once it has started', async () => {
    const coalesce = coalesceByKey();
    const c = controlled();

    void coalesce('k', c.work);
    const second = coalesce('k', c.work);
    c.finish[0]();
    await flush();
    // Run 2 is going now, so a new call cannot be answered by it.
    const third = coalesce('k', c.work);
    c.finish[1]();
    expect(await second).toBe(2);
    await flush();
    expect(c.runs()).toBe(3);
    c.finish[2]();
    expect(await third).toBe(3);
  });

  it('keeps keys apart', () => {
    const coalesce = coalesceByKey();
    const c = controlled();

    void coalesce('a', c.work);
    void coalesce('b', c.work);

    expect(c.runs()).toBe(2);
  });

  it('runs the queued run after a failed one, and gives the failure only to its own callers', async () => {
    const coalesce = coalesceByKey();
    const c = controlled();

    const first = coalesce('k', c.work);
    const second = coalesce('k', c.work);
    c.finish[0](true);
    await expect(first).rejects.toThrow('run 1 failed');
    await flush();
    c.finish[1]();
    expect(await second).toBe(2);
  });

  it('starts fresh once everything has finished', async () => {
    const coalesce = coalesceByKey();
    const c = controlled();

    const first = coalesce('k', c.work);
    c.finish[0]();
    await first;
    const again = coalesce('k', c.work);
    expect(c.runs()).toBe(2);
    c.finish[1]();
    expect(await again).toBe(2);
  });
});
