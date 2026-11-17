/**
 * The desktop hosts' connector waits for the executor by asking `agent.status` until it answers. That
 * answer is the session's first status too: asking again a moment later was the second `agent.status`
 * of a recorded desktop open.
 */
import { describe, expect, it, vi } from 'vitest';

const DID = 'did:key:zAgent';
const status = vi.fn(async () => ({ did: DID, isInitialized: true, isUnlocked: true }));

vi.mock('@coasys/ad4m', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@coasys/ad4m')>();
  /** Answers the reads opening the app makes, and counts `agent.status`. */
  class Ad4mClient {
    agent = { status, me: async () => ({ did: DID, perspective: { uuid: 'own-profile', links: [] } }) };
    perspective = { all: async () => [] };
    languages = { byAddress: async () => null };
    runtime = {};
    ai = {};
    on = () => () => {};
    addPerspectiveAddedListener = () => {};
  }
  return { ...actual, Ad4mClient };
});

const { createLocalAd4mConnector } = await import('../src/localExecutor');

describe('the desktop connector', () => {
  it('hands the session the status it waited for, so opening the app asks agent.status once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const connector = createLocalAd4mConnector(async () => ({ port: 1, token: 't' }), { startupDelayMs: 0 });
    const { ports } = await connector.initialize({ selfId: () => DID });

    await expect(ports.agentSession.status()).resolves.toEqual({ hasAgent: true, unlocked: true });
    expect(status).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('still asks when the executor it waited for was locked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    status.mockClear();
    status.mockResolvedValueOnce({ did: DID, isInitialized: true, isUnlocked: false });
    const connector = createLocalAd4mConnector(async () => ({ port: 1, token: 't' }), { startupDelayMs: 0 });
    const { ports } = await connector.initialize({ selfId: () => DID });

    await ports.agentSession.status();
    expect(status).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
