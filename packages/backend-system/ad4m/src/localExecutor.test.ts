import { beforeEach, describe, expect, it, vi } from 'vitest';

const constructed: unknown[][] = [];

vi.mock('@coasys/ad4m', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@coasys/ad4m')>();
  class Ad4mClient {
    agent = { status: async () => ({ isInitialized: true, isUnlocked: true }) };
    constructor(...args: unknown[]) {
      constructed.push(args);
    }
  }
  return { ...actual, Ad4mClient };
});

const { connectToLocalExecutor } = await import('./localExecutor');

describe('connectToLocalExecutor', () => {
  beforeEach(() => {
    constructed.length = 0;
  });

  it('builds the client from the base URL and token only', async () => {
    const { status } = await connectToLocalExecutor(12000, 'token');

    // @coasys/ad4m removed the constructor's `subscribe` flag (coasys/ad4m#1187): the third
    // parameter is now `sharedApiClient`, so passing a boolean there fails to type-check.
    expect(constructed).toEqual([['http://localhost:12000', 'token']]);
    expect(status.isInitialized).toBe(true);
  });
});
