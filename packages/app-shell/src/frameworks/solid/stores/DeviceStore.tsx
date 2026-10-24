/**
 * DeviceStore — the device keys that speak for the person, and adding or revoking one.
 *
 * Reads `IdentityPort.devices` (the executor's `identity.devices`, from the key log). Changes go
 * through the host's identity window like every other change to the identity: Add a device opens
 * the `add-device` step, where the window shows the offer link and its QR code, then the match code,
 * and the person confirms there, which signs the `add`; Revoke opens `revoke`, which signs the
 * `revoke`. The device list is read again when either step ends.
 *
 * Chrome tier only (`devices` in `templateSurface.ts`): a space template never sees a person's
 * devices.
 */
import { type DeviceRow, deviceRows } from '@shared/identityRows';
import type { IdentityStepOutcome } from '@shared/platform/types';
import type { DeviceKeyView } from '@we/backend-shared';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
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
  /** Add and revoke can be offered: this computer keeps the master key of an identity. */
  canManage: Accessor<boolean>;
  /** Why the last read failed, or empty. */
  error: Accessor<string>;

  refresh: () => Promise<void>;
  /** Opens the identity window on Add a device. */
  addDevice: () => Promise<IdentityStepOutcome>;
  /** Opens the identity window on revoking `keyId`. */
  revoke: (keyId: string) => Promise<IdentityStepOutcome>;
}

const DeviceStoreContext = createContext<DeviceStore>();

export function DeviceStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const identity = useIdentityStore();
  const port = () => session.backendPorts()?.identity ?? null;

  const [raw, setRaw] = createSignal<DeviceKeyView[]>([]);
  const [devicesLoaded, setDevicesLoaded] = createSignal(false);
  const [error, setError] = createSignal('');

  async function refresh(): Promise<void> {
    const p = port();
    if (!p?.devices) return;
    try {
      // A device speaking for nobody has no log, so no devices; asking would only be refused.
      setRaw(identity.did() ? await p.devices() : []);
      setDevicesLoaded(true);
      setError('');
    } catch (e) {
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

  async function step(run: () => Promise<IdentityStepOutcome>): Promise<IdentityStepOutcome> {
    const outcome = await run();
    await refresh();
    return outcome;
  }

  const rows = createMemo(() => deviceRows(raw()));
  const store: DeviceStore = {
    devices: rows,
    devicesLoaded,
    validCount: () => rows().filter((d) => !d.revoked).length,
    canManage: () => identity.canChange() && !!identity.did() && !!identity.custody()?.holdsMaster,
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
