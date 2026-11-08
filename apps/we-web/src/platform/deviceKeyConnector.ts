/**
 * The phone's connector: a key login to the executor it was told to use, when it can; otherwise
 * the ordinary one.
 *
 * Inside the phone app, with the `DeviceKey` plugin holding a device key that an identity's log
 * lists, and an executor URL set ({@link readKeyHost}), WE logs in to that executor with the
 * device key (`keySession.ts`) instead of asking for an email and password. Anywhere else — a
 * browser, a desktop shell, a phone that has not joined an identity — this is `fallback`, the
 * connector WE uses today, unchanged.
 *
 * The connection itself is ad4m-connect's, as every other connector's is: the key login's token is
 * handed to an `Ad4mConnect` and its own `connect()` opens the client, checks the session and
 * watches it. So the rest of WE sees the same `core` and the same client whichever way the session
 * was opened. The token is not written to localStorage; every boot logs in afresh.
 *
 * A session that ends by itself — the renewal ran out of time, or the executor refused the token —
 * is not left as an app whose calls all fail: by default WE starts again ({@link startAgain}),
 * which logs in afresh or, failing that, shows the connect screen.
 */
import { Ad4mClient } from '@coasys/ad4m';
import Ad4mConnect from '@coasys/ad4m-connect/core';
import type { BackendConnector, BackendInitResult } from '@we/app-shell/shared';
import { capabilitiesFromToken, createAd4mBackendPorts } from '@we/backend-ad4m';
import weSeed from '@we/seed-file';

import { type DeviceKeyPlugin, deviceKeyPlugin } from './deviceKey';
import { readKeyHost, rememberKeyHost } from './keyHost';
import { keepRenewed, type KeySessionApp, loginWithDeviceKey } from './keySession';

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
}

const defaultDeps: DeviceKeyConnectorDeps = { plugin: () => deviceKeyPlugin(), keyHost: () => readKeyHost() };

/** The tab's note that its last key session ended within {@link TOO_SOON_MS} of opening. */
export const ENDED_TOO_SOON_KEY = 'we-phone/key-session-ended-too-soon';
/** A key session that ends sooner than this after it opened is not logged straight back in to. */
export const TOO_SOON_MS = 60_000;

type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function safeSessionStorage(): TabStorage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * The default answer to a key session that ended: WE starts again, as a boot. A boot logs in
 * afresh with the device key, which asks the person nothing, so a session that expired while the
 * phone slept comes straight back; one the executor will not open again (the key revoked, the
 * executor gone) falls back to the connect screen. Either way the person sees where they stand,
 * rather than an app whose every call fails.
 *
 * A session that ended within a minute of opening is noted first, and the boot after it skips the
 * key login once ({@link takeEndedTooSoon}): an executor that grants a session and then refuses it
 * at once would otherwise restart the app for as long as it was open.
 */
export function startAgain(
  end: KeySessionEnd,
  storage: TabStorage | undefined = safeSessionStorage(),
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

/** Whether the last key session in this tab ended too soon; forgets that it did, so it skips once. */
export function takeEndedTooSoon(storage: TabStorage | undefined = safeSessionStorage()): boolean {
  try {
    if (storage?.getItem(ENDED_TOO_SOON_KEY) == null) return false;
    storage.removeItem(ENDED_TOO_SOON_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hands a renewed token to the live client, where the client can take one.
 *
 * `Ad4mClient.setToken` (ad4m after the pinned dc5964ba4) uses the token for every later call and
 * the next connection. The pinned client has no such method and keeps the token it was built
 * with, so here this answers `false` and the renewal reaches only `core.token` (and what reads it:
 * the ports' `connection()`, an embedded app). Once WE pins an ad4m with `setToken`, this guard
 * becomes a plain `client.setToken(token)`.
 */
export function handRenewedToken(client: unknown, token: string): boolean {
  const live = client as { setToken?: (token: string) => void } | null;
  if (typeof live?.setToken !== 'function') return false;
  live.setToken(token);
  return true;
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
    return status.identity ? { plugin, url } : null;
  } catch (error) {
    console.error('[WE] The DeviceKey plugin did not answer:', error);
    return null;
  }
}

export function createDeviceKeyConnector(
  fallback: BackendConnector,
  deps: DeviceKeyConnectorDeps = defaultDeps,
): BackendConnector {
  return {
    async initialize(ctx): Promise<BackendInitResult> {
      if ((deps.skipKeyLogin ?? takeEndedTooSoon)()) {
        console.warn('[WE] The last key session ended as soon as it opened; showing the connect screen.');
        return fallback.initialize(ctx);
      }
      const target = await keyLoginTarget(deps);
      if (!target) return fallback.initialize(ctx);
      const { plugin, url } = target;

      const core = new Ad4mConnect({ appInfo: APP_INFO, url, capabilities: CAPABILITIES });

      // A challenge and a login need no token: a client of its own, closed once it has answered.
      const anonymous = new Ad4mClient(core.baseUrl);
      let session;
      try {
        session = await loginWithDeviceKey(plugin, anonymous.agent, url, KEY_SESSION_APP);
      } catch (error) {
        // Not known there, unreachable, or refused: the person can still sign in the ordinary way.
        console.error('[WE] The key login was refused; falling back to the connect screen:', error);
        return fallback.initialize(ctx);
      } finally {
        anonymous.close();
      }

      // ad4m-connect's constructor restored whatever password session the connect screen left
      // in localStorage (`ad4m-token`), and `connect()` below writes this executor's URL beside
      // it. Left there, a later boot that falls back to the connect screen would restore the old
      // token with the new URL and send one host's token to another. A key login leaves no
      // password session behind: `disconnect()` removes the stored token (and the hosting
      // state), and nothing else is open yet.
      await core.disconnect();
      core.token = session.token;
      const client = await core.connect();
      if (core.authState !== 'authenticated') {
        throw new Error(`The executor at ${url} did not accept the key session (${core.authState})`);
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
        // Read by `connection` below on each use, and by ad4m-connect when it builds a client.
        // The client the ports hold takes it too, where it can: see `handRenewedToken`.
        onToken: (token) => {
          core.token = token;
          handRenewedToken(client, token);
        },
        onExpired: (error) => ended('expired', error),
      });

      // ad4m-connect watches the client: when the executor refuses its token (a 401, or the socket
      // closed for auth), it drops the token and reports `unauthenticated`. The client the ports
      // hold fails every call from then on, so this session is over.
      core.addEventListener('authstatechange', (event) => {
        if ((event as CustomEvent<string>).detail === 'unauthenticated') ended('refused');
      });

      return {
        client,
        ports: createAd4mBackendPorts(client, ctx, {
          // The operator's own identity logs in with the operator role; anyone else's is a session
          // on the agent that speaks for them, which is not somebody who runs the node.
          administersNode: session.role === 'operator',
          capabilities: capabilitiesFromToken(core.token),
          linkServerUrl: (weSeed.ad4m as { linkServerUrl?: string }).linkServerUrl,
          connection: () => (core.baseUrl ? { url: core.baseUrl, token: core.token } : null),
        }),
        // Ends the session here and forgets the executor, so the next boot asks rather than
        // logging straight back in. The device key stays this phone's.
        disconnect: async () => {
          over = true;
          renewal.stop();
          rememberKeyHost(null);
          try {
            await client.agent.logout();
          } catch (error) {
            console.warn('[WE] Logging out of the key session failed:', error);
          }
          await core.disconnect();
        },
        connection: { port: core.port, token: core.token, url: core.baseUrl },
      };
    },
  };
}
