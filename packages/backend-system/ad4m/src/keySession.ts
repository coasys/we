/**
 * A session on another executor — the person's server — opened with this computer's device key.
 *
 * ## Who signs, who checks
 *
 * The device key never leaves this computer's own executor. So a login is three calls on two
 * executors: the server hands out a one-use challenge (`user.sessionChallenge`), this computer's
 * executor signs a `coasys:session` statement naming that challenge and the server
 * (`agent.signSessionStatement`, which only the shell on this machine may call), and the server
 * checks the statement against the person's key log and answers a token (`user.loginWithKey`). The
 * role comes from the identity, never from what this side asks for: the server's operator gets the
 * operator role, an identity one of its agents speaks for gets that agent.
 *
 * ## Keeping it, and losing it
 *
 * A token lives an hour. Renewing it is the same dance with a `renew` statement naming the grant, a
 * few minutes before it runs out. The renewed token is a new string for the same grant, and the SDK
 * client keeps the one it was built with: the socket this client dials is made here
 * ({@link tokenSocket}), so a reconnect after a renewal carries the current token rather than one
 * that has expired.
 *
 * A device the person revokes loses its sessions: the server ends the grant and closes the socket,
 * and the client reports the refused token. Which of the two happened — this device was removed, or
 * the session merely ended — is asked of the server itself, by trying a login once more: a revoked
 * key is refused `key`.
 */
import {
  Ad4mClient,
  type KeySessionResult,
  type SessionChallenge,
  type SignedKeyStatement,
  type UnsignedKeyStatement,
} from '@coasys/ad4m';

/**
 * This computer's executor, which holds the device key and signs. A statement names its `audience`:
 * the origin this side dialled, which the server refuses unless it is its own — so a server that
 * relays another's challenge cannot spend the signature there.
 */
export interface KeySessionSigner {
  agent: { signSessionStatement(statement: UnsignedKeyStatement): Promise<SignedKeyStatement> };
}

/** The slice of an SDK client on the server that a key session uses. */
export interface KeySessionRemote {
  agent: {
    sessionChallenge(): Promise<SessionChallenge>;
    loginWithKey(proof: SignedKeyStatement, app: KeySessionApp): Promise<KeySessionResult>;
    renewSession(proof: SignedKeyStatement): Promise<{ token: string; expiresAt: number }>;
    logout(): Promise<boolean>;
  };
  onAuthFailed(callback: (reason: string) => void): () => void;
  close(): void;
}

/** What the server is told about the app logging in, as `user.loginWithKey` takes it. */
export interface KeySessionApp {
  appName: string;
  appDesc: string;
  appDomain: string;
  capabilities?: { with: { domain: string; pointers: string[] }; can: string[] }[];
}

/**
 * Opens a client on the server at `address`: without a token for the login itself, and with the
 * session's current token (read at every dial) once logged in.
 */
export type ConnectRemote = (address: string, token?: () => string) => KeySessionRemote;

export interface KeySessionOptions {
  app?: KeySessionApp;
  connect?: ConnectRemote;
  /** Unix seconds by this computer's clock. */
  now?: () => number;
  /** Renew this many seconds before the token runs out. */
  renewMarginSec?: number;
  /** After a renewal that failed for a reason other than the key, try again this much later. */
  retryAfterSec?: number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/** A key login's role, in WE's words: `operator` runs the server, `agent` is served by it. */
export type KeySessionRole = 'operator' | 'agent';

export interface KeySession {
  address: string;
  role: KeySessionRole;
  /** The DID of the agent the session acts as, and the identity that logged in. */
  did: string;
  scid: string;
  /** The client on the server, carrying the current token. */
  client: unknown;
  token(): string;
  /** Unix seconds by the server's clock. */
  expiresAt(): number;
  /** Called once, when the server ends the session. Returns its unsubscribe. */
  onEnded(listener: (reason: 'revoked' | 'ended') => void): () => void;
  /** Logs out on the server and closes the client. No `onEnded` follows. */
  close(): Promise<void>;
}

/** A refused or failed login: `reason` is the executor's word, or `unreachable`. */
export class KeySessionError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'KeySessionError';
  }
}

/** The reasons an executor answers a key login or its statement with (`KeyLoginError::code`). */
const REASONS = [
  'challenge',
  'audience',
  'no-public-origin',
  'signature',
  'key',
  'not-known',
  'store-unavailable',
  'grant',
  'too-many-challenges',
  'local-only',
] as const;

/**
 * The executor's word for why a call failed. An `RpcError` carries the body the executor answered;
 * a socket that never opened answers 503 with no reason of the executor's, which is `unreachable`.
 */
