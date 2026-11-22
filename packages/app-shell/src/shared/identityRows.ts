/**
 * The key log and the device list, in the words Settings draws.
 *
 * Kept apart from the stores so the wording is tested without mounting anything, and because a
 * schema cannot format: what a row says by default is decided here, once. Each row also carries what
 * the words were made from (`op`, `keys`, the seqs), so a template that wants to say it differently
 * can, without parsing a sentence.
 *
 * The log lists keys, not names. The names, the kinds and who keeps the master key are in the
 * identity's private record, which only its devices read (`IdentityCustodyView.devices`). A key the
 * record does not name is "This computer" when it is this computer's, otherwise its id in the log
 * (`d2`), which is what the person sees in the log too.
 *
 * Which key is this device's is the backend's to say (`DeviceKeyView.thisDevice`), except where the
 * custody service answers for a device of its own (`IdentityCustodyView.thisDevice`): a phone that
 * reaches a computer's executor is "This phone", and the computer is one more device.
 */
import type {
  DeviceKeyView,
  DeviceNameView,
  DeviceRequestView,
  IdentityCustodyView,
  KeyLogEvent,
} from '@we/backend-shared';

/** One row of Security → Key log. */
export interface KeyLogRow {
  seq: number;
  /** `incept`, `add`, `unlink`, `revoke`, `rotate`, or whatever a later format adds. */
  op: string;
  /** The key ids the event adds, unlinks or revokes. */
  keys: string[];
  /** "#0" */
  position: string;
  /** A Phosphor icon name. */
  icon: string;
  /** "Created identity", "Added d2", "Unlinked d2", "Revoked d2". */
  title: string;
  /** The keys the event names, "d1 · This computer". */
  detail: string;
  /** The event's hash, shortened for the eye: "QmZk…7rWd". Empty where the backend gave none. */
  hashShort: string;
  hash: string;
  /** Whether the event names this computer's key. */
  thisComputer: boolean;
}

/** One row of Devices. */
export interface DeviceRow {
  keyId: string;
  /** The seq of the event that added it. */
  addedSeq: number;
  /** The seq of the event that unlinked it, or `null` while it is not. */
  unlinkedSeq: number | null;
  /** The seq of the event that revoked it, or `null` while it is valid. */
  revokedSeq: number | null;
  /** "This computer", or "Device d2". */
  label: string;
  /** "d1 · added at #0" */
  subtitle: string;
  icon: string;
  thisDevice: boolean;
  /** Unlinked: it signs nothing new, and what it signed before stays valid. */
  unlinked: boolean;
  revoked: boolean;
  /** Neither revoked, unlinked nor past the end the key log gives it. */
  valid: boolean;
  /** "Active", "Unlinked", "Revoked", or "Expired on 3 Dec 2026". */
  status: string;
  /**
   * Whether an unlink may be offered: a key still active. This computer's own may leave too, without
   * the master key (`identity.unlinkSelf`); it is then signed out. Not a phone's own row: the executor's
   * `unlinkSelf` retires the executor's key, so there the phone's unlink is the custody window's.
   */
  canUnlink: boolean;
  /** Whether a revoke may be offered: a key not yet revoked, unlinked or not, that is not this computer's. */
  canRevoke: boolean;
  /** The name the private record gives it, or empty. */
  name: string;
  /** Whether it keeps the master key: yes, no, or sent and not yet taken. */
  holdsMaster: 'yes' | 'no' | 'offered';
  /**
   * "Has master key", "Master key sent", or empty; for a revoked device that
   * took (or the key log let take) the master key, a warning that its copy is still valid.
   */
  master: string;
  /** Whether its row leads to "Replace master key": a revoked device whose copy is still valid. */
  replaceMaster: boolean;
}

/** One request of another device, waiting for an answer. */
export interface RequestRow {
  id: string;
  kind: DeviceRequestView['kind'];
  /** "Laptop asks for the master key", "Laptop asks to remove d3". */
  title: string;
  /** What answering yes does. */
  detail: string;
}

export const THIS_COMPUTER = 'This computer';
export const THIS_PHONE = 'This phone';

