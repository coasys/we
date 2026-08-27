/**
 * Guest connector — connects to a hosted AD4M node with auto-generated credentials.
 *
 * Uses `Ad4mConnect.connectAsGuest()` from `@coasys/ad4m-connect/core` to skip the auth UI
 * entirely. A guest arrives via a URL (`/join/<spaceId>?host=<hostUrl>`), gets an identity
 * auto-created on the target node, and lands directly in the space. Credentials persist in
 * localStorage so refreshing the page re-uses the same guest account.
 *
 * Paired with the normal `webPlatform` adapter — only the backend connector changes.
 */
import Ad4mConnect from '@coasys/ad4m-connect/core';
import type { BackendConnector, BackendInitResult } from '@we/app-shell/shared';
import { capabilitiesFromToken, createAd4mBackendPorts } from '@we/backend-ad4m';

/** What the entry point parsed from the URL, and what the boot flow needs to act on. */
export interface GuestJoinTarget {
  /** The neighbourhood / shared-space ID to join after auth. */
  spaceId: string;
  /** The AD4M executor URL to connect to. */
  hostUrl: string;
}

/**
 * Read guest parameters from the current URL.
 *
 * Returns `null` when the URL does not match the guest pattern, so the entry point falls through
 * to the normal connector.
 *
 * Accepted formats:
 * - `/join/<spaceId>?host=<hostUrl>` — the canonical guest invite link
 */
export function parseGuestParams(): GuestJoinTarget | null {
  const path = window.location.pathname;
  const match = path.match(/^\/join\/(.+)$/);
  if (!match) return null;

  const spaceId = decodeURIComponent(match[1]);
  const params = new URLSearchParams(window.location.search);
  const hostUrl = params.get('host');

  if (!hostUrl) return null;
  return { spaceId, hostUrl };
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
        hosting: false,
        capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
      });

      const client = await core.connectAsGuest(hostUrl);
      const capabilities = capabilitiesFromToken(core.token);

      return {
        client,
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
