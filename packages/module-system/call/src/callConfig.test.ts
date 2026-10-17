/**
 * Call configuration — store integration tests.
 *
 * Verifies that the call store correctly manages SFU topology configuration:
 * - Loads config through the `call` kernel's `config` on dataset change
 * - Exposes config fields as reactive state
 * - Writes individual fields through `setCallConfigField`
 * - Writes full config through `saveCallConfig`
 * - Refreshes available SFU nodes on demand
 * - Falls back to mesh defaults when the backend lacks support
 */
import { type CallKernel, markAction, markState } from '@we/module-shared';
import { describe, expect, it, vi } from 'vitest';

import { type CallConfigState, createCallStore } from './store';

const baseDeps = { state: markState, action: markAction, kernels: {} } as const;

/** The `call` kernel with only the policy half wired — what these tests are about. */
function withCall(policy: Partial<CallKernel>) {
  const call: CallKernel = {
    available: () => false,
    session: () => Promise.reject(new Error('no session in these tests')),
    config: () => Promise.reject(new Error('no policy')),
    setConfig: async () => false,
    configurable: () => false,
    ...policy,
  };
  return { kernels: { call } };
}

/** Minimal reactive system — same shape the store.test.ts helpers use. */
function signal<T>(initial: T): [() => T, (next: T) => void] {
  let value = initial;
  return [() => value, (next: T) => (value = next)];
}

/** Collect effects and run them synchronously — enough for config loading tests. */
function createEffectRunner() {
  const effects: (() => void)[] = [];
  return {
    effect: (fn: () => void) => {
      effects.push(fn);
    },
    flush: () => {
      for (const fn of effects) fn();
    },
  };
}

const MESH_DEFAULT: CallConfigState = {
  mode: 'mesh',
  maxMeshParticipants: 6,
};

const SFU_CONFIG: CallConfigState = {
  mode: 'designated',
  maxMeshParticipants: 4,
};

/**
 * What `sfu.getConfig` answers: the space's policy, plus this executor's own node settings, which
 * it refuses on a write.
 */
const READ_CONFIG = {
  ...SFU_CONFIG,
  fallback: 'mesh',
  sfuPeers: ['did:key:z6MkPeer'],
  maxParticipantsPerNode: 20,
  preferredSfuDid: 'did:key:z6MkPreferred',
};

