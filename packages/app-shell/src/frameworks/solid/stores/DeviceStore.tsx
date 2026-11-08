/**
 * DeviceStore — the devices that speak for the person: linking one, naming one, revoking one, and
 * who keeps the master key; and the 12 words typed back in, to replace the master key or restore the
 * identity on a computer of none.
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
import {
  custodyDevice,
  deviceNoun,
  type DeviceRow,
  deviceRows,
  lastRotation,
  type RequestRow,
  requestRows,
  type ServingDevice,
  servingDevice,
} from '@shared/identityRows';
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
  /**
   * The device serving this session, for the top of Devices: "This computer" on the desktop; on a
   * phone, the host it signs in to, by its name in the record or "Your host".
   */
  serving: Accessor<ServingDevice>;
  /** What this device is, for the sentences about it: "phone" on a phone, "computer" on the desktop. */
  deviceNoun: Accessor<'phone' | 'computer'>;
  /** How many device keys are valid: neither revoked nor ended. A bot's key is not a device's. */
  validCount: Accessor<number>;
  /**
   * Linking, naming, revoking and answering requests can be offered: this computer keeps the master
   * key of the identity.
   */
  canManage: Accessor<boolean>;
  /** "Show my code" can be offered: this computer can join an identity, and speaks for none yet. */
  canShowCode: Accessor<boolean>;
  /** "Ask for the master key": a device of the identity that does not keep it, nor has it waiting. */
  canAskMaster: Accessor<boolean>;
  /**
   * "Replace my master key" can be offered: a device of the identity, where the custody service takes
   * the 12 words. It need not keep the master key: replacing it is how a lost holder is shut out.
   */
  canReplaceMaster: Accessor<boolean>;
  /** "Use my 12 words" can be offered: this computer can take the words, and speaks for no identity. */
  canRestore: Accessor<boolean>;
  /** "Also remove my master key from this computer" can be offered on log out: it keeps one. */
  canRemoveMaster: Accessor<boolean>;
  /** A master key another device sent waits here: "Take the master key". */
  masterWaiting: Accessor<boolean>;
  /** What other devices asked, waiting for an answer from a device that keeps the master key. */
  requests: Accessor<RequestRow[]>;
  /** Why the last read failed, or empty. */
  error: Accessor<string>;

  refresh: () => Promise<void>;
  /** Adds a server to the identity, by an offer link it is given. */
  addDevice: () => Promise<IdentityChangeOutcome>;
  /** Adds a device by the code it shows ("Scan or paste a code"). */
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
  /** Revokes the device key `keyId`; the window offers to replace the master key too. */
  revoke: (keyId: string) => Promise<IdentityChangeOutcome>;
  /** Replaces the master key from the 12 words; this computer keeps the new one. */
  replaceMaster: () => Promise<IdentityChangeOutcome>;
  /** Restores the identity of the 12 words on this computer, locking out the devices picked. */
  restore: () => Promise<IdentityChangeOutcome>;
  /** Stops keeping the master key on this computer; refused when it is the only copy. */
  removeMaster: () => Promise<IdentityChangeOutcome>;
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
  // A phone's custody service answers for the phone, not for the executor's computer it reaches.
  const here = createMemo(() => custodyDevice(identity.custody()));
  const rows = createMemo(() =>
    deviceRows(
      raw(),
      names(),
      identity.custody()?.revokedHolders ?? [],
      lastRotation(identity.keyLog()),
      undefined,
      here(),
    ),
  );
  // The words go to the custody service, which the `recoveryWords` capability says is here.
  const words = () => session.identityCapabilities().recoveryWords && identity.canChange();
  const linking = () => session.identityCapabilities().linkDevice && identity.canChange();
  const canManage = () => linking() && !!identity.did() && !!identity.custody()?.holdsMaster;
  const masterWaiting = () => !!identity.custody()?.masterWaiting;
  const store: DeviceStore = {
    devices: rows,
    devicesLoaded,
    serving: createMemo(() => servingDevice(raw(), names(), here())),
    deviceNoun: () => deviceNoun(here()),
    validCount: () => rows().filter((d) => d.valid).length,
    canManage,
    canShowCode: () => linking() && identity.statusLoaded() && !identity.did() && !identity.custody()?.holdsMaster,
    canAskMaster: () =>
      linking() &&
      !!identity.did() &&
      !!identity.keyId() &&
      !identity.thisDeviceRevoked() &&
      !identity.custody()?.holdsMaster &&
      !masterWaiting(),
    canReplaceMaster: () => words() && !!identity.did() && !!identity.keyId() && !identity.thisDeviceRevoked(),
    canRestore: () => words() && identity.statusLoaded() && !identity.did() && !identity.custody()?.holdsMaster,
    canRemoveMaster: () => linking() && !!identity.did() && !!identity.custody()?.holdsMaster,
    masterWaiting,
    requests: createMemo(() =>
      canManage()
        ? requestRows(
            identity.custody()?.requests ?? [],
            names(),
            here() ? here()!.keyId : identity.keyId() || null,
            here()?.label,
          )
        : [],
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
    replaceMaster: () => step(() => identity.open({ kind: 'replace-master' })),
    restore: () => step(() => identity.open({ kind: 'restore' })),
    removeMaster: () => step(() => identity.open({ kind: 'remove-master' })),
  };

  return <DeviceStoreContext.Provider value={store}>{props.children}</DeviceStoreContext.Provider>;
}

export function useDeviceStore(): DeviceStore {
  const store = useContext(DeviceStoreContext);
  if (!store) throw new Error('useDeviceStore must be used within DeviceStoreProvider');
  return store;
}