export function refusalReason(error: unknown): string {
  const body =
    error && typeof error === 'object' && typeof (error as { body?: unknown }).body === 'string'
      ? (error as { body: string }).body
      : error instanceof Error
        ? error.message.replace(/^RPC error \d+: /, '')
        : String(error);
  const status =
    error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : null;
  const known = REASONS.find(
    (reason) => body === reason || body.startsWith(`${reason}:`) || body.startsWith(`${reason} `),
  );
  if (known) return known;
  if (status === 503 || status === null) return 'unreachable';
  return 'refused';
}

/** What a refusal means, in words a person reads. */
export function describeRefusal(reason: string, origin?: string): string {
  switch (reason) {
    case 'key':
      return 'That server no longer accepts this device: it was removed from your identity.';
    case 'not-known':
      return 'That server does not know you: you do not run it, and none of its agents is yours.';
    case 'store-unavailable':
      return 'That server cannot check your keys right now: it cannot reach the identity store. Try again later.';
    case 'audience':
    case 'no-public-origin':
      // The server accepts a login only for an origin it is configured as (`--public-origin`); with
      // none configured, only from its own computer.
      return `That server does not list ${origin ?? 'this address'} as its address. Its operator sets it with --public-origin.`;
    case 'challenge':
      return 'That server and this computer disagree about the time, or the login took too long. Try again.';
    case 'signature':
      return 'That server could not check this computer’s signature.';
    case 'local-only':
      return 'This computer’s data layer would not sign the login.';
    case 'insecure':
      return 'That address is plain http:// to another computer, so your session would travel unencrypted. Use its https:// address.';
    case 'unreachable':
      return 'Could not reach that server. Check the address, and that it is running.';
    default:
      return 'That server refused the login.';
  }
}

/** The app as a key login names it, asking for everything: the server decides what the role gets. */
export const WE_KEY_SESSION_APP: KeySessionApp = {
  appName: 'WE',
  appDesc: 'WE, on another of your devices',
  appDomain: 'we.coasys.org',
  capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
};

/**
 * `ws://host/api/v1/ws?token=…` with the token replaced by the current one. The SDK names the token
 * it was built with in the URL it dials; the session's own is the one that has not expired.
 */
export function withToken(url: string, token: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('token', token);
  return parsed.toString();
}

/** A WebSocket class whose every dial carries `token()`. See the file header. */
export function tokenSocket(token: () => string): new (url: string) => WebSocket {
  const Base = globalThis.WebSocket;
  return class extends Base {
    constructor(url: string) {
      super(withToken(url, token()));
    }
  };
}

/** The SDK client on the server. */
export const connectAd4mRemote: ConnectRemote = (address, token) =>
  token ? new Ad4mClient(address, token(), { webSocketImpl: tokenSocket(token) }) : new Ad4mClient(address);

/**
 * `host:port`, `https://host:port/` and `http://localhost:port` all name a server; WE keeps the
 * origin, which is what the SDK dials and what a statement names as its audience. An address with no
 * scheme is `https://`. Throws on anything that is not an http(s) address, and on plain `http://` to
 * anything but this computer: the session token travels in the socket's URL, so over `ws://` it and
 * every later call would cross the network unencrypted.
 */
export function normalizeServerAddress(address: string): string {
  const trimmed = address.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new KeySessionError('address', 'That is not a server address. Try one like https://my-server.example:12000.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new KeySessionError('address', 'A server address starts with https://.');
  }
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    throw new KeySessionError(
      'insecure',
      `${parsed.host} would be reached without encryption (http://), and your session with it would travel in the clear. Use its https:// address.`,
    );
  }
  return parsed.origin;
}

/** `localhost`, 127.0.0.0/8 and ::1: the addresses that never leave this computer. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

const unixNow = () => Math.floor(Date.now() / 1000);

/**
 * One login: a challenge from the server, the statement signed here, the token from the server.
 * `audience` is the origin WE dialled — never anything the server said about itself.
 */
async function login(
  signer: KeySessionSigner,
  remote: KeySessionRemote,
  audience: string,
  app: KeySessionApp,
  now: () => number,
): Promise<KeySessionResult> {
  const challenge = await remote.agent.sessionChallenge();
  const proof = await signer.agent.signSessionStatement({
    v: 1,
    purpose: 'login',
    executor: challenge.executor,
    audience,
    challenge: challenge.challenge,
    client: { kind: 'native' },
    issuedAt: now(),
  });
  return remote.agent.loginWithKey(proof, app);
}

/** Logs in on a fresh client and closes it; throws a {@link KeySessionError}. */
async function loginOnce(
  signer: KeySessionSigner,
  address: string,
  connect: ConnectRemote,
  app: KeySessionApp,
  now: () => number,
): Promise<KeySessionResult> {
  const anonymous = connect(address);
  try {
    return await login(signer, anonymous, address, app, now);
  } catch (error) {
    const reason = refusalReason(error);
    throw new KeySessionError(reason, describeRefusal(reason, address));
  } finally {
    anonymous.close();
  }
}