/** The device the custody service answers for, where it is not the backend's: its key and name. */
export interface CustodyDevice {
  /** Its id in the key log; `null` before the log lists it, when no key is this device's. */
  keyId: string | null;
  /** "This phone". */
  label: string;
  /** What its row shows when the record gives no kind. */
  icon: string;
}

/**
 * The device the custody service answers for, named; `null` where the custody service runs beside
 * the backend (the desktop), whose own key the backend marks.
 */
export function custodyDevice(custody: IdentityCustodyView | null | undefined): CustodyDevice | null {
  const device = custody?.thisDevice;
  if (!device) return null;
  const phone = device.kind === 'phone-app';
  return {
    keyId: device.keyId,
    label: phone ? THIS_PHONE : THIS_COMPUTER,
    icon: DEVICE_ICONS[device.kind] ?? 'laptop',
  };
}

/**
 * What this device is, for the sentences about it: "phone" where the custody service answers for a
 * phone, "computer" on the desktop — "No master key on this phone".
 */
export function deviceNoun(here: CustodyDevice | null): 'phone' | 'computer' {
  return here?.label === THIS_PHONE ? 'phone' : 'computer';
}

/** "QmZkabc…xyz7rWd" → "QmZk…7rWd". */
export function shortHash(hash: string | null | undefined): string {
  if (!hash) return '';
  return hash.length <= 12 ? hash : `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}

/** "did:scid:coasys:1:QmLong…" → "did:scid:coasys:1:QmLo…Long", for a line that has no room. */
export function shortDid(did: string | null | undefined): string {
  if (!did) return '';
  const at = did.lastIndexOf(':');
  return at < 0 ? did : `${did.slice(0, at + 1)}${shortHash(did.slice(at + 1))}`;
}

/** The log's rows, newest first, as the design orders them. */
export function keyLogRows(
  events: KeyLogEvent[],
  thisKeyId: string | null,
  /** What this device is called: "This phone" on a phone ({@link custodyDevice}). */
  thisLabel: string = THIS_COMPUTER,
): KeyLogRow[] {
  const name = (id: string) => (id === thisKeyId ? thisLabel.toLowerCase() : id);
  return events
    .slice()
    .sort((a, b) => b.seq - a.seq)
    .map((event) => {
      const keys = [...event.added.map((k) => k.id), ...event.unlinked, ...event.revoked];
      const thisComputer = !!thisKeyId && keys.includes(thisKeyId);
      const listed = (ids: string[]) => ids.map((id) => (id === thisKeyId ? `${id} · ${thisLabel}` : id)).join(', ');
      let icon = 'circle';
      let title = `${event.op.charAt(0).toUpperCase()}${event.op.slice(1)}`;
      let detail = listed(keys);
      switch (event.op) {
        case 'incept':
          icon = 'sparkle';
          title = 'Created identity';
          detail = event.added.length ? `with ${listed(event.added.map((k) => k.id))}` : '';
          break;
        case 'add':
          icon = 'plus-circle';
          title = `Added ${event.added.map((k) => name(k.id)).join(', ')}`;
          detail = listed(event.added.map((k) => k.id));
          break;
        case 'unlink':
          icon = 'link-break';
          title = `Unlinked ${event.unlinked.map(name).join(', ')}`;
          detail = listed(event.unlinked);
          break;
        case 'revoke':
          icon = 'prohibit';
          title = `Revoked ${event.revoked.map(name).join(', ')}`;
          detail = listed(event.revoked);
          break;
        case 'rotate':
          icon = 'arrows-clockwise';
          title = 'Replaced the master key';
          detail = 'with your recovery phrase';
          break;
      }
      return {
        seq: event.seq,
        op: event.op,
        keys,
        position: `#${event.seq}`,
        icon,
        title,
        detail,
        hash: event.hash ?? '',
        hashShort: shortHash(event.hash),
        thisComputer,
      };
    });
}

const DEVICE_ICONS: Record<string, string> = {
  'desktop-app': 'laptop',
  'phone-app': 'device-mobile',
  browser: 'browser',
  server: 'hard-drives',
  'community-host': 'hard-drives',
  // No `bot`: a key the record calls a bot but the key log does not is drawn as the device it is.
};

