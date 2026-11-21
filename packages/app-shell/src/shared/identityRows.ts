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
 */
import type { DeviceKeyView, DeviceNameView, DeviceRequestView, KeyLogEvent } from '@we/backend-shared';

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
  /** "Active", "Unlinked" or "Revoked". */
  status: string;
  /** Whether an unlink may be offered: a key still active that is not this computer's. */
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
export function keyLogRows(events: KeyLogEvent[], thisKeyId: string | null): KeyLogRow[] {
  const name = (id: string) => (id === thisKeyId ? THIS_COMPUTER.toLowerCase() : id);
  return events
    .slice()
    .sort((a, b) => b.seq - a.seq)
    .map((event) => {
      const keys = [...event.added.map((k) => k.id), ...event.unlinked, ...event.revoked];
      const thisComputer = !!thisKeyId && keys.includes(thisKeyId);
      const listed = (ids: string[]) =>
        ids.map((id) => (id === thisKeyId ? `${id} · ${THIS_COMPUTER}` : id)).join(', ');
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
  bot: 'robot',
};

const MASTER_WORDS = { yes: 'Has master key', offered: 'Master key sent', no: '' } as const;

/**
 * A revoked device's copy of the master key: a revoke does not replace the master key, so the copy
 * stays valid. Known from the record when it still lists the device; else the key log says the
 * device was let keep the master key (`IdentityCustodyView.revokedHolders`), not that it took it.
 */
const REVOKED_MASTER_WORDS = {
  held: 'Still has your master key. Replace it to lock this device out.',
  may: 'May still have your master key. Replace it to lock this device out.',
} as const;

/** What the private record calls `keyId`, or how the log alone would name it. */
export function deviceName(keyId: string, names: DeviceNameView[], thisKeyId: string | null = null): string {
  const named = names.find((n) => n.keyId === keyId)?.name;
  if (named) return named;
  return keyId === thisKeyId ? THIS_COMPUTER : keyId;
}

/** The device list: active keys first, this computer at the top, then in the order they were added. */
export function deviceRows(
  devices: DeviceKeyView[],
  names: DeviceNameView[] = [],
  revokedHolders: string[] = [],
): DeviceRow[] {
  const ended = (d: DeviceKeyView) => Number(d.revokedSeq !== null || d.unlinkedSeq !== null);
  return devices
    .slice()
    .sort((a, b) => ended(a) - ended(b) || Number(b.thisDevice) - Number(a.thisDevice) || a.addedSeq - b.addedSeq)
    .map((device) => {
      const revoked = device.revokedSeq !== null;
      const unlinked = device.unlinkedSeq !== null;
      const record = names.find((n) => n.keyId === device.keyId);
      const name = record?.name ?? '';
      const listed = record?.holdsMaster ?? 'no';
      // A revoked key keeps nothing it can use as a device; a copy of the master key it took stays
      // valid, and its row says so in a warning (`holdsMaster` is `no`, so the badge's tone warns).
      const holdsMaster = revoked ? 'no' : listed;
      const revokedMaster = !revoked
        ? ''
        : listed !== 'no'
          ? REVOKED_MASTER_WORDS.held
          : revokedHolders.includes(device.keyId)
            ? REVOKED_MASTER_WORDS.may
            : '';
      const fallback = device.thisDevice ? THIS_COMPUTER : `Device ${device.keyId}`;
      return {
        keyId: device.keyId,
        addedSeq: device.addedSeq,
        unlinkedSeq: device.unlinkedSeq,
        revokedSeq: device.revokedSeq,
        label: name || fallback,
        subtitle: [
          ...(name && device.thisDevice ? [THIS_COMPUTER] : []),
          device.keyId,
          `added at #${device.addedSeq}`,
        ].join(' · '),
        icon: (record && DEVICE_ICONS[record.kind]) || (device.thisDevice ? 'laptop' : 'key'),
        thisDevice: device.thisDevice,
        unlinked,
        revoked,
        status: revoked ? 'Revoked' : unlinked ? 'Unlinked' : 'Active',
        canUnlink: !revoked && !unlinked && !device.thisDevice,
        canRevoke: !revoked && !device.thisDevice,
        name,
        holdsMaster,
        master: revokedMaster || MASTER_WORDS[holdsMaster],
      };
    });
}

/** The requests of other devices, each named by the device that asked. */
export function requestRows(
  requests: DeviceRequestView[],
  names: DeviceNameView[],
  thisKeyId: string | null = null,
): RequestRow[] {
  return requests.map((request) => {
    const device = deviceName(request.by, names, thisKeyId);
    if (request.kind === 'send-master') {
      return {
        id: request.id,
        kind: request.kind,
        title: `${device} asks for the master key`,
        detail: 'It could then add and remove devices.',
      };
    }
    const keys = request.keyIds.map((k) => deviceName(k, names, thisKeyId)).join(', ');
    return {
      id: request.id,
      kind: request.kind,
      title: `${device} asks to remove ${keys}`,
      // A revoke ends the device key; a copy of the master key stays valid until it is replaced.
      detail: 'Their device keys stop working. A device with your master key keeps access until you replace it.',
    };
  });
}
