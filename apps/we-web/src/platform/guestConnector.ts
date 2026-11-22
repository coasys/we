/**
 * Guest connector — connects to a hosted AD4M node with auto-generated credentials.
 *
 * Uses `Ad4mConnect.connectAsGuest()` from `@coasys/connect/core` to skip the Connect frame
 * entirely. A guest arrives via a URL (`/join/<spaceId>?host=<hostUrl>`), gets an identity
 * auto-created on the target node, and lands directly in the space. The account's credentials
 * persist in localStorage (scoped to the host) and the host is marked for the tab
 * (`storedSession`), so refreshing the page logs in as the same guest. The token stays in memory.
 *
 * Paired with the normal `webPlatform` adapter — only the backend connector changes.
 *
 * What a guest link *is* — the URL shape, and which hosts are acceptable — lives in
 * `@we/app-shell/shared`'s `guestLink`, alongside the builder that writes one, so the two cannot
 * drift. This module is only the AD4M half.
 */
import Ad4mConnect from '@coasys/connect/core';
import type { BackendConnector, BackendInitResult, GuestJoinTarget } from '@we/app-shell/shared';
import { parseGuestLink } from '@we/app-shell/shared';
import { capabilitiesFromToken, createAd4mBackendPorts } from '@we/backend-ad4m';
import weSeed from '@we/seed-file';

import { APP_ENDPOINTS, APP_ID } from './endpoints';
import { forgetGuestHost, rememberGuestHost } from './storedSession';

export type { GuestJoinTarget };
export { storedGuestHost } from './storedSession';

/**
 * Read guest parameters from the current URL.
 *
 * Returns `null` when the URL does not match the guest pattern, or names a host this app will not
 * open a session against — either way the entry point falls through to the normal connector.
 */
export function parseGuestParams(): GuestJoinTarget | null {
  return parseGuestLink(window.location.href);
}

/**
 * Build a `BackendConnector` that authenticates as a guest on `hostUrl`.
 *
 * The connector creates an `Ad4mConnect` instance directly (no connect UI), calls
 * `connectAsGuest`, and returns the same `BackendInitResult` shape the normal connector does.
 * A guest never administers the node — `administersNode` stays `false`.
 */
export function createGuestConnector(hostUrl: string): BackendConnector {
  return {
    async initialize(ctx): Promise<BackendInitResult> {
      const core = new Ad4mConnect({
        appInfo: {
          name: 'WE',
          description: 'Social media for the new internet',
          iconPath: 'https://avatars.githubusercontent.com/u/34165012',
        },
        appId: APP_ID,
        endpoints: { authDomain: APP_ENDPOINTS.identityOrigin },
        /*
          Required by the options type and unread on this path: `connectAsGuest` creates an account
          and logs in, where the ordinary flow asks for a capability grant. So what the guest holds
          is whatever the node hands a logged-in user — asking for less here would not narrow it.
          `administersNode: false` below is likewise this app declining to *offer* node-wide
          controls, not the executor refusing them. Scoping a guest's grant is a node-side question,
          and an open one — see the PR's out-of-scope list.
        */
        capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
      });

      const client = await core.connectAsGuest(hostUrl);
      rememberGuestHost(hostUrl);
      const capabilities = capabilitiesFromToken(core.token);

      return {
        client,
        // This identity was created by the link, not chosen. See `BackendInitResult.guest`.
        guest: true,
        ports: createAd4mBackendPorts(client, ctx, {
          administersNode: false,
          // A guest logs in to a grant, never the node's operator credential.
          operator: false,
          capabilities,
          linkServerUrl: (weSeed.ad4m as { linkServerUrl?: string }).linkServerUrl,
          connection: () => (core.baseUrl ? { url: core.baseUrl, token: core.token } : null),
        }),
        // Ending the session forgets the token and the tab's guest mark.
        disconnect: async () => {
          forgetGuestHost();
          await core.disconnect();
        },
        ...(core.token ? { connection: { port: core.port, token: core.token, url: core.baseUrl } } : {}),
      };
    },
  };
}
