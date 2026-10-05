/**
 * The Content-Security-Policy WE serves, for every host, from one place.
 *
 * ## What it is for
 *
 * A template is data, installable from a stranger, and two things a template can do had to be closed
 * by the browser rather than by our own code:
 *
 * - **Run code.** The renderer refuses the elements and URLs that would (see `templateElements.ts` in
 *   `@we/schema-shared`); `script-src` without `'unsafe-inline'` is the second layer under that, so a
 *   gap in the first is still refused.
 * - **Send data away.** Data leaves a page only in a request, so a template that builds
 *   `https://attacker.example/?data=…` into an image, a video or a frame is refused here. That is why
 *   `img-src`, `media-src` and `frame-src` name sources instead of allowing `https:` — the one thing
 *   the policy costs is that a template cannot hot-link from anywhere, only from what the deployment
 *   lists.
 *
 * `connect-src` stays broad, and has to: the node's address is chosen at runtime — a local port, a
 * host from the directory, a guest link's host. A template cannot make a request through it, because
 * a request from there takes code. Code that fetches a URL a template hands it is the one way round
 * that, and is fixed where the code is, not here.
 *
 * ## One builder, three hosts
 *
 * Electron sets it as a header on its own documents, from a file its prebuild writes with this
 * builder. The web and Tauri builds get it as a `<meta>` tag from the Vite plugin in `./vite.js`, and
 * Netlify additionally as a header, for `frame-ancestors`, which a meta tag cannot carry. Three copies
 * of a policy drift; one cannot.
 */

/** Cesium's workers, WebAssembly, widget stylesheet and the globe's textures, until they are self-hosted. */
export const CESIUM_CDN = 'https://cdn.jsdelivr.net';

/**
 * Sources every deployment allows, beyond its own origin, `data:` and `blob:`.
 *
 * Each is here because something WE ships loads from it, and none is a host where somebody else can
 * read the requests — which is what would turn an allowed source back into a way to send data away.
 */
export const DEFAULT_SOURCES = Object.freeze({
  images: Object.freeze([
    // The location picker's map tiles.
    'https://*.tile.openstreetmap.org',
    // Hosts' pictures in the directory, and the app's icon, on the connection screen.
    'https://hosting.ad4m.dev',
    'https://avatars.githubusercontent.com',
    // The globe's skybox textures and Cesium's own assets.
    CESIUM_CDN,
    /*
      Cesium ion's imagery, for a deployment that supplies a token. Over http as well, because
      Cesium's Bing provider takes the tile protocol from the page, and the desktop app is served from
      http://localhost — so it asks for `http://ecn.*.tiles.virtualearth.net/…`.

      The cleartext entry is a symptom rather than a choice: tiles over http tell anyone on the
      network where on Earth a person is looking, and let them swap what is shown. Named narrowly
      instead of allowing `http:`, and retired by either serving the app over https or giving the
      globe a base layer built with `tileProtocol: 'https'`.
    */
    'https://*.tiles.virtualearth.net',
    'http://*.tiles.virtualearth.net',
  ]),
  media: Object.freeze([]),
  frames: Object.freeze(['https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com']),
});

/**
 * An origin a deployment may add: https, a host, optionally a leading `*.` and a port. No path, no
 * scheme-only source like `https:`, no bare `*` — each of those would allow everywhere, which is the
 * thing this list exists to stop.
 */
const SOURCE = /^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i;

/**
 * The extra sources a seed asks for, checked.
 *
 * Throws on a malformed one rather than dropping it: a build that quietly ignores a deployment's
 * setting ships an app whose images are broken for no reason anybody can find, and one that accepts
 * `https:` ships one with the protection switched off.
 *
 * The seed's embedded apps are added to `frames` from their `paths.webUrl`, so a deployment that
 * embeds an app does not have to list it twice.
 */
