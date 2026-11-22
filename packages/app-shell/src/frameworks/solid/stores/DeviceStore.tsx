/**
 * DeviceStore — the devices that speak for the person: linking one, naming one, unlinking one,
 * revoking one, and who keeps the master key; and the 12 words typed back in, to replace the master
 * key or restore the identity on a computer of none.
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
import { type DeviceRow, deviceRows, lastRotation, type RequestRow, requestRows } from '@shared/identityRows';
import { type DeviceKeyView, type IdentityChangeOutcome, UnlinkUncertainError } from '@we/backend-shared';
import { latest } from '@we/module-shared';
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

/** How unlinking this computer ended: `'uncertain'` when it may have happened though no answer said so. */
export type UnlinkOutcome = IdentityChangeOutcome | 'uncertain';

export interface DeviceStore {
  /** The device keys, valid first, this computer at the top. */
  devices: Accessor<DeviceRow[]>;
  devicesLoaded: Accessor<boolean>;
  /** How many keys are active: neither unlinked nor revoked. */
  validCount: Accessor<number>;
  /**
   * Linking, naming, unlinking, revoking and answering requests can be offered: this computer keeps the master
   * key of the identity.
   */
  canManage: Accessor<boolean>;
  /** "Show code" can be offered: this computer can join an identity, and speaks for none yet. */
  canShowCode: Accessor<boolean>;
  /**
   * "Ask for master key": a device of the identity that does not keep it, nor has it waiting, and
   * could open it if it came (not `encMismatch`).
   */
  canAskMaster: Accessor<boolean>;
  /**
   * "Replace master key" can be offered: a device of the identity, where the custody service takes
   * the 12 words. It need not keep the master key: replacing it is how a lost holder is shut out.
   * Offered under `encMismatch` too: the words sign the rotation and the new key is kept here, so
   * nothing sent to this computer is needed.
   */
  canReplaceMaster: Accessor<boolean>;
  /**
   * "Restore with recovery phrase" can be offered: this computer can take the words, and speaks for
   * no identity.
   */
  canRestore: Accessor<boolean>;
  /** "Remove master key from this computer?" can be asked on sign out: it keeps one. */
  canRemoveMaster: Accessor<boolean>;
  /**
   * A master key another device sent waits here: "Accept master key". False while `encMismatch`
   * holds, since this computer cannot open it then.
   */
  masterWaiting: Accessor<boolean>;
  /**
   * This computer lost the key that opens what is sent to it: no master key and no device names reach
   * it until it is revoked from a device that holds the master key and linked again.
   */
  encMismatch: Accessor<boolean>;
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
  /**
   * Unlinks the device key `keyId`: it signs nothing new, and what it signed before stays valid.
   * Another device's key opens the custody window, where the master key signs it. This computer's own
   * key needs no master key: this only raises the confirm (`confirmingUnlink`) and answers
   * `'cancelled'`; `unlinkThisComputer` does it.
   */
  unlink: (keyId: string) => Promise<IdentityChangeOutcome>;
  /** The confirm for unlinking this computer is up. */
  confirmingUnlink: Accessor<boolean>;
  /**
   * That confirm also warns that the identity's other devices would have no master key to use: this
   * computer keeps it, and no other active device is recorded as keeping it or being sent it.
   */
  unlinkLeavesNoMaster: Accessor<boolean>;
  /** Unlinking this computer is running: the confirm stays up, and nothing else on the page should be pressed. */
  unlinking: Accessor<boolean>;
  /** Dismisses the confirm; nothing is unlinked. Does nothing once the unlink has been sent. */
  cancelUnlink: () => void;
  /**
   * Unlinks this computer: its key leaves the identity, signed by itself, and this computer is signed
   * out. The session's own identity and the identity are read again after, so they show the new
   * state. A refusal is said in `error` and answers `'failed'`; an answer that never came, or a
   * failure that may have come after the unlink was recorded, is said in `error` as one that may
   * have happened, answers `'uncertain'`, and the status is read again to show which. A second call
   * while one runs does nothing and answers `'cancelled'`.
   */
  unlinkThisComputer: () => Promise<UnlinkOutcome>;
  /**
   * Revokes the device key `keyId`, lost or stolen; the person says since when, where they unlock.
   * The window offers to replace the master key too.
   */
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
  const [confirmingUnlink, setConfirmingUnlink] = createSignal(false);
  const [unlinking, setUnlinking] = createSignal(false);