const MASTER_WORDS = { yes: 'Has master key', offered: 'Master key sent', no: '' } as const;

/**
 * A revoked or unlinked device's copy of the master key: neither a revoke nor an unlink replaces the
 * master key, so the copy stays valid. Known from the record when it still lists the device; else
 * the key log says the device was let keep the master key (`IdentityCustodyView.endedHolders`), not
 * that it took it. A revoked device is lost or stolen; an unlinked one the person may still have.
 * A rotation at or after the key ended replaced the master key, so the copy no longer counts.
 */
const ENDED_MASTER_WORDS = {
  revoked: {
    held: 'Still has your master key. Replace it to lock this device out.',
    may: 'May still have your master key. Replace it to lock this device out.',
  },
  unlinked: {
    held: "Still has your master key. Replace it if you don't have this device any more.",
    may: "May still have your master key. Replace it if you don't have this device any more.",
  },
} as const;

/** What the private record calls `keyId`, or how the log alone would name it. */
export function deviceName(
  keyId: string,
  names: DeviceNameView[],
  thisKeyId: string | null = null,
  thisLabel: string = THIS_COMPUTER,
): string {
  const named = names.find((n) => n.keyId === keyId)?.name;
  if (named) return named;
  return keyId === thisKeyId ? thisLabel : keyId;
}

/**
 * The person's devices: active keys first, this computer at the top, then in the order they were
 * added. A bot's key is in the same key log but is not a device: it is left out here and managed
 * under Bots. Only the key log's bot mark (`DeviceKeyView.bot`) says so, never the private record's
 * `kind`, which is a label the person chose. `now` is unix seconds.
 */
export function deviceRows(
  devices: DeviceKeyView[],
  names: DeviceNameView[] = [],
  endedHolders: string[] = [],
  /** The seq of the key log's last rotation, or `null` when the master key was never replaced. */
  masterReplacedSeq: number | null = null,
  now: number = Math.floor(Date.now() / 1000),
  /**
   * The device the custody service answers for ({@link custodyDevice}): its key, not the one the
   * backend marks, is this device. `null` leaves the backend's mark.
   */
  here: CustodyDevice | null = null,
): DeviceRow[] {
  const expiredAt = (device: DeviceKeyView) => device.expires != null && device.expires <= now;
  const ended = (d: DeviceKeyView) => Number(d.revokedSeq !== null || d.unlinkedSeq !== null || expiredAt(d));
  const thisLabel = here?.label ?? THIS_COMPUTER;
  const thisIcon = here?.icon ?? 'laptop';
  return devices
    .filter((device) => !device.bot)
    .map((device) => (here ? { ...device, thisDevice: here.keyId !== null && device.keyId === here.keyId } : device))
    .sort((a, b) => ended(a) - ended(b) || Number(b.thisDevice) - Number(a.thisDevice) || a.addedSeq - b.addedSeq)
    .map((device) => {
      const revoked = device.revokedSeq !== null;
      const unlinked = device.unlinkedSeq !== null;
      const expired = !revoked && !unlinked && expiredAt(device);
      const record = names.find((n) => n.keyId === device.keyId);
      const name = record?.name ?? '';
      const listed = record?.holdsMaster ?? 'no';
      // A revoked or unlinked key keeps nothing it can use as a device; a copy of the master key it
      // took stays valid, and its row says so in a warning (`holdsMaster` is `no`, so the badge's
      // tone warns).
      const words = revoked ? ENDED_MASTER_WORDS.revoked : unlinked ? ENDED_MASTER_WORDS.unlinked : null;
      const holdsMaster = words ? 'no' : listed;
      const endedSeq = Math.min(device.unlinkedSeq ?? Infinity, device.revokedSeq ?? Infinity);
      const replacedSince = masterReplacedSeq !== null && endedSeq <= masterReplacedSeq;
      const endedMaster =
        !words || replacedSince
          ? ''
          : listed !== 'no'
            ? words.held
            : endedHolders.includes(device.keyId)
              ? words.may
              : '';
      const fallback = device.thisDevice ? thisLabel : `Device ${device.keyId}`;
      return {
        keyId: device.keyId,
        addedSeq: device.addedSeq,
        unlinkedSeq: device.unlinkedSeq,
        revokedSeq: device.revokedSeq,
        label: name || fallback,
        subtitle: [
          ...(name && device.thisDevice ? [thisLabel] : []),
          device.keyId,
          `added at #${device.addedSeq}`,
        ].join(' · '),
        icon: (record && DEVICE_ICONS[record.kind]) || (device.thisDevice ? thisIcon : 'key'),
        thisDevice: device.thisDevice,
        unlinked,
        revoked,
        valid: !revoked && !unlinked && !expired,
        status: revoked
          ? 'Revoked'
          : unlinked
            ? 'Unlinked'
            : expired
              ? `Expired on ${dateOf(device.expires as number)}`
              : 'Active',
        // Ending an expired key for good is still the key log's to record; this computer's own row
        // can end itself too (`deviceStore.unlinkThisComputer`) — except a phone's: `identity.unlinkSelf`
        // unlinks the key of the executor the phone reaches, not the phone's own, so no phone row offers it.
        canUnlink: !revoked && !unlinked && !(here && device.thisDevice),
        canRevoke: !revoked && !device.thisDevice,
        name,
        holdsMaster,
        master: endedMaster || MASTER_WORDS[holdsMaster],
        replaceMaster: endedMaster !== '',
      };
    });
}

