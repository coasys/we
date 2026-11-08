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

/** What the connector needs from the phone and the page; the tests pass their own. */
export interface DeviceKeyConnectorDeps {
  plugin: () => DeviceKeyPlugin | null;
  keyHost: () => string | null;
}

const defaultDeps: DeviceKeyConnectorDeps = { plugin: () => deviceKeyPlugin(), keyHost: () => readKeyHost() };

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

      core.token = session.token;
      const client = await core.connect();
      if (core.authState !== 'authenticated') {
        throw new Error(`The executor at ${url} did not accept the key session (${core.authState})`);
      }

      const renewal = keepRenewed({
        plugin,
        agent: client.agent,
        url,
        session,
        // Read by `connection` below on each use, and by ad4m-connect when it builds a client.
        onToken: (token) => {
          core.token = token;
        },
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
