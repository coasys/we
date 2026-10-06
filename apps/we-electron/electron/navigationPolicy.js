/**
 * Which origins this window treats as itself, and what happens to everything else.
 *
 * Separated from `main.js` so it can be tested without Electron. That is not a tidiness argument:
 * these four functions are the whole of the host's answer to "a page WE did not write is trying to
 * do something", and until they had tests the answer was whatever the last edit left behind.
 *
 * The list is read from the generated seed port map rather than hardcoded, so a deployment that
 * embeds different apps does not have to edit the host, and one that embeds none gets a shorter
 * list for free.
 */

/** Origins allowed to load in this window, hold media permissions, and receive navigation. */
export function trustedOrigins({ appUrl, seedPorts = {}, launcherPort = 9080 } = {}) {
  const origins = new Set();
  const add = (url) => {
    const origin = safeOrigin(url);
    if (origin) origins.add(origin);
  };

  add(appUrl);
  // The bundled app server, which is also `appUrl` in production. Added unconditionally so a dev
  // run — where `appUrl` is Vite's — still trusts the launcher served alongside it.
  add(`http://localhost:${launcherPort}`);

  // The seed's embedded apps, by the port the build assigned each. `electronPlatform` resolves
  // embed URLs from this same file, so the host trusts exactly the origins the app will load
  // rather than a second list that drifts from it.
  for (const port of Object.values(seedPorts)) add(`http://localhost:${port}`);

  return origins;
}

export function isTrusted(url, origins) {
  const origin = safeOrigin(url);
  return origin !== null && origins.has(origin);
}

/**
 * Whether a URL is one we would hand to the user's browser.
 *
 * Only http and https. A `file:` link would open something on their disk and an OS-registered
 * scheme would launch another application, neither of which is a thing a page inside WE should be
 * able to cause by being clicked — and `shell.openExternal` will happily do both.
 */
export function isExternallyOpenable(url) {
  const protocol = safeProtocol(url);
  return protocol === 'http:' || protocol === 'https:';
}

/** A URL's origin, or null when it does not parse — so callers can test rather than try/catch. */
export function safeOrigin(url) {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/** A URL's protocol, or '' when it does not parse. */
export function safeProtocol(url) {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}

/** Permissions the app may hold: the camera, the microphone, the screen. Nothing else. */
export const MEDIA_PERMISSIONS = ['media', 'camera', 'microphone', 'display-capture', 'mediaKeySystem'];

/**
 * Which origin a permission request is really coming from.
 *
 * Electron offers up to three answers and which are populated depends on the permission, the
 * Electron version, and whether the frame is the main one — `securityOrigin` for media,
 * `requestingUrl` generally, and the WebContents' own URL as a last resort. Taking the first
 * *non-empty* one matters: `??` alone would accept an empty string and then judge it, and an empty
 * origin is refused by every check here.
 */
export function permissionOrigin(details, webContentsUrl) {
  const candidates = [details?.securityOrigin, details?.requestingUrl, webContentsUrl];
  return candidates.find((value) => typeof value === 'string' && value.length > 0) ?? null;
}

/**
 * Whether to grant a media permission.
 *
 * The origin check is what stops a page embedded from a post turning on the camera — `we-iframe`
 * renders arbitrary embed URLs, and a permission granted to the window is granted to every frame in
 * it. Everything outside `MEDIA_PERMISSIONS` is refused outright, so notifications, geolocation, MIDI
 * and whatever Chromium adds next are denied by omission rather than by an ever-growing blocklist.
 *
 * The `isMainFrame` fallback is the part worth explaining. Chromium does not always attribute a
 * permission *check* to a frame — `webContents` may be null and the origin empty — and refusing
 * those outright means the app's own camera silently stops working with nothing logged, which is a
 * worse failure than the one being prevented. The main frame is WE by construction: `will-navigate`
 * forbids it becoming anything else, so an unattributed check there is ours. An unattributed
 * *subframe* is still refused, which is where an embed would be.
 */
export function allowMediaPermission({ permission, origin, isMainFrame, origins }) {
  if (!MEDIA_PERMISSIONS.includes(permission)) return false;
  if (origin) return isTrusted(origin, origins);
  return isMainFrame === true;
}
