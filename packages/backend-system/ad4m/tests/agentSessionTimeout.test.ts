/**
 * An unlock whose reply timed out is not a refused unlock.
 *
 * The client abandons an RPC after 30s, but the executor goes on starting Holochain and loading
 * languages, and says so with an `agent-status-changed` event when it is done. A cold start — or a
 * handler held up on a remote server — outlasts that, and the shell used to report the 408 as
 * "Incorrect password" about a password that had been accepted.
 */
import { RpcError } from '@coasys/ad4m';
import { isSessionTimeout } from '@we/backend-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAd4mAgentSession } from '../src/lifecycleAdapter';

type StatusListener = (status: unknown) => void;

/** A client whose unlock does what the test says, and whose status events the test can fire. */
function fakeClient(unlock: () => Promise<unknown>) {
  let listener: StatusListener = () => {};
  const client = {
    agent: {
      unlock,
      addAgentStatusChangedListener: (l: StatusListener) => {
        listener = l;
      },
    },
  };
  return { client, emitStatus: (status: unknown) => listener(status) };
}

const timedOut = () => Promise.reject(new RpcError(408, "RPC call 'agent.unlock' timed out after 30000ms"));

describe('AD4M agent session — unlock that outlasts the RPC timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The file-storage install after a successful unlock is best-effort and warns against a fake.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits for the executor to announce the unlock, and resolves', async () => {
    const { client, emitStatus } = fakeClient(timedOut);
    const unlocking = createAd4mAgentSession(client).unlock('pw');

    await vi.advanceTimersByTimeAsync(60_000);
    emitStatus({ isUnlocked: true, did: 'did:key:zAgent' });

    await expect(unlocking).resolves.toBeUndefined();
  });

  it('does not count a status event that is still locked', async () => {
    const { client, emitStatus } = fakeClient(timedOut);
    const unlocking = createAd4mAgentSession(client).unlock('pw');
    const outcome = unlocking.then(
      () => 'resolved',
      () => 'rejected',
    );

    emitStatus({ isUnlocked: false });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe('pending');
    emitStatus({ isUnlocked: true });
    await expect(unlocking).resolves.toBeUndefined();
  });

  it('gives up with a SessionTimeoutError when the executor never announces it', async () => {
    const { client } = fakeClient(timedOut);
    const unlocking = createAd4mAgentSession(client).unlock('pw');
    const settled = unlocking.catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(150_000);

    expect(isSessionTimeout(await settled)).toBe(true);
  });

  it('rethrows a refusal as it came, without waiting', async () => {
    const refusal = new RpcError(500, 'aead::Error');
    const { client } = fakeClient(() => Promise.reject(refusal));

    await expect(createAd4mAgentSession(client).unlock('wrong')).rejects.toBe(refusal);
  });
});
