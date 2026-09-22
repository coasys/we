/**
 * Call configuration — store integration tests.
 *
 * Verifies that the call store correctly manages SFU topology configuration:
 * - Loads config from the host's `getCallConfig` port on dataset change
 * - Exposes config fields as reactive state
 * - Writes individual fields through `setCallConfigField`
 * - Writes full config through `saveCallConfig`
 * - Refreshes available SFU nodes on demand
 * - Falls back to mesh defaults when the backend lacks support
 */
import { markAction, markState } from '@we/module-shared';
import { describe, expect, it, vi } from 'vitest';

import { type CallConfigState, type CallSfuNodeState, createCallStore } from './store';

const baseDeps = { state: markState, action: markAction, kernels: {} } as const;

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
  fallback: 'mesh',
  maxMeshParticipants: 6,
  sfuPeers: [],
};

const SFU_CONFIG: CallConfigState = {
  mode: 'designated',
  designatedPeer: 'did:key:z6MkSFU',
  fallback: 'mesh',
  maxMeshParticipants: 4,
  sfuPeers: [],
};

const SFU_NODES: CallSfuNodeState[] = [
  { did: 'did:key:z6MkNode1', bindAddress: '10.0.0.1:8443' },
  { did: 'did:key:z6MkNode2', bindAddress: '10.0.0.2:8443' },
];

describe('call config — store integration', () => {
  it('defaults to mesh config before any load', () => {
    const store = createCallStore({ ...baseDeps, signal });
    expect(store.callConfig()).toEqual(MESH_DEFAULT);
    expect(store.callConfigSupported()).toBe(false);
    expect(store.availableSfuNodes()).toEqual([]);
  });

  it('loads config from the host when dataset changes', async () => {
    const { effect, flush } = createEffectRunner();
    const [dataset, setDataset] = signal<unknown>(null);
    const [datasetUri, setDatasetUri] = signal<string | null>(null);

    const getCallConfig = vi.fn().mockResolvedValue(SFU_CONFIG);
    const getAvailableSfuNodes = vi.fn().mockResolvedValue(SFU_NODES);
    const callConfigSupported = vi.fn().mockReturnValue(true);

    const store = createCallStore({
      ...baseDeps,
      signal,
      effect,
      dataset: dataset as () => null,
      datasetUri,
      getCallConfig,
      getAvailableSfuNodes,
      callConfigSupported,
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
    expect(store.availableSfuNodes()).toEqual(SFU_NODES);
  });

  it('falls back to mesh defaults when getCallConfig rejects', async () => {
    const { effect, flush } = createEffectRunner();

    const getCallConfig = vi.fn().mockRejectedValue(new Error('RPC failed'));
    const getAvailableSfuNodes = vi.fn().mockResolvedValue([]);
    const callConfigSupported = vi.fn().mockReturnValue(true);

    const store = createCallStore({
      ...baseDeps,
      signal,
      effect,
      dataset: () => ({ id: 'test' }) as never,
      datasetUri: () => 'neighbourhood://test',
      getCallConfig,
      getAvailableSfuNodes,
      callConfigSupported,
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
      callConfigSupported: () => false,
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
      getCallConfig: async () => SFU_CONFIG,
      setCallConfig,
      callConfigSupported: () => true,
    });

    // Pre-populate the config signal by calling saveCallConfig
    await store.saveCallConfig(SFU_CONFIG);

    // Now change one field
    await store.setCallConfigField('mode', 'cascaded');

    expect(setCallConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'cascaded', designatedPeer: 'did:key:z6MkSFU' }),
    );
    expect(store.callConfig().mode).toBe('cascaded');
  });

  it('writes the full config through saveCallConfig', async () => {
    const setCallConfig = vi.fn().mockResolvedValue(true);

    const store = createCallStore({
      ...baseDeps,
      signal,
      setCallConfig,
    });

    const newConfig: CallConfigState = {
      mode: 'gateway',
      fallback: 'designated',
      maxMeshParticipants: 10,
      sfuPeers: ['did:key:z6MkA', 'did:key:z6MkB'],
    };

    await store.saveCallConfig(newConfig);

    expect(setCallConfig).toHaveBeenCalledWith(newConfig);
    expect(store.callConfig()).toEqual(newConfig);
  });

  it('does not update the signal when setCallConfig returns false', async () => {
    const setCallConfig = vi.fn().mockResolvedValue(true);

    const store = createCallStore({ ...baseDeps, signal, setCallConfig });

    // Pre-populate — this write succeeds
    await store.saveCallConfig(SFU_CONFIG);
    expect(store.callConfig().mode).toBe('designated');

    // Now make subsequent writes fail
    setCallConfig.mockResolvedValue(false);

    await store.saveCallConfig({ ...SFU_CONFIG, mode: 'cascaded' });

    // The signal should still hold the old config because the write returned false
    expect(store.callConfig().mode).toBe('designated');
  });

  it('tracks saving state during config writes', async () => {
    let resolveWrite: (v: boolean) => void;
    const setCallConfig = vi.fn().mockImplementation(() => new Promise<boolean>((r) => (resolveWrite = r)));

    const store = createCallStore({ ...baseDeps, signal, setCallConfig });

    expect(store.callConfigSaving()).toBe(false);

    const promise = store.saveCallConfig(SFU_CONFIG);
    expect(store.callConfigSaving()).toBe(true);

    resolveWrite!(true);
    await promise;
    expect(store.callConfigSaving()).toBe(false);
  });

  it('refreshes SFU nodes on demand', async () => {
    const getAvailableSfuNodes = vi.fn().mockResolvedValue(SFU_NODES);

    const store = createCallStore({ ...baseDeps, signal, getAvailableSfuNodes });

    expect(store.availableSfuNodes()).toEqual([]);

    await store.refreshSfuNodes();

    expect(store.availableSfuNodes()).toEqual(SFU_NODES);
    expect(getAvailableSfuNodes).toHaveBeenCalledOnce();
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