/** The device serving this session: the top card of Settings → Devices. */
export interface ServingDevice {
  /** "This computer" on the desktop; on a phone the host's name from the record, else "Your host". */
  label: string;
  subtitle: string;
  icon: string;
}

export const YOUR_HOST = 'Your host';
const IN_USE = 'In use';

/**
 * The device serving this session. On the desktop it is this computer. Where the custody service
 * answers for a device apart from the backend (`here`, a phone), the session is served by the
 * executor the phone signs in to: the key the backend marks as its own, named and drawn from the
 * private record when the record has it.
 */
export function servingDevice(
  devices: DeviceKeyView[],
  names: DeviceNameView[] = [],
  here: CustodyDevice | null = null,
): ServingDevice {
  if (!here) return { label: THIS_COMPUTER, subtitle: IN_USE, icon: 'desktop' };
  const host = devices.find((device) => device.thisDevice && !device.bot);
  const record = host ? names.find((n) => n.keyId === host.keyId) : undefined;
  const name = record?.name ?? '';
  return {
    label: name || YOUR_HOST,
    subtitle: name ? `${YOUR_HOST} · ${IN_USE}` : IN_USE,
    icon: (record && DEVICE_ICONS[record.kind]) || 'hard-drives',
  };
}

/** A date as the device list shows it, in the person's own locale. */
function dateOf(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** The seq of the last rotation in `events`, or `null` when the master key was never replaced. */
export function lastRotation(events: { seq: number; op: string }[]): number | null {
  return events.reduce<number | null>(
    (last, e) => (e.op === 'rotate' && (last === null || e.seq > last) ? e.seq : last),
    null,
  );
}

/** The requests of other devices, each named by the device that asked. */
export function requestRows(
  requests: DeviceRequestView[],
  names: DeviceNameView[],
  thisKeyId: string | null = null,
  thisLabel: string = THIS_COMPUTER,
): RequestRow[] {
  return requests.map((request) => {
    const device = deviceName(request.by, names, thisKeyId, thisLabel);
    if (request.kind === 'send-master') {
      return {
        id: request.id,
        kind: request.kind,
        title: `${device} asks for the master key`,
        detail: 'It could then add and remove devices.',
      };
    }
    const keys = request.keyIds.map((k) => deviceName(k, names, thisKeyId, thisLabel)).join(', ');
    return {
      id: request.id,
      kind: request.kind,
      title: `${device} asks to remove ${keys}`,
      // A revoke ends the device key; a copy of the master key stays valid until it is replaced.
      detail: 'Their device keys stop working. A device with your master key keeps access until you replace it.',
    };
  });
}
