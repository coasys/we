/**
 * The phone's connector: a key login to the executor it was told to use.
 *
 * Inside the phone app, with the `DeviceKey` plugin holding a device key that an identity's log
 * lists, and an executor URL set ({@link readKeyHost}), WE logs in to that executor with the
 * device key (`keySession.ts`) instead of asking for an email and password. Where it cannot — no
 * plugin, no identity, no executor, or the executor refuses the key — it throws
 * {@link KeyLoginRefused}, and the base app hands the connection choice back with the reason.
 *
 * The key login's token opens an `Ad4mClient` of its own, which is checked (the agent there is
 * unlocked) and watched (`onAuthFailed`). The token is not written to localStorage, and the ordinary
 * connector's stored session is left as it was: every boot logs in afresh.
 *
 * A session that ends by itself — the renewal ran out of time, or the executor refused the token —
 * is not left as an app whose calls all fail: by default WE starts again ({@link startAgain}),
 * which logs in afresh or, failing that, returns to the connection choice.
 *
 * A key login that cannot reach the executor (the phone offline past the session's hour, say) is
 * not a failed one: it tries again for a while and then says the phone is offline, with a way to
 * try again, rather than showing a password screen to someone whose identity is fine.
 */
import { Ad4mClient, type AgentStatus } from '@coasys/ad4m';
import type { BackendConnector, BackendInitResult } from '@we/app-shell/shared';
import { capabilitiesFromToken, createAd4mBackendPorts } from '@we/backend-ad4m';
import weSeed from '@we/seed-file';

import { type DeviceKeyPlugin, deviceKeyPlugin } from './deviceKey';
import { readKeyHost, rememberKeyHost } from './keyHost';
import { keepRenewed, type KeySessionApp, loginWithDeviceKey } from './keySession';
import { browserNav, type PageNav, phoneCustodyHost } from './phoneCustody';

const CAPABILITIES = [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }];

const APP_INFO = {
  name: 'WE',
  description: 'Social media for the new internet',
  url: 'ad4m.weco.io',
  iconPath: 'https://avatars.githubusercontent.com/u/34165012',
};

/** The app a key session is granted to: the same app the connect UI asks for. */
export const KEY_SESSION_APP: KeySessionApp = {
  appName: APP_INFO.name,
  appDesc: APP_INFO.description,
  appDomain: APP_INFO.url,
  appIconPath: APP_INFO.iconPath,
  capabilities: CAPABILITIES,
};

/**
 * How a key session ended without the person logging out: the renewal ran out of time
 * (`expired`), or the executor refused the token (`refused`: revoked, or expired while the phone
 * slept). Times are Unix milliseconds.
 */
export interface KeySessionEnd {
  cause: 'expired' | 'refused';
  openedAt: number;
  endedAt: number;
  error?: unknown;
}

/** What the connector needs from the phone and the page; the tests pass their own. */
export interface DeviceKeyConnectorDeps {
  plugin: () => DeviceKeyPlugin | null;
  keyHost: () => string | null;
  /** What happens when the session ends by itself. By default, {@link startAgain}. */
  onSessionEnded?: (end: KeySessionEnd) => void;
  /** Whether this boot skips the key login once. By default, {@link takeEndedTooSoon}. */
  skipKeyLogin?: () => boolean;
  /** How a login that could not reach the executor waits before the next try; the tests pass their own. */
  waitToRetry?: (ms: number) => Promise<void>;
  /** The time, Unix ms; the tests pass their own. */
  now?: () => number;
  /** Where the page is and how it leaves for the identity page; the tests pass their own. */
  nav?: PageNav;
}

const defaultDeps: DeviceKeyConnectorDeps = { plugin: () => deviceKeyPlugin(), keyHost: () => readKeyHost() };

/** The tab's note that its last key session ended within {@link TOO_SOON_MS} of opening. */
export const ENDED_TOO_SOON_KEY = 'we-phone/key-session-ended-too-soon';
/** A key session that ends sooner than this after it opened is not logged straight back in to. */
export const TOO_SOON_MS = 60_000;
/**
 * How long the note that a session ended too soon holds. It is for the boot right after; one left
 * in `localStorage` (where there is no `sessionStorage`) must not skip a key login days later.
 */
