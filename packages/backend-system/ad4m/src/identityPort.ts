/**
 * The identity port over AD4M's `identity.*` calls, and over the custody service where a host runs one.
 *
 * The reads are the executor's. It holds this computer's device key and a cache of the person's key
 * log, which it has checked event by event (`fold`) before answering; it never holds the master key.
 *
 * The changes are the custody service's. AD4M leaves the master key to an app: on the desktop it is
 * the `we-custody` sidecar (`crates/custody`), which keeps the key behind the OS unlock, runs each
 * change in a window of its own and calls the executor itself. The host hands this port a
 * {@link Ad4mCustodyHost} through the connector, so the shell above sees one neutral port and never
 * learns that a custody service, a sidecar or an executor exist. A host without one passes nothing,
 * and the port then offers reads only.
 *
 * An executor that predates the identity calls answers `Unknown type`: the capabilities then stay
 * off, Settings keeps drawing "Coming soon", and the refusal is recorded like any other missing
 * method rather than thrown at whoever asked.
 */
import type { Ad4mClient } from '@coasys/ad4m';
import {
  type DeviceKeyView,
  type DeviceRequestView,
  type IdentityCapabilities,
  type IdentityChange,
  type IdentityChangeOutcome,
  type IdentityCustodyView,
  type IdentityPort,
  type IdentityStatusView,
  type KeyLogEvent,
  type KeyLogHead,
  type KeyLogStoreBehind,
  type KeyLogView,
  NO_IDENTITY_CAPABILITIES,
} from '@we/backend-shared';

import { type BotClientLike, createAd4mBotPort } from './botPort';
import { recordMissingMethod } from './missingMethods';

/** The slice of the SDK client this port uses — the whole of it, so a test can stand one in. */
export interface IdentityClientLike {
  identity: {
    status(): Promise<unknown>;
    log(did: string, from?: number, fresh?: boolean): Promise<unknown>;
    devices(): Promise<unknown>;
  };
  on?: (type: 'identity-fork', handler: (event: unknown) => void) => () => void;
  /** `bot.*`: absent on an SDK that predates bots. */
  bot?: BotClientLike;
}

/**
 * The custody service as a desktop host reaches it: open a change in its own window, and read its
 * public state. What crosses here is a change's kind and how it ended — never a word, a passphrase
 * or a key. The shape is the sidecar's (`publicState` in `crates/custody/src/service.rs`).
 */
export interface Ad4mCustodyHost {
  /** Opens the custody service's window on `change`; resolves when the change ends there. */
  open(change: IdentityChange): Promise<IdentityChangeOutcome>;
  publicState(): Promise<Ad4mCustodyState>;
  /**
   * Whether the host takes the 12 words back, to replace the master key or restore the identity.
   * Absent means it does, as the desktop custody service does; a phone, which takes no words, says
   * `false`, and the screens then offer neither.
   */
  takesWords?: boolean;
}

