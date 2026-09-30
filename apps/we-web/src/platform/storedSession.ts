/**
 * Does this browser already hold somebody's real AD4M session?
 *
 * Split out from `guestConnector` and importing nothing, so the one decision that stands between a
 * guest link and an agent's existing identity can be tested without an executor, a connect client
 * or a DOM. It reads localStorage and answers a question; that is the whole module.
 */

/*
  The three keys ad4m-connect writes, named without their prefix.

  Read here, never written — this module does not manage them, it only asks what is there.
*/
const AD4M_TOKEN_KEY = 'ad4m-token';
const AD4M_URL_KEY = 'ad4m-url';

/** Mirrors ad4m-connect's own normalisation, so the marker below is looked up under the key it wrote. */
function guestMarkerKey(hostUrl: string): string {
  return `ad4m-guest-email-${hostUrl.replace(/\/+$/, '').toLowerCase()}`;
}

/**
 * Everything in localStorage, as pairs. Throws outright in some privacy configurations, and an
 * unreadable store holds nothing.
 */
function localEntries(): [string, string][] {
  try {
    // `length` and `key(i)` rather than `Object.keys` — the indexed form is the Storage interface
    // proper, where enumerating own properties happens to work only because localStorage is an
    // exotic object.
    const out: [string, string][] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null) out.push([key, localStorage.getItem(key) ?? '']);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The prefix `key` carries, if it is `suffix` under one — `''` for a bare key, `'0.13.0/'` for a
 * namespaced one, and `null` when it is some other key entirely.
 *
 * ## Why this is not just `localStorage.getItem('ad4m-token')`
 *
 * It was, and that is what made the check below dead code. ad4m-connect namespaces every key it
 * writes with its own package version — `setLocal` writes `` `${version}/${key}` `` — and has done
 * since April 2023. So the unprefixed spelling matched nothing in any browser, `hasStoredSession`
 * returned `false` for everyone, and the branch that stops a guest link replacing a real session
 * never ran once.
 *
 * Reading the version back to rebuild the exact key would restore the bug the day ad4m-connect is
 * upgraded, which is precisely how it arrived. Matching on the suffix instead means the check
 * cannot be broken by a version bump, and it also finds a session left by an *older* version —
 * still somebody's identity, and still not ours to overwrite.
 */
function prefixOf(key: string, suffix: string): string | null {
  if (key === suffix) return '';
  return key.endsWith(`/${suffix}`) ? key.slice(0, key.length - suffix.length) : null;
}

/**
 * Whether this browser already holds a session that is somebody's actual identity.
 *
 * `connectAsGuest` writes `ad4m-token` and `ad4m-url` — the two keys *every* boot reads — so it does
 * not add a guest session beside an existing one, it replaces it. An agent who had signed in here
 * and then clicked a guest link would come back on their next visit as the guest, on the inviter's
 * node, with no sign that anything had happened and no prompt to get back. The entry point uses
 * this to decline the guest path in that case.
 *
 * A token belonging to a guest does not count: `connectAsGuest` records one per host under
 * `ad4m-guest-email-<host>`, so a stored url with a matching marker is a throwaway identity this
 * same flow created, and there is nothing there to protect.
 *
 * The url and the marker are read under the *same* prefix as the token that named them. Mixing
 * prefixes would let a real session under one version be excused by a guest marker under another.
 */
/**
 * The host this browser holds a **guest** session on, or null.
 *
 * ## Why a reload needs to be able to ask
 *
 * `BackendInitResult.guest` is set once, by the guest connector, and never persisted — so the flag
 * lasts exactly as long as the tab. `BootController` then rewrites the URL to `/space/<id>`, and
 * the next load takes the ordinary connector, which knows nothing about guests. A reloaded guest
 * became an ordinary local user: the name prompt reappeared every launch with the wrong sentence
 * ("your account was set up outside WE" — it was not, this app made it minutes ago), they could
 * never see whose node they were on, and `administersNode` rested entirely on the executor
 * answering `isMultiUser` honestly.
 *
 * The marker is already on disk. `connectAsGuest` writes `ad4m-guest-email-<host>` per host, and
 * `ad4m-url` says which host the live session is against — so "is this session a guest's" is
 * answerable from what is there, with nothing new to persist and nothing to keep in sync.
 *
 * The inverse of {@link hasStoredSession}, and deliberately built from the same parts: one of them
 * being wrong about what a guest session looks like while the other is right is the failure worth
 * designing out.
 */
export function storedGuestHost(): string | null {
  const entries = localEntries();
  const read = (key: string): string | null => entries.find(([k]) => k === key)?.[1] || null;

  for (const [key, token] of entries) {
    const prefix = prefixOf(key, AD4M_TOKEN_KEY);
    if (prefix === null || !token) continue;
    const url = read(`${prefix}${AD4M_URL_KEY}`);
    if (url && read(`${prefix}${guestMarkerKey(url)}`)) return url;
  }
  return null;
}

export function hasStoredSession(): boolean {
  const entries = localEntries();
  const read = (key: string): string | null => entries.find(([k]) => k === key)?.[1] || null;

  for (const [key, token] of entries) {
    const prefix = prefixOf(key, AD4M_TOKEN_KEY);
    if (prefix === null || !token) continue;
    const url = read(`${prefix}${AD4M_URL_KEY}`);
    if (!url || !read(`${prefix}${guestMarkerKey(url)}`)) return true;
  }
  return false;
}
