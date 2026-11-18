import { describe, expect, it } from 'vitest';

import { latest } from './latest';

describe('latest', () => {
  it('keeps a call current until another begins', () => {
    const calls = latest();
    const first = calls.begin();
    expect(first()).toBe(true);

    const second = calls.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('makes every call stale on cancel', () => {
    const calls = latest();
    const running = calls.begin();
    calls.cancel();
    expect(running()).toBe(false);
    expect(calls.begin()()).toBe(true);
  });

  it('checks the running call without overtaking it', () => {
    const calls = latest();
    const running = calls.begin();
    const joined = calls.current();
    expect(running()).toBe(true);
    expect(joined()).toBe(true);

    calls.cancel();
    expect(joined()).toBe(false);
  });

  it('lets an overtaken async call discard its answer', async () => {
    const calls = latest();
    const published: string[] = [];
    const run = async (answer: string, ms: number) => {
      const isCurrent = calls.begin();
      await new Promise((resolve) => setTimeout(resolve, ms));
      if (isCurrent()) published.push(answer);
    };

    await Promise.all([run('slow', 20), run('fast', 1)]);
    expect(published).toEqual(['fast']);
  });

  it('keeps separate instances apart', () => {
    const a = latest();
    const b = latest();
    const inA = a.begin();
    b.begin();
    b.cancel();
    expect(inA()).toBe(true);
  });
});