/** The custody service's public state, as it answers `publicState`. */
export interface Ad4mCustodyState {
  did: string | null;
  /**
   * A master key is held here, with the index its item carries (`null` when the item does not say:
   * one kept before the index was kept with it).
   */
  holdsMaster: { index: number | null } | null;
  unlock: 'os' | 'passphrase' | null;
  /**
   * Why no change can run here: the executor reports no identity store (its network names none),
   * or one it trusts no key for, so it would refuse everything the custody service publishes.
   */
  blocked?: string | null;
  /** The private record's devices; `holdsMaster` is `false`, `true` or `"offered"`. */
  devices?: { keyId: string; name: string; kind: string; holdsMaster: boolean | 'offered' }[];
  requests?: { id: string; kind: string; by: string; keyIds: string[]; expires: number }[];
  /** The revoked keys the key log says may still hold a valid master key. */
  revokedHolders?: string[];
  masterWaiting?: boolean;
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

function readStoreBehind(value: unknown): KeyLogStoreBehind | null {
  if (!value || typeof value !== 'object') return null;
  const behind = value as Raw;
  return { since: count(behind.since) ?? 0, seq: count(behind.seq) };
}

/**
 * A key log event as the executor serves it (`did:scid:coasys:1`), read into {@link KeyLogEvent}.
 * Tolerant of fields it does not know, and of a malformed event, which becomes `op: 'unknown'`
 * rather than a thrown error: a key log screen that shows five events of six is still a key log.
 */
export function readKeyLogEvent(raw: unknown, hash: string | null = null): KeyLogEvent {
  const event = record(raw);
  const devices = Array.isArray(event.add) ? event.add : [];
  return {
    seq: count(event.seq) ?? -1,
    op: text(event.op) ?? 'unknown',
    hash,
    added: devices
      .filter((d): d is Raw => !!d && typeof d === 'object')
      .map((d) => ({ id: text(d.id) ?? '', sign: text(d.sign) ?? '' })),
    revoked: Array.isArray(event.revoke) ? event.revoke.map(String) : [],
  };
}

export function readCustody(value: Ad4mCustodyState): IdentityCustodyView {
  const devices = (Array.isArray(value.devices) ? value.devices : []).map((item) => {
    const device = record(item);
    const holds = device.holdsMaster;
    return {
      keyId: text(device.keyId) ?? '',
      name: text(device.name) ?? '',
      kind: text(device.kind) ?? '',
      holdsMaster: holds === true ? ('yes' as const) : holds === 'offered' ? ('offered' as const) : ('no' as const),
    };
  });
  const requests = (Array.isArray(value.requests) ? value.requests : []).flatMap((item): DeviceRequestView[] => {
    const request = record(item);
    const kind = request.kind;
    // A kind this app cannot answer is left for one that can.
    if (kind !== 'send-master' && kind !== 'confirm-revoke') return [];
    return [
      {
        id: text(request.id) ?? '',
        kind,
        by: text(request.by) ?? '',
        keyIds: Array.isArray(request.keyIds) ? request.keyIds.map(String) : [],
        expires: count(request.expires) ?? 0,
      },
    ];
  });
  return {
    did: value.did ?? null,
    holdsMaster: !!value.holdsMaster,
    unlock: value.unlock ?? null,
    blocked: value.blocked || null,
    devices,
    revokedHolders: Array.isArray(value.revokedHolders) ? value.revokedHolders.map(String) : [],
    requests,
    masterWaiting: value.masterWaiting === true,
  };
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
    storeBehind: readStoreBehind(status.storeBehind),
  };
}

/**
 * A log as the executor serves it. Each event's hash is the next event's `prev`, and the last one's
 * is the head's: the events carry their predecessor's hash, never their own.
 */
export function readKeyLog(value: unknown): KeyLogView {
  const log = record(value);
  const raw: unknown[] = Array.isArray(log.events) ? log.events : [];
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
    // Any mark at all is a bot's key: a shape this build does not know never makes it a device.
    const mark = device.bot === null || device.bot === undefined || device.bot === false ? null : record(device.bot);
    return {
      keyId: text(device.keyId) ?? '',
      sign: text(device.sign) ?? '',
      thisDevice: device.thisDevice === true,
      addedSeq: count(device.addedSeq) ?? 0,
      revokedSeq: count(device.revokedSeq),
      bot: mark && {
        can: (Array.isArray(mark.can) ? mark.can : []).filter((c): c is string => typeof c === 'string'),
        expires: count(mark.expires),
      },
      expires: count(device.expires),
    };
  });
}

export function createAd4mIdentityPort(backendClient: unknown, custody?: Ad4mCustodyHost): IdentityPort {
  const client = backendClient as IdentityClientLike & Partial<Ad4mClient>;

  /** Whether this executor runs bots: it answers `bot.list`. */
  async function answersBots(): Promise<boolean> {
    if (!client.bot) return false;
    try {
      await client.bot.list();
      return true;
    } catch (error) {
      recordMissingMethod(error);
      return false;
    }
  }

  const port: IdentityPort = {
    async capabilities(): Promise<IdentityCapabilities> {
      try {
        await client.identity.status();
      } catch (error) {
        recordMissingMethod(error);
        return NO_IDENTITY_CAPABILITIES;
      }
      // The log and the device list come from the executor. Changing either needs the master key,
      // which only the custody service holds: without one, this computer reads and changes nothing.
      // The custody service also takes the 12 words back, to replace the master key or restore.
      return {
        ...NO_IDENTITY_CAPABILITIES,
        bots: await answersBots(),
        keyLog: true,
        devices: true,
        masterKey: !!custody,
        recoveryWords: !!custody && custody.takesWords !== false,
        linkDevice: !!custody,
      };
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

  if (client.bot) port.bots = createAd4mBotPort(client.bot);
  if (custody) {
    port.custody = async () => readCustody(await custody.publicState());
    port.change = (change) => custody.open(change);
  }
  return port;
}