export const TOO_SOON_NOTE_MS = 10 * 60_000;

/** How long a key login keeps trying an executor it cannot reach before it says so. */
export const UNREACHABLE_MS = 60_000;
/** The waits between those tries: doubling from the first, up to the last. */
export const RETRY_FIRST_MS = 1_000;
export const RETRY_MAX_MS = 15_000;

type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storageOf(name: 'sessionStorage' | 'localStorage'): TabStorage | undefined {
  try {
    const storage = globalThis[name];
    // A WebView can hand out a storage that throws on use (storage disabled, or full): probe it.
    storage?.getItem(ENDED_TOO_SOON_KEY);
    return storage ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where the loop guard's note goes: the tab's `sessionStorage`, or where the WebView has none,
 * `localStorage`, which outlives the tab, and so the note carries its time ({@link TOO_SOON_NOTE_MS}).
 */
export function guardStorage(): TabStorage | undefined {
  return storageOf('sessionStorage') ?? storageOf('localStorage');
}

/**
 * The default answer to a key session that ended: WE starts again, as a boot. A boot logs in
 * afresh with the device key, which asks the person nothing, so a session that expired while the
 * phone slept comes straight back; one the executor will not open again (the key revoked, the
 * identity not known there) returns to the connection choice ({@link KeyLoginRefused}); a phone still offline, or an
 * executor out of reach, is told so with a way to try again ({@link loginUntilReached}). Either
 * way the person sees where they stand, rather than an app whose every call fails.
 *
 * A session that ended within a minute of opening is noted first, and the boot after it skips the
 * key login once ({@link takeEndedTooSoon}): an executor that grants a session and then refuses it
 * at once would otherwise restart the app for as long as it was open.
 */
export function startAgain(
  end: KeySessionEnd,
  storage: TabStorage | undefined = guardStorage(),
  reload: () => void = () => globalThis.location?.reload(),
): void {
  console.error(`[WE] The key session ended (${end.cause}); starting again:`, end.error ?? '');
  if (end.endedAt - end.openedAt < TOO_SOON_MS) {
    try {
      storage?.setItem(ENDED_TOO_SOON_KEY, String(end.endedAt));
    } catch {
      // An unwritable store only loses the loop guard; the restart still shows where things stand.
    }
  }
  reload();
}

/**
 * Whether the last key session ended too soon, within {@link TOO_SOON_NOTE_MS}; forgets that it
 * did, so it skips once. A note older than that, or one that is not a time, is forgotten too.
 */
export function takeEndedTooSoon(storage: TabStorage | undefined = guardStorage(), now: number = Date.now()): boolean {
  try {
    const note = storage?.getItem(ENDED_TOO_SOON_KEY);
    if (note == null) return false;
    storage!.removeItem(ENDED_TOO_SOON_KEY);
    const endedAt = Number(note);
    return Number.isFinite(endedAt) && now - endedAt >= 0 && now - endedAt < TOO_SOON_NOTE_MS;
  } catch {
    return false;
  }
}

/**
 * Whether a key login failed for want of a network rather than by the executor's answer: the
 * request never got there (a `fetch` that rejected, a socket that closed or would not open, a call
 * with no reply in time), the
 * WebView knows it is offline, or the executor said it could not reach the identity store.
 * Such a failure is no reason to ask for a password: the phone's identity is unchanged, and the
 * key login will work once the network is back. Anything else is a refusal.
 */
export function isUnreachable(error: unknown, online: boolean | undefined = globalThis.navigator?.onLine): boolean {
  if (online === false) return true;
  // The client's own statuses for no answer (`@coasys/ad4m`'s `RpcError`): a socket that closed or
  // would not open is 503, a call with no reply in time is 408; a gateway in front answers 502/504.
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && [0, 408, 502, 503, 504].includes(status)) return true;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : typeof error === 'string' ? error : '';
  return (
    (error instanceof TypeError && /fetch|network|load failed/i.test(message)) ||
    /failed to fetch|networkerror|network request failed|load failed|err_internet_disconnected|err_network|err_name_not_resolved|err_connection|econnrefused|enotfound|etimedout|socket (?:hang up|closed)|websocket (?:closed|error)|connection (?:closed|refused|reset|lost)|timed? ?out|store-unavailable/i.test(
      message,
    )
  );
}

/** A key login that could not reach its executor within {@link UNREACHABLE_MS}. */
export class KeyLoginUnreachable extends Error {
  constructor(
    readonly url: string,
    readonly cause: unknown,
  ) {
    super(
      `This phone is offline, or ${hostOf(url)} cannot be reached. It is still signed in with its device key: try again once it is back online.`,
    );
    this.name = 'KeyLoginUnreachable';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the executor';
  }
}

function waitForOnline(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      globalThis.removeEventListener?.('online', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    globalThis.addEventListener?.('online', done);
  });
}

