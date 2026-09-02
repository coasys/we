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

/**
 * The one third-party host the app genuinely loads code from.
 *
 * `@we/module-globe` sets `CESIUM_BASE_URL` to jsDelivr and pulls Cesium's workers, wasm, widget
 * CSS and images from there at runtime — "Uses CDN for all Cesium assets (no local bundling
 * required)", as its own header says. So this is not a policy choice, it is a dependency the code
 * already has; the CSP can only decide whether it is *named*. Naming it is strictly better than the
 * blanket `https:` the alternative would need, and it makes the cost visible: bundling Cesium
 * locally would remove the last host that can run script in WE's origin.
 */
const CESIUM_CDN = 'https://cdn.jsdelivr.net';

/**
 * Map tiles, over cleartext, because Cesium asks for them that way.
 *
 * Cesium's Bing provider chooses the tile protocol from the page it is running in:
 *
 *     n = options.tileProtocol ?? (document.location.protocol === 'http:' ? 'http' : 'https')
 *
 * WE is served from `http://localhost`, and Cesium Ion's world-imagery asset resolves to Bing,
 * forwarding its endpoint options (`key`, `url`, `mapStyle`) straight through — none of which is
 * `tileProtocol`. So Cesium asks Bing's metadata endpoint for `http` URLs and gets
 * `http://ecn.{subdomain}.tiles.virtualearth.net/…` back. Blocked, the globe renders as a blue
 * sphere with no surface.
 *
 * Named narrowly rather than opening `http:` wholesale, because a blanket cleartext allowance is a
 * general-purpose exfiltration channel and this is one vendor's tile CDN.
 *
 * **This entry is a symptom.** Requesting map tiles over cleartext leaks which tiles a user is
 * looking at — where on Earth they are looking — to anyone on the network, and lets them replace
 * what is shown. The CSP only made an existing defect visible. Two real fixes, either of which
 * retires this line: serve the app over https so Cesium mirrors *that*, or give the globe a base
 * layer built with `tileProtocol: 'https'` instead of Ion's default.
 */
const BING_TILES = 'http://*.tiles.virtualearth.net';

/**
 * The Content-Security-Policy for WE's own documents.
 *
 * Defence in depth rather than the primary control: `sanitiseCss` already strips a theme's beacons
 * and `safeHref` its `javascript:` links. Both are code that could have a hole in it, and this is
 * enforced by the browser regardless of what that code decided.
 *
 * One clause does something nothing else in the codebase does — `frame-ancestors 'none'` is what
 * stops WE itself being framed inside somebody else's page and click-jacked.
 */
export function contentSecurityPolicy({ dev = false, origins = [] } = {}) {
  const connect = [...origins].join(' ');

  return [
    "default-src 'self'",
    /*
      Inline styles are how the design system works — every DS prop resolves to one, and a theme's
      sanitised CSS is injected as a <style> tag — and neither has a nonce path through Lit's
      adoptedStyleSheets. `unsafe-inline` for *styles* is the known-acceptable relaxation, and what
      makes it acceptable is that `sanitiseCss` has already removed what a stylesheet could do with
      it. For scripts it would not be acceptable, and is not granted outside dev.
    */
    `style-src 'self' 'unsafe-inline' ${CESIUM_CDN}`,
    /*
      `blob:` is a requirement rather than a loophole: the transcribe module compiles its
      AudioWorklet from a Blob URL, and worklet module loading is governed by script-src. Dev adds
      what Vite's HMR needs; a production build needs neither, which is why the two are written
      apart — so the strict one is what ships.
    */
    /*
      `'wasm-unsafe-eval'` is what lets WebAssembly compile, and it is a *narrower* grant than its
      name suggests: it permits `WebAssembly.instantiate` and nothing else — no `eval`, no `new
      Function`. Without it, `script-src` governs WASM too, and Cesium's meshoptimizer, Draco,
      Basis, zip and splat modules all fail with "Refused to compile or instantiate WebAssembly
      module" the moment the globe chunk loads. Dev needs no separate clause: `'unsafe-eval'`
      already covers WASM.
    */
    dev
      ? `script-src 'self' blob: ${CESIUM_CDN} 'unsafe-eval' 'unsafe-inline'`
      : `script-src 'self' blob: ${CESIUM_CDN} 'wasm-unsafe-eval'`,
    `worker-src 'self' blob: ${CESIUM_CDN}`,
    // `data:` covers the bundled icon set; `blob:` the object URL for a picked image before it is
    // uploaded; `https:` the avatars, thumbnails and map tiles a post or a template can point at.
    // Same story as `connect-src`: the tiles arrive as images too, over the protocol Cesium asked for.
    `img-src 'self' data: blob: https: ${BING_TILES}`,
    // No font CDN: the three webfaces are vendored into `@we/tokens` and served from our own origin.
    // `data:` is for the retro theme, which carries VT323 inline.
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    `connect-src 'self' blob: ${connect} ws://localhost:* http://localhost:* https: ${BING_TILES}`,
    // Embedded apps, and the embeds a post can contain. Not 'none': `we-iframe` is a product
    // feature, and what makes an embed safe is the origin gate in `appBridge`, not this.
    "frame-src 'self' https: http://localhost:*",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
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
