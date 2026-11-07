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
  /** "Valid", or "Revoked at #2". */
  status: string;
  /** Whether a revoke may be offered: a valid key that is not this computer's. */
  canRevoke: boolean;
  /** The name the private record gives it, or empty. */
  name: string;
  /** Whether it keeps the master key: yes, no, or sent and not yet taken. */
  holdsMaster: 'yes' | 'no' | 'offered';
  /**
   * "Holds the master key", "Master key offered, not yet taken", or empty; for a revoked device that
   * took (or the key log let take) the master key, a warning that its copy is still valid.
   */
  master: string;
}

/** One request of another device, waiting for an answer. */
export interface RequestRow {
  id: string;
  kind: DeviceRequestView['kind'];
  /** "Laptop asks for the master key", "Laptop asks to revoke d3". */
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
  const name = (id: string) => (id === thisKeyId ? THIS_COMPUTER : id);
  return events
    .slice()
    .sort((a, b) => b.seq - a.seq)
    .map((event) => {
      const keys = [...event.added.map((k) => k.id), ...event.revoked];
      const thisComputer = !!thisKeyId && keys.includes(thisKeyId);
      const listed = (ids: string[]) =>
        ids.map((id) => (id === thisKeyId ? `${id} · ${THIS_COMPUTER}` : id)).join(', ');
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
const DEVICE_ICONS: Record<string, string> = {
  'desktop-app': 'laptop',
  'phone-app': 'device-mobile',
  browser: 'browser',
  server: 'hard-drives',
  'community-host': 'hard-drives',
  bot: 'robot',
};

const MASTER_WORDS = { yes: 'Holds the master key', offered: 'Master key offered, not yet taken', no: '' } as const;

/**
 * A revoked device's copy of the master key: a revoke does not replace the master key, so the copy
 * stays valid. Known from the record when it still lists the device; else the key log says the
 * device was let keep the master key (`IdentityCustodyView.revokedHolders`), not that it took it.
 */
const REVOKED_MASTER_WORDS = {
  held: 'Still holds a valid master key — replace your master key',
  may: 'May still hold a valid master key — replace your master key',
} as const;

/** What the private record calls `keyId`, or how the log alone would name it. */
export function deviceName(keyId: string, names: DeviceNameView[], thisKeyId: string | null = null): string {
  const named = names.find((n) => n.keyId === keyId)?.name;
  if (named) return named;
  return keyId === thisKeyId ? THIS_COMPUTER : keyId;
}

export function deviceRows(
  devices: DeviceKeyView[],
  names: DeviceNameView[] = [],
  revokedHolders: string[] = [],
): DeviceRow[] {
  return devices
    .slice()
    .sort(
      (a, b) =>
        Number(a.revokedSeq !== null) - Number(b.revokedSeq !== null) ||
        Number(b.thisDevice) - Number(a.thisDevice) ||
        a.addedSeq - b.addedSeq,
    )
    .map((device) => {
      const revoked = device.revokedSeq !== null;
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
        revokedSeq: device.revokedSeq,
        label: name || fallback,
        subtitle: [
          ...(name && device.thisDevice ? [THIS_COMPUTER] : []),
          device.keyId,
          `added at #${device.addedSeq}`,
        ].join(' · '),
        icon: (record && DEVICE_ICONS[record.kind]) || (device.thisDevice ? 'laptop' : 'key'),
        thisDevice: device.thisDevice,
        revoked,
        status: revoked ? `Revoked at #${device.revokedSeq}` : 'Valid',
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
        detail: 'With it, that device can add and remove your devices too.',
      };
    }
    const keys = request.keyIds.map((k) => deviceName(k, names, thisKeyId)).join(', ');
    return {
      id: request.id,
      kind: request.kind,
      title: `${device} asks to revoke ${keys}`,
      detail: 'Each revoked device stops acting as you.',
    };
  });
}