  // As in the identity store: a reply belongs to the port it was asked of and to the latest read.
  const reads = latest();
  createEffect(
    on(port, () => {
      reads.cancel();
      setRaw([]);
      setDevicesLoaded(false);
      setError('');
      setConfirmingUnlink(false);
    }),
  );

  async function refresh(): Promise<void> {
    const p = port();
    if (!p?.devices) return;
    const isLatest = reads.begin();
    const current = () => isLatest() && port() === p;
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
    // One change at a time: while this computer is being unlinked, the key log is moving under every other step.
    if (unlinking()) return 'cancelled';
    const outcome = await run();
    await refresh();
    return outcome;
  }

  const encMismatch = () => !!identity.custody()?.encMismatch;
  // The record's names cannot have been read here then: whatever came is not this computer's to show.
  const names = () => (encMismatch() ? [] : (identity.custody()?.devices ?? []));
  const rows = createMemo(() =>
    deviceRows(raw(), names(), identity.custody()?.endedHolders ?? [], lastRotation(identity.keyLog())),
  );
  // The words go to the custody service, which the `recoveryWords` capability says is here.
  const words = () => session.identityCapabilities().recoveryWords && identity.canChange();
  const linking = () => session.identityCapabilities().linkDevice && identity.canChange();
  const canManage = () => linking() && !!identity.did() && !!identity.custody()?.holdsMaster;
  const masterWaiting = () => !!identity.custody()?.masterWaiting && !encMismatch();
  // This computer keeps the master key and no other active device does (or is being sent it), so
  // once it leaves, nothing that is still linked could use that key. Read from the private record's
  // rows, as `master` is: what the record does not say is not guessed.
  const unlinkLeavesNoMaster = () =>
    !!identity.custody()?.holdsMaster &&
    !rows().some((d) => !d.thisDevice && !d.revoked && !d.unlinked && d.holdsMaster !== 'no');

  async function unlinkThisComputer(): Promise<UnlinkOutcome> {
    const p = port();
    if (!p) {
      setConfirmingUnlink(false);
      return 'failed';
    }
    if (unlinking()) return 'cancelled';
    setUnlinking(true);
    setError('');
    let outcome: UnlinkOutcome = 'done';
    let reason = '';
    try {
      await p.unlinkSelf();
    } catch (e) {
      outcome = e instanceof UnlinkUncertainError ? 'uncertain' : 'failed';
      reason = e instanceof Error ? e.message : String(e);
    }
    // The reads are the truth about what this computer is now; nothing is guessed here. The session
    // reads its own agent again too: the agent has a new DID, and the shell compares against it.
    // An unlink that may have happened is read again for the same reason, and the person tries again
    // from the row, which stays while the status still lists this computer.
    if (outcome !== 'failed') {
      await session.refreshMe();
      await identity.refresh();
      await refresh();
    }
    // After the reads, which clear `error` when they succeed: why it failed outlives them.
    if (reason) setError(reason);
    setUnlinking(false);
    setConfirmingUnlink(false);
    return outcome;
  }

  const store: DeviceStore = {
    devices: rows,
    devicesLoaded,
    validCount: () => rows().filter((d) => !d.revoked && !d.unlinked).length,
    canManage,
    canShowCode: () => linking() && identity.statusLoaded() && !identity.did() && !identity.custody()?.holdsMaster,
    canAskMaster: () =>
      linking() &&
      !!identity.did() &&
      !!identity.keyId() &&
      !identity.thisDeviceRevoked() &&
      !identity.thisDeviceUnlinked() &&
      !identity.custody()?.holdsMaster &&
      !masterWaiting() &&
      !encMismatch(),
    canReplaceMaster: () => words() && !!identity.did() && !!identity.keyId() && !identity.thisDeviceRevoked(),
    canRestore: () => words() && identity.statusLoaded() && !identity.did() && !identity.custody()?.holdsMaster,
    canRemoveMaster: () => linking() && !!identity.did() && !!identity.custody()?.holdsMaster,
    masterWaiting,
    encMismatch,
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
    unlink: async (keyId: string) => {
      if (rows().some((d) => d.keyId === keyId && d.thisDevice)) {
        // Not again while it runs: the confirm is already up, and one unlink is all there is.
        if (!unlinking()) setConfirmingUnlink(true);
        return 'cancelled';
      }
      return step(() => identity.open({ kind: 'unlink', keyId }));
    },
    confirmingUnlink,
    unlinkLeavesNoMaster,
    unlinking,
    cancelUnlink: () => {
      if (!unlinking()) setConfirmingUnlink(false);
    },
    unlinkThisComputer,
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