/**
 * Logs in with the device key, and keeps trying while the executor cannot be reached: doubling
 * waits from {@link RETRY_FIRST_MS} up to {@link RETRY_MAX_MS}, cut short when the WebView comes
 * back online, for {@link UNREACHABLE_MS} in all. Then it throws {@link KeyLoginUnreachable}, which
 * the boot screen shows as "could not reach your data" with a way to try again — never the
 * password screen, which would ask a person whose phone is merely offline to sign in again. A
 * refusal is thrown at once.
 */
export async function loginUntilReached<T>(
  login: () => Promise<T>,
  url: string,
  options: { waitToRetry?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<T> {
  const wait = options.waitToRetry ?? waitForOnline;
  const now = options.now ?? Date.now;
  const started = now();
  let delay = RETRY_FIRST_MS;
  for (;;) {
    try {
      return await login();
    } catch (error) {
      if (!isUnreachable(error)) throw error;
      const left = UNREACHABLE_MS - (now() - started);
      if (left <= 0) throw new KeyLoginUnreachable(url, error);
      console.warn(`[WE] The executor could not be reached for the key login; trying again in ${delay} ms:`, error);
      await wait(Math.min(delay, left));
      delay = Math.min(delay * 2, RETRY_MAX_MS);
    }
  }
}

/**
 * Whether this boot logs in with the device key, and where: the plugin, and the executor's URL,
 * when the phone has joined an identity and has an executor to log in to; otherwise `null`.
 */
export async function keyLoginTarget(
  deps: DeviceKeyConnectorDeps,
): Promise<{ plugin: DeviceKeyPlugin; url: string } | null> {
  const plugin = deps.plugin();
  const url = deps.keyHost();
  if (!plugin || !url) return null;
  try {
    const status = await plugin.status();
    if (!status.identity) return null;
    // What the Keystore actually gives the key that seals the device key: StrongBox is asked for,
    // and anything is accepted. Said here so a reviewer reading the log sees it.
    if (status.protection === 'strongbox' || status.protection === 'tee') {
      console.info(`[WE] Logging in with the device key; its seeds are sealed at ${status.protection} protection.`);
    } else {
      console.warn(
        `[WE] Logging in with the device key; its seeds are sealed at ${status.protection} protection, which is neither StrongBox nor the TEE.`,
      );
    }
    return { plugin, url };
  } catch (error) {
    console.error('[WE] The DeviceKey plugin did not answer:', error);
    return null;
  }
}

/**
 * A key login this boot did not make: there is no device key or executor to log in with, the
 * executor refused the key (not known there, revoked), or the last key session ended as soon as it
 * opened. Thrown rather than answered with another way to sign in: the base app takes the
 * connection choice back with the reason, and the person picks where to go from there.
 */
export class KeyLoginRefused extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KeyLoginRefused';
  }
}

