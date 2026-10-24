/**
 * The identity port over AD4M's `identity.*` calls (identity slice 1, AR-01 4.10, AR-02 4.15).
 *
 * Reads only. The executor holds this computer's device key and a cache of the person's key log,
 * which it has checked event by event (`fold`) before answering; it never holds the master key, so
 * nothing here can change the identity. Making one, adding a device and revoking one are signed by
 * the master key in the desktop shell's custody service, which calls the executor itself.
 *
 * An executor that predates the identity calls answers `Unknown type`: the capabilities then stay
 * off, Settings keeps drawing "Coming soon", and the refusal is recorded like any other missing
 * method rather than thrown at whoever asked.
 */
import type { Ad4mClient } from '@coasys/ad4m';
import {
  type DeviceKeyView,
  type IdentityCapabilities,
  type IdentityPort,
  type IdentityStatusView,
  type KeyLogHead,
  type KeyLogView,
  NO_IDENTITY_CAPABILITIES,
  readKeyLogEvent,
} from '@we/backend-shared';

import { recordMissingMethod } from './missingMethods';

/** The slice of the SDK client this port uses — the whole of it, so a test can stand one in. */
export interface IdentityClientLike {
  identity: {
    status(): Promise<unknown>;
    log(did: string, from?: number, fresh?: boolean): Promise<unknown>;
    devices(): Promise<unknown>;
  };
  on?: (type: 'identity-fork', handler: (event: unknown) => void) => () => void;
}

type Raw = Record<string, unknown>;

const record = (value: unknown): Raw => (value && typeof value === 'object' ? (value as Raw) : {});
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number | null => (typeof value === 'number' ? value : null);

function readHead(value: unknown): KeyLogHead | null {
  if (!value || typeof value !== 'object') return null;
  const head = value as Raw;
  return {
    seq: count(head.seq) ?? 0,
    hash: text(head.hash) ?? '',
    time: count(head.time) ?? 0,
    store: text(head.store) ?? '',
  };
}

function readFork(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const fork = value as Raw;
  return { seq: count(fork.seq) ?? 0, ours: text(fork.ours) ?? '', theirs: text(fork.theirs) ?? '' };
}

export function readIdentityStatus(value: unknown): IdentityStatusView {
  const status = record(value);
  return {
    did: text(status.did),
    deviceKey: text(status.deviceKey) ?? '',
    keyId: text(status.keyId),
    revoked: count(status.revoked),
    head: readHead(status.head),
    fork: readFork(status.fork),
  };
}

/**
 * A log as the executor serves it. Each event's hash is the next event's `prev`, and the last one's
 * is the head's: the events carry their predecessor's hash, never their own.
 */
export function readKeyLog(value: unknown): KeyLogView {
  const log = record(value);
  const raw = Array.isArray(log.events) ? log.events : [];
  const head = readHead(log.head);
  const events = raw.map((event, i) => {
    const next = raw[i + 1];
    const hash = next ? text(record(next).prev) : head && head.seq === record(event).seq ? head.hash : null;
    return readKeyLogEvent(event, hash);
  });
  return { did: text(log.did) ?? '', events, head, fork: readFork(log.fork) };
}

export function readDevices(value: unknown): DeviceKeyView[] {
  return (Array.isArray(value) ? value : []).map((item) => {
    const device = record(item);
    return {
      keyId: text(device.keyId) ?? '',
      sign: text(device.sign) ?? '',
      thisDevice: device.thisDevice === true,
      addedSeq: count(device.addedSeq) ?? 0,
      revokedSeq: count(device.revokedSeq),
    };
  });
}

export function createAd4mIdentityPort(backendClient: unknown): IdentityPort {
  const client = backendClient as IdentityClientLike & Partial<Ad4mClient>;

  return {
    async capabilities(): Promise<IdentityCapabilities> {
      try {
        await client.identity.status();
      } catch (error) {
        recordMissingMethod(error);
        return NO_IDENTITY_CAPABILITIES;
      }
      // The log and the device list come from the executor. Changing either needs the master key,
      // which only an app's custody holds: that half is the host's (`PlatformAdapter.identity`).
      return { ...NO_IDENTITY_CAPABILITIES, keyLog: true, devices: true };
    },

    async status() {
      return readIdentityStatus(await client.identity.status());
    },

    async log(did: string) {
      // `fresh`: refresh from the store first, so a change made on another device shows here.
      return readKeyLog(await client.identity.log(did, 0, true));
    },

    async devices() {
      return readDevices(await client.identity.devices());
    },

    onFork(listener) {
      if (!client.on) return () => {};
      return client.on('identity-fork', (event) => {
        const fork = readFork(event);
        if (fork) listener(fork);
      });
    },
  };
}
