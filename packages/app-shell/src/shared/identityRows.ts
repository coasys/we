/**
 * The key log and the device list, in the words Settings draws.
 *
 * Kept apart from the stores so the wording is tested without mounting anything, and because a
 * schema cannot format: what a row says by default is decided here, once. Each row also carries what
 * the words were made from (`op`, `keys`, the seqs), so a template that wants to say it differently
 * can, without parsing a sentence.
 *
 * There is no private record of the person's devices yet, so a device has no name and no kind: the
 * log lists keys. This
 * computer's own key is named "This computer"; every other one by its id in the log (`d2`), which is
 * what the person sees in the log too.
 */
import type { DeviceKeyView, KeyLogEvent } from '@we/backend-shared';

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
  /** "Created identity", "Added d2", "Revoked d2". */
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
  /** "Active", or "Removed at #2". */
  status: string;
  /** Whether a revoke may be offered: a valid key that is not this computer's. */
  canRevoke: boolean;
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
          title = 'Created identity';
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

/** The device list: valid keys first, this computer at the top, then in the order they were added. */
export function deviceRows(devices: DeviceKeyView[]): DeviceRow[] {
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
      return {
        keyId: device.keyId,
        addedSeq: device.addedSeq,
        revokedSeq: device.revokedSeq,
        label: device.thisDevice ? THIS_COMPUTER : `Device ${device.keyId}`,
        subtitle: `${device.keyId} · added at #${device.addedSeq}`,
        // What kind of device a key is on will come with a private record of devices, not made yet.
        icon: device.thisDevice ? 'laptop' : 'key',
        thisDevice: device.thisDevice,
        revoked,
        status: revoked ? `Removed at #${device.revokedSeq}` : 'Active',
        canRevoke: !revoked && !device.thisDevice,
      };
    });
}
