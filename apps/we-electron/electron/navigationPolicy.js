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
    dev
      ? `script-src 'self' blob: ${CESIUM_CDN} 'unsafe-eval' 'unsafe-inline'`
      : `script-src 'self' blob: ${CESIUM_CDN}`,
    `worker-src 'self' blob: ${CESIUM_CDN}`,
    // `data:` covers the bundled icon set; `blob:` the object URL for a picked image before it is
    // uploaded; `https:` the avatars, thumbnails and map tiles a post or a template can point at.
    "img-src 'self' data: blob: https:",
    // No font CDN: the three webfaces are vendored into `@we/tokens` and served from our own origin.
    // `data:` is for the retro theme, which carries VT323 inline.
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    `connect-src 'self' blob: ${connect} ws://localhost:* http://localhost:* https:`,
    // Embedded apps, and the embeds a post can contain. Not 'none': `we-iframe` is a product
    // feature, and what makes an embed safe is the origin gate in `appBridge`, not this.
    "frame-src 'self' https: http://localhost:*",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