/** Logs in on the server at `address` with this computer's device key, and keeps the session. */
export async function openKeySession(
  signer: KeySessionSigner,
  address: string,
  options: KeySessionOptions = {},
): Promise<KeySession> {
  const connect = options.connect ?? connectAd4mRemote;
  const app = options.app ?? WE_KEY_SESSION_APP;
  const now = options.now ?? unixNow;
  const margin = options.renewMarginSec ?? 300;
  const retryAfter = options.retryAfterSec ?? 60;
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));

  // Before anything is signed or dialled: the origin is what the statements name as their audience.
  const origin = normalizeServerAddress(address);
  const opened = await loginOnce(signer, origin, connect, app, now);
  let token = opened.token;
  let expiresAt = opened.expiresAt;
  // The expiry is by the server's clock, read here by ours. They agree closely enough: the server
  // refuses a statement whose `issuedAt` is far from its own time, so a login that worked means
  // the two clocks are within that skew, and the renewal margin is several times larger.
  const client = connect(origin, () => token);

  const listeners = new Set<(reason: 'revoked' | 'ended') => void>();
  let timer: unknown = null;
  let finished = false;

  const end = (reason: 'revoked' | 'ended') => {
    if (finished) return;
    finished = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
    for (const listener of [...listeners]) listener(reason);
    listeners.clear();
    client.close();
  };

  const schedule = (afterSec: number) => {
    if (finished) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => void renew(), Math.max(1, afterSec) * 1000);
  };

  async function renew(): Promise<void> {
    timer = null;
    if (finished) return;
    try {
      const challenge = await client.agent.sessionChallenge();
      const proof = await signer.agent.signSessionStatement({
        v: 1,
        purpose: 'renew',
        executor: challenge.executor,
        audience: origin,
        challenge: challenge.challenge,
        client: { kind: 'native' },
        grant: opened.grantId,
        issuedAt: now(),
      });
      const renewed = await client.agent.renewSession(proof);
      if (finished) return;
      token = renewed.token;
      expiresAt = renewed.expiresAt;
      schedule(expiresAt - now() - margin);
    } catch (error) {
      if (finished) return;
      const reason = refusalReason(error);
      // The key is no longer valid, or the grant is gone: renewing cannot work again.
      if (reason === 'key') return end('revoked');
      if (reason === 'grant') return end('ended');
      // Anything else (the server restarting, the network) is tried again while the token lasts.
      if (now() + retryAfter < expiresAt) schedule(retryAfter);
      else end('ended');
    }
  }

  // The server refused the token: it ended the grant. Ask it once more which way. The probe dials
  // and signs for `origin`, as the session did: the address as typed may carry a path or a case
  // the server would refuse as its audience, which would read a revoked device as merely ended.
  client.onAuthFailed(() => {
    if (finished) return;
    void (async () => {
      try {
        const probe = await loginOnce(signer, origin, connect, app, now);
        // It lets this computer in still, so the session merely ended. The probe's own grant is
        // not kept: the app starts over to use a new one.
        const probeClient = connect(origin, () => probe.token);
        await probeClient.agent.logout().catch(() => false);
        probeClient.close();
        end('ended');
      } catch (error) {
        end(error instanceof KeySessionError && error.reason === 'key' ? 'revoked' : 'ended');
      }
    })();
  });

  schedule(expiresAt - now() - margin);

  return {
    address: origin,
    role: opened.role === 'operator' ? 'operator' : 'agent',
    did: opened.did,
    scid: opened.scid,
    client,
    token: () => token,
    expiresAt: () => expiresAt,
    onEnded(listener) {
      if (finished) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      if (finished) return;
      finished = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      listeners.clear();
      await client.agent.logout().catch(() => false);
      client.close();
    },
  };
}

/**
 * Checks that the server at `address` lets this computer in, and logs straight out again: adding a
 * server to the list proves the login works before it is kept.
 */
export async function tryKeyLogin(
  signer: KeySessionSigner,
  address: string,
  options: Pick<KeySessionOptions, 'app' | 'connect' | 'now'> = {},
): Promise<KeySessionRole> {
  const connect = options.connect ?? connectAd4mRemote;
  const origin = normalizeServerAddress(address);
  const opened = await loginOnce(signer, origin, connect, options.app ?? WE_KEY_SESSION_APP, options.now ?? unixNow);
  const session = connect(origin, () => opened.token);
  await session.agent.logout().catch(() => false);
  session.close();
  return opened.role === 'operator' ? 'operator' : 'agent';
}