describe('call config — store integration', () => {
  it('defaults to mesh config before any load', () => {
    const store = createCallStore({ ...baseDeps, signal });
    expect(store.callConfig()).toEqual(MESH_DEFAULT);
    expect(store.callConfigSupported()).toBe(false);
  });

  it("keeps only the space's policy from a read, so a write never sends the executor's node settings back", async () => {
    // The executor refuses a write that carries any node field. Echoing a read back field by field
    // was how the first edit of a loaded config would have failed.
    const { effect, flush } = createEffectRunner();
    const setCallConfig = vi.fn().mockResolvedValue(true);
    const store = createCallStore({
      ...baseDeps,
      signal,
      effect,
      dataset: () => ({ id: 'test' }) as never,
      datasetUri: () => 'neighbourhood://test',
      ...withCall({ config: async () => READ_CONFIG, setConfig: setCallConfig, configurable: () => true }),
    });
    flush();
    await vi.waitFor(() => expect(store.callConfig()).toEqual(SFU_CONFIG));

    await store.setCallConfigField('maxMeshParticipants', 8);
    await store.saveCallConfig({ ...READ_CONFIG, mode: 'cascaded' } as CallConfigState);

    expect(setCallConfig.mock.calls.map(([config]) => config)).toEqual([
      { mode: 'designated', maxMeshParticipants: 8 },
      { mode: 'cascaded', maxMeshParticipants: 4 },
    ]);
  });

  it('loads config from the host when dataset changes', async () => {
    const { effect, flush } = createEffectRunner();
    const [dataset, setDataset] = signal<unknown>(null);
    const [datasetUri, setDatasetUri] = signal<string | null>(null);

    const getCallConfig = vi.fn().mockResolvedValue(SFU_CONFIG);
    const callConfigSupported = vi.fn().mockReturnValue(true);

    const store = createCallStore({
      ...baseDeps,
      signal,
      effect,
      dataset: dataset as () => null,
      datasetUri,
      ...withCall({ config: getCallConfig, configurable: callConfigSupported }),
    });

    // Simulate a dataset becoming available
    setDataset({ id: 'test-space' });
    setDatasetUri('neighbourhood://test');
    flush();

    // Wait for the async config load
    await vi.waitFor(() => {
      expect(getCallConfig).toHaveBeenCalledOnce();
    });

    // Allow microtasks to resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(store.callConfig()).toEqual(SFU_CONFIG);
    expect(store.callConfigSupported()).toBe(true);
  });

  it('falls back to mesh defaults when the policy read rejects', async () => {
    const { effect, flush } = createEffectRunner();

    const getCallConfig = vi.fn().mockRejectedValue(new Error('RPC failed'));
    const callConfigSupported = vi.fn().mockReturnValue(true);

    const store = createCallStore({
      ...baseDeps,
      signal,
      effect,
      dataset: () => ({ id: 'test' }) as never,
      datasetUri: () => 'neighbourhood://test',
      ...withCall({ config: getCallConfig, configurable: callConfigSupported }),
    });

    flush();
    await new Promise((r) => setTimeout(r, 10));

    expect(store.callConfig()).toEqual(MESH_DEFAULT);
  });

  it('resets to mesh defaults when backend lacks support', () => {
    const { effect, flush } = createEffectRunner();

    const store = createCallStore({
      ...baseDeps,
      signal,
      effect,
      dataset: () => ({ id: 'test' }) as never,
      datasetUri: () => 'neighbourhood://test',
      ...withCall({ configurable: () => false }),
    });

    flush();

    expect(store.callConfigSupported()).toBe(false);
    expect(store.callConfig()).toEqual(MESH_DEFAULT);
  });

  it('writes a single field through setCallConfigField', async () => {
    const setCallConfig = vi.fn().mockResolvedValue(true);

    const store = createCallStore({
      ...baseDeps,
      signal,
      ...withCall({ config: async () => SFU_CONFIG, setConfig: setCallConfig, configurable: () => true }),
    });

    // Pre-populate the config signal by calling saveCallConfig
    await store.saveCallConfig(SFU_CONFIG);

    // Now change one field
    await store.setCallConfigField('mode', 'cascaded');

    expect(setCallConfig).toHaveBeenLastCalledWith({ mode: 'cascaded', maxMeshParticipants: 4 });
    expect(store.callConfig().mode).toBe('cascaded');
  });

  it('writes the full config through saveCallConfig', async () => {
    const setCallConfig = vi.fn().mockResolvedValue(true);

    const store = createCallStore({
      ...baseDeps,
      signal,
      ...withCall({ setConfig: setCallConfig }),
    });

    const newConfig: CallConfigState = {
      mode: 'gateway',
      maxMeshParticipants: 10,
    };

    await store.saveCallConfig(newConfig);

    expect(setCallConfig).toHaveBeenCalledWith(newConfig);
    expect(store.callConfig()).toEqual(newConfig);
  });

  it('does not update the signal when the policy write returns false', async () => {
    const setCallConfig = vi.fn().mockResolvedValue(true);

    const store = createCallStore({ ...baseDeps, signal, ...withCall({ setConfig: setCallConfig }) });

    // Pre-populate — this write succeeds
    await store.saveCallConfig(SFU_CONFIG);
    expect(store.callConfig().mode).toBe('designated');

    // Now make subsequent writes fail
    setCallConfig.mockResolvedValue(false);

    await store.saveCallConfig({ ...SFU_CONFIG, mode: 'cascaded' });

    // The signal should still hold the old config because the write returned false
    expect(store.callConfig().mode).toBe('designated');
  });

  it('says why when the executor refuses a write, and keeps the old config', async () => {
    const setCallConfig = vi
      .fn()
      .mockRejectedValue(new Error('Only the neighbourhood’s owner can change its rooms or call config'));
    const notify = vi.fn();
    const store = createCallStore({ ...baseDeps, signal, notify, ...withCall({ setConfig: setCallConfig }) });

    await store.setCallConfigField('maxMeshParticipants', 8);

    expect(notify).toHaveBeenCalledWith(
      'error',
      'The call settings were not saved: Only the neighbourhood’s owner can change its rooms or call config',
    );
    expect(store.callConfig().maxMeshParticipants).toBe(6);
    expect(store.callConfigSaving()).toBe(false);
  });

  it('tracks saving state during config writes', async () => {
    let resolveWrite: (v: boolean) => void;
    const setCallConfig = vi.fn().mockImplementation(() => new Promise<boolean>((r) => (resolveWrite = r)));

    const store = createCallStore({ ...baseDeps, signal, ...withCall({ setConfig: setCallConfig }) });

    expect(store.callConfigSaving()).toBe(false);

    const promise = store.saveCallConfig(SFU_CONFIG);
    expect(store.callConfigSaving()).toBe(true);

    resolveWrite!(true);
    await promise;
    expect(store.callConfigSaving()).toBe(false);
  });

  it('connectionInfo reflects current call state', () => {
    const store = createCallStore({ ...baseDeps, signal });

    const info = store.connectionInfo();
    expect(info.topology).toBe('mesh');
    expect(info.hasBackend).toBe(false);
    expect(info.participantCount).toBe(0);
    expect(info.meshLimitReached).toBe(false);
    expect(info.configMode).toBe('mesh');
  });

  it('quality can be set directly instead of cycling', async () => {
    const store = createCallStore({ ...baseDeps, signal });

    expect(store.qualityPreference()).toBe('high');

    await store.setQualityPreference('low');
    expect(store.qualityPreference()).toBe('low');

    await store.setQualityPreference('medium');
    expect(store.qualityPreference()).toBe('medium');
  });
});