/** The port `url` reaches, as the embedded-app handshake is handed it: the URL's, or its scheme's. */
export function portOf(url: string): number {
  const parsed = new URL(url);
  return Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createDeviceKeyConnector(deps: DeviceKeyConnectorDeps = defaultDeps): BackendConnector {
  return {
    async initialize(ctx): Promise<BackendInitResult> {
      if ((deps.skipKeyLogin ?? takeEndedTooSoon)()) {
        throw new KeyLoginRefused(
          'The last key session ended as soon as it opened, so this phone did not sign in again.',
        );
      }
      const target = await keyLoginTarget(deps);
      if (!target) {
        throw new KeyLoginRefused('This phone has no device key in an identity, or no executor to sign in to with it.');
      }
      const { plugin, url } = target;

      // A challenge and a login need no token: a client of each try's own, closed once it has
      // answered (a socket that failed is not dialled again).
      let session;
      try {
        session = await loginUntilReached(
          async () => {
            const anonymous = new Ad4mClient(url);
            try {
              return await loginWithDeviceKey(plugin, anonymous.agent, url, KEY_SESSION_APP);
            } finally {
              anonymous.close();
            }
          },
          url,
          { waitToRetry: deps.waitToRetry, now: deps.now },
        );
      } catch (error) {
        // Offline, or the executor out of reach: said on the boot screen, with a way to try again.
        if (error instanceof KeyLoginUnreachable) throw error;
        // Not known there, or refused: handed back to the connection choice, with the reason.
        throw new KeyLoginRefused(`${hostOf(url)} did not sign this phone in: ${errorText(error)}`, { cause: error });
      }

      // The client WE keeps, opened with the key session's token. Nothing is written to
      // localStorage: every boot logs in afresh.
      let token = session.token;
      const client = new Ad4mClient(url, token);
      let status: AgentStatus;
      try {
        status = await client.agent.status();
      } catch (error) {
        client.close();
        throw new Error(`The executor at ${url} did not accept the key session: ${errorText(error)}`);
      }
      if (!status.isInitialized || !status.isUnlocked) {
        client.close();
        throw new Error(`The executor at ${url} did not accept the key session: its agent is locked`);
      }

      // A session that ends by itself is told once, and logging out is not an ending.
      const openedAt = Date.now();
      let over = false;
      const onSessionEnded = deps.onSessionEnded ?? ((end: KeySessionEnd) => startAgain(end));
      const ended = (cause: KeySessionEnd['cause'], error?: unknown) => {
        if (over) return;
        over = true;
        renewal.stop();
        onSessionEnded({ cause, openedAt, endedAt: Date.now(), error });
      };

      const renewal = keepRenewed({
        plugin,
        agent: client.agent,
        url,
        session,
        // Read by `connection` below on each use. The client the ports hold takes it too (`Ad4mClient.setToken`): every later call and
        // the next socket go out with it, so a reconnect after the first token expired opens.
        onToken: (renewed) => {
          token = renewed;
          client.setToken(renewed);
        },
        onExpired: (error) => ended('expired', error),
      });

      // The executor refusing the client's token (a 401, or the socket closed for auth): the client
      // the ports hold fails every call from then on, so this session is over.
      const unwatch = client.onAuthFailed((reason) => ended('refused', reason));

      return {
        client,
        ports: createAd4mBackendPorts(client, ctx, {
          // The operator's own identity logs in with the operator role; anyone else's is a session
          // on the agent that speaks for them, which is not somebody who runs the node.
          administersNode: session.role === 'operator',
          capabilities: capabilitiesFromToken(token),
          linkServerUrl: (weSeed.ad4m as { linkServerUrl?: string }).linkServerUrl,
          connection: () => ({ url, token }),
          // The master key, the devices and their requests: the phone keeps the key behind its
          // biometric, and runs each change on its identity page.
          custody: phoneCustodyHost(plugin, deps.nav ?? browserNav),
        }),
        // Ends the session here and forgets the executor, so the next boot asks rather than
        // logging straight back in. The device key stays this phone's.
        disconnect: async () => {
          over = true;
          renewal.stop();
          unwatch();
          rememberKeyHost(null);
          try {
            await client.agent.logout();
          } catch (error) {
            console.warn('[WE] Logging out of the key session failed:', error);
          }
          client.close();
        },
        connection: { port: portOf(url), token, url },
      };
    },
  };
}
