/**
 * DeviceStore — the devices that speak for the person: linking one, naming one, revoking one, and
 * who keeps the master key.
 *
 * Reads `IdentityPort.devices` (the device keys the key log lists) and names them from the private
 * record the custody view carries (`IdentityCustodyView.devices`), with who keeps the master key and
 * what other devices asked. Everything else is a change like any other (`IdentityPort.change`): the
 * backend asks the person wherever it keeps the master key, and signs there. The device list is read
 * again when one ends.
 *
 * Chrome tier only (`devices` in `templateSurface.ts`): a space template never sees a person's
 * devices.
 */
import { type DeviceRow, deviceRows, type RequestRow, requestRows } from '@shared/identityRows';
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
  /**
   * Linking, naming, revoking and answering requests can be offered: this computer keeps the master
   * key of the identity.
   */
  canManage: Accessor<boolean>;
  /** "Show code" can be offered: this computer can join an identity, and speaks for none yet. */
  canShowCode: Accessor<boolean>;
  /** "Ask for master key": a device of the identity that does not keep it, nor has it waiting. */
  canAskMaster: Accessor<boolean>;
  /** A master key another device sent waits here: "Accept master key". */
  masterWaiting: Accessor<boolean>;
  /** What other devices asked, waiting for an answer from a device that keeps the master key. */
  requests: Accessor<RequestRow[]>;
  /** Why the last read failed, or empty. */
  error: Accessor<string>;

  refresh: () => Promise<void>;
  /** Adds a server to the identity, by an offer link it is given. */
  addDevice: () => Promise<IdentityChangeOutcome>;
  /** Adds a device by the code it shows ("Enter code"). */
  scanDevice: () => Promise<IdentityChangeOutcome>;
  /** Shows this computer's code, for a device of the identity to add it. */
  showCode: () => Promise<IdentityChangeOutcome>;
  /** Keeps the master key waiting here. */
  takeMaster: () => Promise<IdentityChangeOutcome>;
  /** Asks a device that keeps the master key to send it here. */
  askMaster: () => Promise<IdentityChangeOutcome>;
  /** Answers the request `id` of another device. */
  answerRequest: (id: string) => Promise<IdentityChangeOutcome>;
  /** Names the device `keyId`. */
  rename: (keyId: string) => Promise<IdentityChangeOutcome>;
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

  const names = () => identity.custody()?.devices ?? [];
  const rows = createMemo(() => deviceRows(raw(), names(), identity.custody()?.revokedHolders ?? []));
  const linking = () => session.identityCapabilities().linkDevice && identity.canChange();
  const canManage = () => linking() && !!identity.did() && !!identity.custody()?.holdsMaster;
  const masterWaiting = () => !!identity.custody()?.masterWaiting;
  const store: DeviceStore = {
    devices: rows,
    devicesLoaded,
    validCount: () => rows().filter((d) => !d.revoked).length,
    canManage,
    canShowCode: () => linking() && identity.statusLoaded() && !identity.did() && !identity.custody()?.holdsMaster,
    canAskMaster: () =>
      linking() &&
      !!identity.did() &&
      !!identity.keyId() &&
      !identity.thisDeviceRevoked() &&
      !identity.custody()?.holdsMaster &&
      !masterWaiting(),
    masterWaiting,
    requests: createMemo(() =>
      canManage() ? requestRows(identity.custody()?.requests ?? [], names(), identity.keyId() || null) : [],
    ),
    error,
    refresh,
    addDevice: () => step(() => identity.open({ kind: 'add-device' })),
    scanDevice: () => step(() => identity.open({ kind: 'scan-device' })),
    showCode: () => step(() => identity.open({ kind: 'show-code' })),
    takeMaster: () => step(() => identity.open({ kind: 'take-master' })),
    askMaster: () => step(() => identity.open({ kind: 'ask-master' })),
    answerRequest: (id: string) => step(() => identity.open({ kind: 'answer-request', id })),
    rename: (keyId: string) => step(() => identity.open({ kind: 'rename', keyId })),
    revoke: (keyId: string) => step(() => identity.open({ kind: 'revoke', keyId })),
  };

  return <DeviceStoreContext.Provider value={store}>{props.children}</DeviceStoreContext.Provider>;
}

export function useDeviceStore(): DeviceStore {
  const store = useContext(DeviceStoreContext);
  if (!store) throw new Error('useDeviceStore must be used within DeviceStoreProvider');
  return store;
}
