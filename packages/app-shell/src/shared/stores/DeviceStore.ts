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
import type { DeviceKeyView, IdentityChangeOutcome } from '@we/backend-shared';
import { latest } from '@we/module-shared';
import type { Accessor, ReactivityPort } from '@we/reactivity';

import { type DeviceRow, deviceRows } from '../identityRows';
import type { IdentitySession, IdentityStore } from './IdentityStore';

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

export function createDeviceStore({
  reactivity,
  sessionStore: session,
  identityStore: identity,
}: {
  reactivity: ReactivityPort;
  sessionStore: IdentitySession;
  identityStore: IdentityStore;
}): DeviceStore {
  const { signal, memo, effect, untrack, batch } = reactivity;
  const port = () => session.backendPorts()?.identity ?? null;

  const [raw, setRaw] = signal<DeviceKeyView[]>([]);
  const [devicesLoaded, setDevicesLoaded] = signal(false);
  const [error, setError] = signal('');

  // As in the identity store: a reply belongs to the port it was asked of and to the latest read.
  const reads = latest();
  function forget() {
    reads.cancel();
    batch(() => {
      setRaw([]);
      setDevicesLoaded(false);
      setError('');
    });
  }

  async function refresh(): Promise<void> {
    const p = port();
    if (!p?.devices) return;
    const isLatest = reads.begin();
    const current = () => isLatest() && port() === p;
    try {
      // A device speaking for nobody has no log, so no devices; asking would only be refused.
      const next = identity.did() ? await p.devices() : [];
      if (!current()) return;
      batch(() => {
        setRaw(next);
        setDevicesLoaded(true);
        setError('');
      });
    } catch (e) {
      if (!current()) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /*
    The device list follows the key log: read it whenever the identity store has read the log again,
    after forgetting another backend's in the same effect — as the identity store does, and for its
    reason: the port promises no order between sibling effects, and forgetting cancels the read.
  */
  let seen: ReturnType<typeof port> | undefined;
  effect(() => {
    const p = port();
    if (p !== seen) {
      seen = p;
      untrack(forget);
    }
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

  const rows = memo(() => deviceRows(raw()));
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

  return store;
}