export function seedSources(seed = {}) {
  const declared = seed.contentSecurity ?? {};
  const problems = [];
  const read = (key) => {
    const list = declared[key] ?? [];
    if (!Array.isArray(list)) {
      problems.push(`contentSecurity.${key} must be a list of origins`);
      return [];
    }
    return list.filter((source) => {
      if (typeof source === 'string' && SOURCE.test(source)) return true;
      problems.push(
        `contentSecurity.${key}: "${source}" is not an origin this can allow — use https://host, ` +
          'optionally https://*.host, with no path. A scheme alone or a bare * would allow every site.',
      );
      return false;
    });
  };

  const sources = { images: read('images'), media: read('media'), frames: read('frames') };
  for (const app of seed.apps ?? []) {
    const url = app?.paths?.webUrl;
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) continue;
    try {
      sources.frames.push(new URL(url).origin);
    } catch {
      problems.push(`apps: "${url}" is not a URL`);
    }
  }

  if (problems.length) throw new Error(`[we] the seed's content sources are invalid:\n  ${problems.join('\n  ')}`);
  return sources;
}

/**
 * The policy, as one header value.
 *
 * - `host` — `electron`, `tauri` or `web`. The desktop hosts embed apps from `http://localhost`; Tauri
 *   talks to its own core over `ipc:`.
 * - `dev` — what Vite's dev server needs: inline and evaluated script for its client and HMR. A
 *   production build needs neither, which is why the two are written apart, so the strict one ships.
 * - `meta` — for a `<meta>` tag, which ignores `frame-ancestors` and has the browser warn about it.
 */
export function buildContentSecurityPolicy({ host = 'web', dev = false, seed = {}, meta = false } = {}) {
  const extra = seedSources(seed);
  const desktop = host === 'electron' || host === 'tauri';
  const list = (...parts) => [...new Set(parts.flat())].join(' ');

  return [
    "default-src 'self'",
    /*
      Inline styles are how the design system works — every DS prop resolves to one, and a theme's
      sanitised CSS is injected as a <style> tag — and neither has a nonce path through Lit's
      adoptedStyleSheets. `'unsafe-inline'` for *styles* is the known-acceptable relaxation: it grants
      no script, and a stylesheet's way to reach the network is `url()`, which `img-src` governs.
    */
    `style-src ${list("'self'", "'unsafe-inline'", CESIUM_CDN)}`,
    /*
      `blob:` because the transcribe module compiles its AudioWorklet from a Blob URL and Cesium
      starts its cross-origin workers from one. `'wasm-unsafe-eval'` lets WebAssembly compile and
      nothing else — no `eval`, no `new Function` — which Cesium's decoders need.
    */
    dev
      ? `script-src ${list("'self'", 'blob:', CESIUM_CDN, "'unsafe-eval'", "'unsafe-inline'")}`
      : `script-src ${list("'self'", 'blob:', CESIUM_CDN, "'wasm-unsafe-eval'")}`,
    `worker-src ${list("'self'", 'blob:', CESIUM_CDN)}`,
    // `data:` is how uploaded files are displayed — a node's file storage is read into a data URI —
    // and the bundled icons; `blob:` a picked image before it is uploaded.
    `img-src ${list("'self'", 'data:', 'blob:', DEFAULT_SOURCES.images, extra.images)}`,
    // Vendored webfaces from our own origin; the retro theme carries its face inline.
    "font-src 'self' data:",
    `media-src ${list("'self'", 'data:', 'blob:', DEFAULT_SOURCES.media, extra.media)}`,
    /*
      Broad, because the node's address is chosen at runtime — see the header of this file. `data:`
      because custom-element libraries fetch their own inline icons as data URIs; one is already in
      the page and reaches no server.
    */
    `connect-src ${list(
      "'self'",
      'data:',
      'blob:',
      'https:',
      'wss:',
      'http://localhost:*',
      'ws://localhost:*',
      'http://127.0.0.1:*',
      'ws://127.0.0.1:*',
      'http://*.tiles.virtualearth.net',
      host === 'tauri' ? ['ipc:', 'http://ipc.localhost'] : [],
      // A Tauri dev server can be reached on a LAN address, and its HMR socket with it.
      dev ? ['ws:', 'http:'] : [],
    )}`,
    `frame-src ${list("'self'", DEFAULT_SOURCES.frames, extra.frames, desktop ? 'http://localhost:*' : [])}`,
    "object-src 'none'",
    "base-uri 'self'",
    // A form posts only to us: one that submitted to another site would carry its fields there.
    "form-action 'self'",
    // What stops WE itself being framed inside somebody else's page and click-jacked.
    ...(meta ? [] : ["frame-ancestors 'none'"]),
  ].join('; ');
}
