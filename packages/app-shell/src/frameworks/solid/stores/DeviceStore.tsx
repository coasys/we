/**
 * DeviceStore — the device keys that speak for the person, and adding or revoking one.
 *
 * Reads `IdentityPort.devices` (the device keys the key log lists). Adding and revoking are changes
 * like any other (`IdentityPort.change`): the backend asks the person wherever it keeps the master
 * key, and signs the change there. The device list is read again when either ends.
 *
 * Chrome tier only (`devices` in `templateSurface.ts`): a space template never sees a person's
 * devices.
 */
import { type DeviceRow, deviceRows } from '@shared/identityRows';
import type { DeviceKeyView, IdentityChangeOutcome } from '@we/backend-shared';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  type ParentProps,
  useContext,
} from 'solid-js';

import { useIdentityStore } from './IdentityStore';
import { useSessionStore } from './SessionStore';

export interface DeviceStore {
  /** The device keys, valid first, this computer at the top. */
  devices: Accessor<DeviceRow[]>;
  devicesLoaded: Accessor<boolean>;
  /** How many keys are valid. */
  validCount: Accessor<number>;
  /** Add and revoke can be offered: this computer keeps the master key of the identity. */
  canManage: Accessor<boolean>;
  /** Why the last read failed, or empty. */
  error: Accessor<string>;

  refresh: () => Promise<void>;
  /** Adds a device to the identity. */
  addDevice: () => Promise<IdentityChangeOutcome>;
  /** Revokes the device key `keyId`. */
  revoke: (keyId: string) => Promise<IdentityChangeOutcome>;
}

const DeviceStoreContext = createContext<DeviceStore>();

export function DeviceStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const identity = useIdentityStore();
  const port = () => session.backendPorts()?.identity ?? null;

  const [raw, setRaw] = createSignal<DeviceKeyView[]>([]);
  const [devicesLoaded, setDevicesLoaded] = createSignal(false);
  const [error, setError] = createSignal('');

  // As in the identity store: a reply belongs to the port it was asked of and to the latest read.
  let generation = 0;
  createEffect(
    on(port, () => {
      generation++;
      setRaw([]);
      setDevicesLoaded(false);
      setError('');
    }),
  );

  async function refresh(): Promise<void> {
    const p = port();
    if (!p?.devices) return;
    const asked = ++generation;
    const current = () => asked === generation && port() === p;
    try {
      // A device speaking for nobody has no log, so no devices; asking would only be refused.
      const next = identity.did() ? await p.devices() : [];
      if (!current()) return;
      setRaw(next);
      setDevicesLoaded(true);
      setError('');
    } catch (e) {
      if (!current()) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // The device list follows the key log: read it whenever the identity store has read the log again.
  createEffect(() => {
    if (identity.keyLogLoaded()) {
      identity.keyLog();
      void refresh();
    }
  });

  async function step(run: () => Promise<IdentityChangeOutcome>): Promise<IdentityChangeOutcome> {
    const outcome = await run();
    await refresh();
    return outcome;
  }

  const rows = createMemo(() => deviceRows(raw()));
  const store: DeviceStore = {
    devices: rows,
    devicesLoaded,
    validCount: () => rows().filter((d) => !d.revoked).length,
    canManage: () =>
      session.identityCapabilities().linkDevice &&
      identity.canChange() &&
      !!identity.did() &&
      !!identity.custody()?.holdsMaster,
    error,
    refresh,
    addDevice: () => step(() => identity.open({ kind: 'add-device' })),
    revoke: (keyId: string) => step(() => identity.open({ kind: 'revoke', keyId })),
  };

  return <DeviceStoreContext.Provider value={store}>{props.children}</DeviceStoreContext.Provider>;
}

export function useDeviceStore(): DeviceStore {
  const store = useContext(DeviceStoreContext);
  if (!store) throw new Error('useDeviceStore must be used within DeviceStoreProvider');
  return store;
}
