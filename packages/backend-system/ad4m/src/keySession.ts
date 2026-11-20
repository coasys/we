/**
 * A key session: a device key logs in to an executor, and the session is kept renewed while the app
 * runs.
 *
 * The executor's side is `user.sessionChallenge` → `user.loginWithKey` → `user.renewSession`
 * (ad4m's `rust-executor/src/identity/key_login.rs`). The signer's side is a {@link KeySigner}: the
 * phone's `DeviceKey` plugin, or on a computer its own executor (`agent.signSessionStatement`,
 * {@link executorSigner}). The statement's audience is the origin this app dials, chosen here and
 * never taken from an answer. The executor gives the session to whichever local agent speaks for
 * the phone's identity (or the operator role, to its operator), and refuses with one reason:
 * `challenge`, `audience`, `no-public-origin`, `signature`, `key`, `not-known` or
 * `store-unavailable`.
 *
 * Nothing here holds the token longer than the connection it is for: every boot logs in afresh,
 * which costs one challenge and one signature and asks the person nothing.
 *
 * Written over the SDK's `agent` calls it makes, so a test stands in a fake of those three.
 */
import type { AgentClient } from '@coasys/ad4m';

/** The calls a key session makes on an executor: `client.agent`'s. */
export type KeySessionAgent = Pick<AgentClient, 'sessionChallenge' | 'loginWithKey' | 'renewSession'>;

/** A key statement and the signature of the key it names: what `user.loginWithKey` takes. */
export type SignedKeyStatement = Parameters<AgentClient['loginWithKey']>[0];

/** The app the session is for: `AuthInfoInput`. */
export type KeySessionApp = Parameters<AgentClient['loginWithKey']>[1];

/** What `user.loginWithKey` answers: the token, its expiry, the grant, the role, the agent and identity. */
export type KeySession = Awaited<ReturnType<AgentClient['loginWithKey']>>;

/** What a signer is asked to sign a statement for. */
export interface SessionSignRequest {
  purpose: 'login' | 'renew';
  /** The executor's DID, from `user.sessionChallenge`. */
  executor: string;
  /** The URL this app dials: the statement's audience is its origin. */
  url: string;
  /** From `user.sessionChallenge`. */
  challenge: string;
  /** The grant a `renew` renews; a `login` names none. */
  grant?: string;
}

/** Whatever holds a device key and signs a `coasys:session` statement with it. */
export interface KeySigner {
  signSession(request: SessionSignRequest): Promise<SignedKeyStatement>;
}

/** `scheme://host[:port]` of `url`, `ws`/`wss` as `http`/`https`: the audience the executor checks. */
export function originOf(url: string): string {
  const parsed = new URL(url.replace(/^ws(s?):/i, 'http$1:'));
  return parsed.origin;
}

/**
 * Signs with this computer's own executor: its main agent's device key speaks for the person
 * (`agent.signSessionStatement`, which only the operator on this machine may call). `agent` is that
 * executor's client, with its admin credential.
 */
export function executorSigner(
  agent: Pick<AgentClient, 'signSessionStatement'>,
  now: () => number = Date.now,
): KeySigner {
  return {
    signSession: ({ purpose, executor, url, challenge, grant }) =>
      agent.signSessionStatement({
        v: 1,
        purpose,
        executor,
        audience: originOf(url),
        challenge,
        client: { kind: 'native' },
        ...(grant ? { grant } : {}),
        issuedAt: Math.floor(now() / 1000),
      }),
  };
}

/**
 * Logs in to the executor `agent` reaches, at `url`, with `signer`'s device key. `agent` is an
 * unauthenticated client's: a challenge and a login need no token.
 */
export async function loginWithDeviceKey(
  signer: KeySigner,
  agent: KeySessionAgent,
  url: string,
  app: KeySessionApp,
): Promise<KeySession> {
  const { challenge, executor } = await agent.sessionChallenge();
  const proof = await signer.signSession({ purpose: 'login', executor, url, challenge });
  return agent.loginWithKey(proof, app);
}

/** The app a key session names, for the host that reads it in its grants list. */
export const KEY_SESSION_APP: KeySessionApp = {
  appName: 'WE',
  appDesc: 'Social media for the new internet',
  appDomain: 'ad4m.weco.io',
  appIconPath: 'https://avatars.githubusercontent.com/u/34165012',
  capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
};

/** The timer a renewal waits on; the tests pass their own. */
export interface RenewalClock {
  /** Unix milliseconds. */
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: RenewalClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** How long before the expiry a renewal is asked for. A token lives an hour. */
export const RENEW_BEFORE_MS = 5 * 60_000;
/** How soon a renewal that failed is tried again, while the session still has time left. */
export const RETRY_MS = 30_000;

export interface Renewal {
  /** Stops renewing: on log out. */
  stop(): void;
  /** The expiry of the session as last renewed, Unix seconds. */
  expiresAt(): number;
}

/**
 * Renews the session `session` opened, five minutes before each expiry, until stopped: a fresh
 * challenge from the session's own client (`agent`, authenticated), a `renew` statement naming the
 * grant, and `user.renewSession`. The grant and the open sockets stay the same; `onToken` gets each
 * new token, for whatever opens a connection later (an embedded app is handed the current one).
 *
 * A renewal that fails is tried again every 30 seconds while the session has time left; after
 * that it stops, and `onExpired` is told.
 */
export function keepRenewed(options: {
  signer: KeySigner;
  agent: KeySessionAgent;
  url: string;
  session: KeySession;
  onToken: (token: string) => void;
  onExpired?: (error: unknown) => void;
  clock?: RenewalClock;
}): Renewal {
  const { signer, agent, url, session, onToken, onExpired } = options;
  const clock = options.clock ?? systemClock;
  let expiresAt = session.expiresAt;
  let handle: unknown = null;
  let stopped = false;

  const schedule = (ms: number) => {
    if (stopped) return;
    handle = clock.setTimeout(() => void renew(), Math.max(0, ms));
  };

  const renew = async () => {
    if (stopped) return;
    try {
      const { challenge, executor } = await agent.sessionChallenge();
      const proof = await signer.signSession({
        purpose: 'renew',
        executor,
        url,
        challenge,
        grant: session.grantId,
      });
      const renewed = await agent.renewSession(proof);
      if (stopped) return;
      expiresAt = renewed.expiresAt;
      onToken(renewed.token);
      schedule(expiresAt * 1000 - clock.now() - RENEW_BEFORE_MS);
    } catch (error) {
      if (stopped) return;
      if (expiresAt * 1000 - clock.now() > RETRY_MS) {
        console.warn('[WE] Renewing the key session failed; trying again:', error);
        schedule(RETRY_MS);
      } else {
        console.error('[WE] The key session could not be renewed before it ended:', error);
        onExpired?.(error);
      }
    }
  };

  schedule(expiresAt * 1000 - clock.now() - RENEW_BEFORE_MS);
  return {
    stop() {
      stopped = true;
      if (handle !== null) clock.clearTimeout(handle);
    },
    expiresAt: () => expiresAt,
  };
}
