/**
 * Which node a guest tab is on, kept for the life of the tab and nothing longer.
 *
 * A guest link (`/join/<space>?host=<url>`) boots the guest connector, and `BootController` then
 * rewrites the URL to `/space/<id>`: the next load of the same tab carries no host, so without a
 * marker it would take Coasys Connect and ask a guest to link a browser. `sessionStorage` holds the
 * host for the tab (it is gone with it, and a new tab starts from the link or from Connect).
 *
 * It is the host's address and no token: sessions live in memory only, and the guest connector logs
 * in again with the account it keeps per host.
 */
const GUEST_HOST_KEY = 'we-guest-host';

/** The storage of this tab; an unreadable one (some privacy settings throw) holds nothing. */
function tabStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** The host this tab is a guest on, or null. */
export function storedGuestHost(): string | null {
  try {
    return tabStorage()?.getItem(GUEST_HOST_KEY) || null;
  } catch {
    return null;
  }
}

/** Marks this tab as a guest on `hostUrl`. */
export function rememberGuestHost(hostUrl: string): void {
  try {
    tabStorage()?.setItem(GUEST_HOST_KEY, hostUrl);
  } catch {
    // A tab that cannot remember is a tab whose reload asks Connect again.
  }
}

/** Ends the mark: the tab is nobody's guest. */
export function forgetGuestHost(): void {
  try {
    tabStorage()?.removeItem(GUEST_HOST_KEY);
  } catch {
    // Nothing was kept.
  }
}
