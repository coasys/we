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
  type AddServerOutcome,
  type DeviceKeyView,
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
  type ServingSessionEnded,
  type ServingView,
  THIS_COMPUTER_ID,
} from '@we/backend-shared';

import {
  type ConnectRemote,
  type KeySession,
  KeySessionError,
  type KeySessionSigner,
  normalizeServerAddress,
  tryKeyLogin,
} from './keySession';
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

/**
 * The custody service as a desktop host reaches it: open a change in its own window, and read its
 * public state. What crosses here is a change's kind and how it ended — never a word, a passphrase
 * or a key. The shape is the sidecar's (`publicState` in `crates/custody/src/service.rs`).
 */
export interface Ad4mCustodyHost {
  /** Opens the custody service's window on `change`; resolves when the change ends there. */
  open(change: IdentityChange): Promise<IdentityChangeOutcome>;
  publicState(): Promise<Ad4mCustodyState>;
}

/** The custody service's public state, as it answers `publicState`. */
export interface Ad4mCustodyState {
  did: string | null;
  /** The index of the master key held here, if one is. */
  holdsMaster: { index: number } | null;
  unlock: 'os' | 'passphrase' | null;
  /**
   * Why no change can run here: the executor reports no identity store (its network names none),
   * or one it trusts no key for, so it would refuse everything the custody service publishes.
   */
  blocked?: string | null;
}

/**
 * The servers this account can be served by, as the host keeps them: a desktop host keeps them in
 * its account registry, beside the account, so the choice survives a restart and is the account's
 * own. Addresses are origins (`https://host:port`), as {@link normalizeServerAddress} makes them.
 */
export interface Ad4mServerHost {
  list(): Promise<{ servers: { address: string; name: string }[]; serving: string | null }>;
  add(server: { address: string; name: string }): Promise<void>;
  remove(address: string): Promise<void>;
  /**
   * Serves the account from `address` (`null`: this computer) from the next start, and starts the
   * app over. A renderer that reloads does not resolve.
   */
  choose(address: string | null): Promise<void>;
}

/** Which device serves this session, as the connector found it at start. */
export interface Ad4mServing {
  host: Ad4mServerHost;
  /** This computer's executor, which signs logins to a server. */
  signer: KeySessionSigner;
  /** The session on the server serving this one, or `null` when this computer serves it. */
  current: { session: KeySession; name: string } | null;
  /** Why the chosen server does not serve this session, when it does not. */
  problem: string | null;
  /** How a client on a server is opened; the SDK's, outside tests. */
  connect?: ConnectRemote;
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
  return {
    did: value.did ?? null,
    holdsMaster: !!value.holdsMaster,
    unlock: value.unlock ?? null,
    blocked: value.blocked || null,
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
    return {
      keyId: text(device.keyId) ?? '',
      sign: text(device.sign) ?? '',
      thisDevice: device.thisDevice === true,
      addedSeq: count(device.addedSeq) ?? 0,
      revokedSeq: count(device.revokedSeq),
    };
  });
}

export function createAd4mIdentityPort(
  backendClient: unknown,
  custody?: Ad4mCustodyHost,
  serving?: Ad4mServing,
): IdentityPort {
  const client = backendClient as IdentityClientLike & Partial<Ad4mClient>;

  const port: IdentityPort = {
    async capabilities(): Promise<IdentityCapabilities> {
      let status: IdentityStatusView;
      try {
        status = readIdentityStatus(await client.identity.status());
      } catch (error) {
        recordMissingMethod(error);
        return NO_IDENTITY_CAPABILITIES;
      }
      // The log and the device list come from the executor. Changing either needs the master key,
      // which only the custody service holds: without one, this computer reads and changes nothing.
      return {
        ...NO_IDENTITY_CAPABILITIES,
        keyLog: true,
        devices: true,
        masterKey: !!custody,
        linkDevice: !!custody,
        // A server lets this computer in by its device key speaking for an identity: a key that
        // speaks for nobody yet logs in nowhere.
        switchDevice: !!serving && status.did !== null,
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

  if (custody) {
    port.custody = async () => readCustody(await custody.publicState());
    port.change = (change) => custody.open(change);
  }
  if (serving) Object.assign(port, servingMembers(serving));
  return port;
}

/** The name a server is listed under: its host, which is what a person typed. */
function serverName(address: string): string {
  return new URL(address).host;
}

/** `serving`, `addServer`, `removeServer`, `serveFrom` and `onSessionEnded`, over the host's list. */
function servingMembers(
  serving: Ad4mServing,
): Required<Pick<IdentityPort, 'serving' | 'addServer' | 'removeServer' | 'serveFrom' | 'onSessionEnded'>> {
  const { host, signer, current } = serving;
  const servedBy = current?.session.address ?? null;

  // The end is kept, so a listener that arrives after it (a settings page opened later) hears it.
  let ended: ServingSessionEnded | null = null;
  const listeners = new Set<(ended: ServingSessionEnded) => void>();
  current?.session.onEnded((reason) => {
    ended = { reason, id: current.session.address, name: current.name };
    for (const listener of [...listeners]) listener(ended);
  });

  return {
    async serving(): Promise<ServingView> {
      const { servers } = await host.list();
      return {
        devices: [
          { id: THIS_COMPUTER_ID, name: 'This computer', address: null, current: servedBy === null },
          ...servers.map((server) => ({
            id: server.address,
            name: server.name,
            address: server.address,
            current: server.address === servedBy,
          })),
        ],
        role: current?.session.role ?? null,
        problem: serving.problem,
      };
    },

    async addServer(address: string): Promise<AddServerOutcome> {
      let origin: string;
      try {
        origin = normalizeServerAddress(address);
      } catch (error) {
        const refusal = error as KeySessionError;
        return { ok: false, reason: refusal.reason, message: refusal.message };
      }
      const { servers } = await host.list();
      if (servers.some((server) => server.address === origin)) return { ok: true, id: origin };
      // Kept only once it lets this computer in: a server that does not is not one of the person's.
      try {
        await tryKeyLogin(signer, origin, serving.connect ? { connect: serving.connect } : {});
      } catch (error) {
        if (error instanceof KeySessionError) return { ok: false, reason: error.reason, message: error.message };
        throw error;
      }
      await host.add({ address: origin, name: serverName(origin) });
      return { ok: true, id: origin };
    },

    async removeServer(id: string) {
      if (id === servedBy) throw new Error('This host is in use. Switch to another device first.');
      await host.remove(id);
    },

    async serveFrom(id: string) {
      const address = id === THIS_COMPUTER_ID ? null : id;
      if (address !== null) {
        const { servers } = await host.list();
        if (!servers.some((server) => server.address === address)) throw new Error(`Can't find the host ${id}.`);
      }
      // Already served from there, and nothing went wrong getting there: nothing to start over.
      if (address === servedBy && serving.problem === null && ended === null) return;
      await current?.session.close();
      await host.choose(address);
    },

    onSessionEnded(listener) {
      listeners.add(listener);
      if (ended) listener(ended);
      return () => listeners.delete(listener);
    },
  };
}
