/**
 * Guest connector — connects to a hosted AD4M node with auto-generated credentials.
 *
 * Uses `Ad4mConnect.connectAsGuest()` from `@coasys/ad4m-connect/core` to skip the auth UI
 * entirely. A guest arrives via a URL (`/join/<spaceId>?host=<hostUrl>`), gets an identity
 * auto-created on the target node, and lands directly in the space. Credentials persist in
 * localStorage so refreshing the page re-uses the same guest account.
 *
 * Paired with the normal `webPlatform` adapter — only the backend connector changes.
 *
 * What a guest link *is* — the URL shape, and which hosts are acceptable — lives in
 * `@we/app-shell/shared`'s `guestLink`, alongside the builder that writes one, so the two cannot
 * drift. This module is only the AD4M half.
 */
import Ad4mConnect from '@coasys/ad4m-connect/core';
import type { BackendConnector, BackendInitResult, GuestJoinTarget } from '@we/app-shell/shared';
import { parseGuestLink } from '@we/app-shell/shared';
import { capabilitiesFromToken, createAd4mBackendPorts } from '@we/backend-ad4m';

export type { GuestJoinTarget };
export { hasStoredSession } from './storedSession';

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
          url: window.location.origin,
          iconPath: 'https://avatars.githubusercontent.com/u/34165012',
        },
        url: hostUrl,
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
      const capabilities = capabilitiesFromToken(core.token);

      return {
        client,
        // This identity was created by the link, not chosen. See `BackendInitResult.guest`.
        guest: true,
        ports: createAd4mBackendPorts(client, ctx, {
          administersNode: false,
          capabilities,
        }),
        // Ending the session forgets the token and the host choice.
        disconnect: () => core.disconnect(),
        ...(core.token ? { connection: { port: core.port, token: core.token, url: core.baseUrl } } : {}),
      };
    },
  };
}
