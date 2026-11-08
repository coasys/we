/**
 * A key session: the phone logs in to an executor with its device key, and keeps the session
 * renewed while the app runs.
 *
 * The executor's side is `user.sessionChallenge` → `user.loginWithKey` → `user.renewSession`
 * (ad4m's `rust-executor/src/identity/key_login.rs`). The phone's side is the `DeviceKey` plugin,
 * which signs the statement; the statement's audience is the origin this app dials, chosen here and
 * never taken from an answer. The executor gives the session to whichever local agent speaks for
 * the phone's identity (or the operator role, to its operator), and refuses with one reason:
 * `challenge`, `audience`, `no-public-origin`, `signature`, `key`, `not-known` or
 * `store-unavailable`.
 *
 * Nothing here holds the token longer than the connection it is for: every boot logs in afresh,
 * which costs one challenge and one signature and asks the person nothing.
 *
 * Written over the few client calls it makes, rather than over `Ad4mClient`, so it can be tested
 * without an executor.
 */
import type { DeviceKeyPlugin } from './deviceKey';

/** The calls a key session makes on an executor: `client.agent`'s, by the same names. */
export interface KeySessionAgent {
  sessionChallenge(): Promise<{ challenge: string; executor: string; expiresAt: number }>;
  loginWithKey(proof: Awaited<ReturnType<DeviceKeyPlugin['signSession']>>, app: KeySessionApp): Promise<KeySession>;
  renewSession(proof: Awaited<ReturnType<DeviceKeyPlugin['signSession']>>): Promise<{
    token: string;
    expiresAt: number;
  }>;
}

/** The app the session is for: `AuthInfoInput`. */
export interface KeySessionApp {
  appName: string;
  appDesc: string;
  appDomain: string;
  appUrl?: string;
  appIconPath?: string;
  capabilities?: { with: { domain: string; pointers: string[] }; can: string[] }[];
}

/** What `user.loginWithKey` answers. */
export interface KeySession {
  token: string;
  /** Unix seconds, by the executor's clock. */
  expiresAt: number;
  grantId: string;
  role: 'operator' | 'tenant' | 'app' | 'anonymous';
  /** The agent the session acts as. */
  did: string;
  /** The identity that logged in. */
  scid: string;
}

/**
 * Logs in to the executor `agent` reaches, at `url`, with the phone's device key. `agent` is an
 * unauthenticated client's: a challenge and a login need no token.
 */
export async function loginWithDeviceKey(
  plugin: DeviceKeyPlugin,
  agent: KeySessionAgent,
  url: string,
  app: KeySessionApp,
): Promise<KeySession> {
  const { challenge, executor } = await agent.sessionChallenge();
  const proof = await plugin.signSession({ purpose: 'login', executor, url, challenge });
  return agent.loginWithKey(proof, app);
}

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
  plugin: DeviceKeyPlugin;
  agent: KeySessionAgent;
  url: string;
  session: KeySession;
  onToken: (token: string) => void;
  onExpired?: (error: unknown) => void;
  clock?: RenewalClock;
}): Renewal {
  const { plugin, agent, url, session, onToken, onExpired } = options;
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
      const proof = await plugin.signSession({
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
