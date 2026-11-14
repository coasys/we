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
  /** `incept`, `add`, `revoke`, `rotate`, or whatever a later format adds. */
  op: string;
  /** The key ids the event adds or revokes. */
  keys: string[];
  /** "#0" */
  position: string;
  /** A Phosphor icon name. */
  icon: string;
  /** "Created your identity", "Added d2", "Revoked d2". */
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
  /** The seq of the event that revoked it, or `null` while it is valid. */
  revokedSeq: number | null;
  /** "This computer", or "Device d2". */
  label: string;
  /** "d1 · added at #0" */
  subtitle: string;
  icon: string;
  thisDevice: boolean;
  revoked: boolean;
  /** Neither revoked nor past the end the key log gives it. */
  valid: boolean;
  /** "Valid", "Removed at #2", or "Expired on 3 Dec 2026". */
  status: string;
  /** Whether a revoke may be offered: a valid key that is not this computer's. */
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

/**
 * A device nobody has named yet. Never its key id: an identifier is for the key log and the identity
 * window's checks, not for the rows a person reads every day.
 */
export const UNNAMED_DEVICE = 'Unnamed device';

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
  const name = (id: string) => (id === thisKeyId ? thisLabel : id);
  return events
    .slice()
    .sort((a, b) => b.seq - a.seq)
    .map((event) => {
      const keys = [...event.added.map((k) => k.id), ...event.revoked];
      const thisComputer = !!thisKeyId && keys.includes(thisKeyId);
      const listed = (ids: string[]) => ids.map((id) => (id === thisKeyId ? `${id} · ${thisLabel}` : id)).join(', ');
      let icon = 'circle';
      let title = `${event.op.charAt(0).toUpperCase()}${event.op.slice(1)}`;
      let detail = listed(keys);
      switch (event.op) {
        case 'incept':
          icon = 'sparkle';
          title = 'Created your identity';
          detail = event.added.length ? `with ${listed(event.added.map((k) => k.id))}` : '';
          break;
        case 'add':
          icon = 'plus-circle';
          title = `Added ${event.added.map((k) => name(k.id)).join(', ')}`;
          detail = listed(event.added.map((k) => k.id));
          break;
        case 'revoke':
          icon = 'prohibit';
          title = `Revoked ${event.revoked.map(name).join(', ')}`;
          detail = listed(event.revoked);
          break;
        case 'rotate':
          icon = 'arrows-clockwise';
          title = 'Replaced the master key';
          detail = 'with your 12 words';
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

/** The device list: valid keys first, this computer at the top, then in the order they were added. */
export const DEVICE_ICONS: Record<string, string> = {
  'desktop-app': 'laptop',
  'phone-app': 'device-mobile',
  browser: 'browser',
  server: 'hard-drives',
  'community-host': 'hard-drives',
  // No `bot`: a key the record calls a bot but the key log does not is drawn as the device it is.
};

const MASTER_WORDS = { yes: 'Has master key', offered: 'Master key sent', no: '' } as const;

/**
 * A revoked device's copy of the master key: a revoke does not replace the master key, so the copy
 * stays valid. Known from the record when it still lists the device; else the key log says the
 * device was let keep the master key (`IdentityCustodyView.revokedHolders`), not that it took it.
 * A rotation at or after the revoke replaced the master key, so the copy no longer counts.
 */
const REVOKED_MASTER_WORDS = {
  held: 'Still has your master key. Replace it to lock this device out.',
  may: 'May still have your master key. Replace it to lock this device out.',
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
 * The person's devices. A bot's key is in the same key log but is not a device: it is left out here
 * and managed under Bots. Only the key log's bot mark (`DeviceKeyView.bot`) says so, never the
 * private record's `kind`, which is a label the person chose. `now` is unix seconds.
 */
export function deviceRows(
  devices: DeviceKeyView[],
  names: DeviceNameView[] = [],
  revokedHolders: string[] = [],
  /** The seq of the key log's last rotation, or `null` when the master key was never replaced. */
  masterReplacedSeq: number | null = null,
  now: number = Math.floor(Date.now() / 1000),
  /**
   * The device the custody service answers for ({@link custodyDevice}): its key, not the one the
   * backend marks, is this device. `null` leaves the backend's mark.
   */
  here: CustodyDevice | null = null,
): DeviceRow[] {
  const ended = (device: DeviceKeyView) => device.expires != null && device.expires <= now;
  const thisLabel = here?.label ?? THIS_COMPUTER;
  const thisIcon = here?.icon ?? 'laptop';
  return devices
    .filter((device) => !device.bot)
    .map((device) => (here ? { ...device, thisDevice: here.keyId !== null && device.keyId === here.keyId } : device))
    .sort(
      (a, b) =>
        Number(a.revokedSeq !== null || ended(a)) - Number(b.revokedSeq !== null || ended(b)) ||
        Number(b.thisDevice) - Number(a.thisDevice) ||
        a.addedSeq - b.addedSeq,
    )
    .map((device) => {
      const revoked = device.revokedSeq !== null;
      const expired = !revoked && ended(device);
      const record = names.find((n) => n.keyId === device.keyId);
      const name = record?.name ?? '';
      const listed = record?.holdsMaster ?? 'no';
      // A revoked key keeps nothing it can use as a device; a copy of the master key it took stays
      // valid, and its row says so in a warning (`holdsMaster` is `no`, so the badge's tone warns).
      const holdsMaster = revoked ? 'no' : listed;
      const replacedSince = revoked && masterReplacedSeq !== null && (device.revokedSeq as number) <= masterReplacedSeq;
      const revokedMaster =
        !revoked || replacedSince
          ? ''
          : listed !== 'no'
            ? REVOKED_MASTER_WORDS.held
            : revokedHolders.includes(device.keyId)
              ? REVOKED_MASTER_WORDS.may
              : '';
      const fallback = device.thisDevice ? thisLabel : UNNAMED_DEVICE;
      return {
        keyId: device.keyId,
        addedSeq: device.addedSeq,
        revokedSeq: device.revokedSeq,
        label: name || fallback,
        // Where it is in the key log, not its key id (the key log lists that).
        subtitle: [...(name && device.thisDevice ? [thisLabel] : []), `added at #${device.addedSeq}`].join(' · '),
        icon: (record && DEVICE_ICONS[record.kind]) || (device.thisDevice ? thisIcon : 'key'),
        thisDevice: device.thisDevice,
        revoked,
        valid: !revoked && !expired,
        status: revoked
          ? `Removed at #${device.revokedSeq}`
          : expired
            ? `Expired on ${dateOf(device.expires as number)}`
            : 'Valid',
        // Ending an expired key for good is still the key log's to record.
        canRevoke: !revoked && !device.thisDevice,
        name,
        holdsMaster,
        master: revokedMaster || MASTER_WORDS[holdsMaster],
        replaceMaster: revokedMaster !== '',
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
      detail: 'Removed devices lose access to your identity.',
    };
  });
}
