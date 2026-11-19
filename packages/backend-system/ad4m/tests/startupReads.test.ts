/**
 * Opening the app asks the executor each startup question once.
 *
 * A recorded cold open sent `agent.status`, `agent.get`, `ai.models` and `identity.status` twice
 * each: the connection had already read the status, and two stores asked each of the others at the
 * same moment. These pin one request per question, and that a question asked after the answer came
 * back still reaches the executor — sharing is for callers in flight together, not a cache.
 */
import { describe, expect, it, vi } from 'vitest';

import { createAd4mIdentityPort } from '../src/identityPort';
import { createAd4mLanguageModelPort } from '../src/languageModelPort';
import { createAd4mAgentSession, createAd4mDatasetLifecycle } from '../src/lifecycleAdapter';

const DID = 'did:key:zAgent';

/** A client that answers the startup reads and counts them. */
function fakeClient() {
  const client = {
    agent: {
      status: vi.fn(async () => ({ did: DID, isInitialized: true, isUnlocked: true })),
      me: vi.fn(async () => ({ did: DID, perspective: { uuid: 'own-profile', links: [] } })),
    },
    perspective: { all: vi.fn(async () => []) },
    ai: { getModels: vi.fn(async () => [{ modelType: 'LLM' }]) },
    identity: { status: vi.fn(async () => ({ did: DID, devices: [] })) },
    // The ports install file storage after an unlock; a fake that cannot is a warning, not a failure.
    languages: { byAddress: vi.fn(async () => null) },
    runtime: {},
    on: () => () => {},
    addPerspectiveAddedListener: () => {},
  };
  return client;
}

describe('startup reads — one request each', () => {
  it('opening the app issues agent.status once when the connection already found it unlocked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient();
    const session = createAd4mAgentSession(client, { unlockedAtConnect: true });

    await expect(session.status()).resolves.toEqual({ hasAgent: true, unlocked: true });
    expect(client.agent.status).not.toHaveBeenCalled();

    // Only the first answer is the connection's: a later question reaches the executor, so a lock is seen.
    client.agent.status.mockResolvedValueOnce({ did: DID, isInitialized: true, isUnlocked: false });
    await expect(session.status()).resolves.toEqual({ hasAgent: true, unlocked: false });
    expect(client.agent.status).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('asks agent.status itself when the connector did not say', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient();
    await createAd4mAgentSession(client).status();
    expect(client.agent.status).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('the session and the dataset list share one agent.get', async () => {
    const client = fakeClient();
    const session = createAd4mAgentSession(client);
    const lifecycle = createAd4mDatasetLifecycle(client);

    const [me] = await Promise.all([session.me(), lifecycle.list()]);
    expect(me.id).toBe(DID);
    expect(client.agent.me).toHaveBeenCalledTimes(1);

    // Settled, so the next question is asked again.
    await session.me();
    expect(client.agent.me).toHaveBeenCalledTimes(2);
  });

  it('identity capabilities and status share one identity.status', async () => {
    const client = fakeClient();
    const identity = createAd4mIdentityPort(client);

    const [capabilities] = await Promise.all([identity.capabilities(), identity.status?.()]);
    expect(capabilities.keyLog).toBe(true);
    expect(client.identity.status).toHaveBeenCalledTimes(1);
  });

  it('two stores asking whether a model is installed send one ai.models', async () => {
    const client = fakeClient();
    const port = createAd4mLanguageModelPort(client);

    await expect(Promise.all([port.available(), port.available()])).resolves.toEqual([true, true]);
    expect(client.ai.getModels).toHaveBeenCalledTimes(1);

    await port.available();
    expect(client.ai.getModels).toHaveBeenCalledTimes(2);
  });

  it('a shared failure is not remembered', async () => {
    const client = fakeClient();
    client.identity.status.mockRejectedValueOnce(new Error('offline'));
    const identity = createAd4mIdentityPort(client);

    await expect(identity.status?.()).rejects.toThrow('offline');
    await expect(identity.status?.()).resolves.toBeTruthy();
    expect(client.identity.status).toHaveBeenCalledTimes(2);
  });
});

describe('setup nothing on the first screen waits on', () => {
  it('installs the file-storage language after the first screen, not beside its first page', async () => {
    const client = fakeClient();
    let screenUp!: () => void;
    const afterFirstScreen = vi.fn(() => new Promise<void>((resolve) => (screenUp = resolve)));
    const session = createAd4mAgentSession(client, { unlockedAtConnect: true, afterFirstScreen });

    await session.status();
    await Promise.resolve();
    expect(client.languages.byAddress).not.toHaveBeenCalled();

    screenUp();
    await vi.waitFor(() => expect(client.languages.byAddress).toHaveBeenCalledTimes(1));
  });

  it('still installs it at once when signing in, where an upload may follow straight away', async () => {
    const client = { ...fakeClient(), agent: { ...fakeClient().agent, unlock: vi.fn(async () => ({})) } };
    const afterFirstScreen = vi.fn(() => new Promise<void>(() => {}));
    const session = createAd4mAgentSession(client, { afterFirstScreen });
    await session.signIn({ password: 'pw' } as never);
    expect(client.languages.byAddress).toHaveBeenCalledTimes(1);
  });
});
