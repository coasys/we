/**
 * The host's answer to "a page WE did not write is trying to do something".
 *
 * These are the decisions that were previously not made at all: the window had no
 * `setWindowOpenHandler`, no `will-navigate` guard, no CSP, and `webSecurity: false`. Each case
 * below is one of those gaps, and the reason each matters is that WE renders `we-iframe` from post
 * content — an EmbedBlock's URL, a video embed — so the untrusted page is not hypothetical.
 */
import { describe, expect, it } from 'vitest';

import {
  allowMediaPermission,
  contentSecurityPolicy,
  isExternallyOpenable,
  isTrusted,
  permissionOrigin,
  safeOrigin,
  trustedOrigins,
} from './navigationPolicy.js';

const origins = trustedOrigins({ appUrl: 'http://localhost:9080', seedPorts: { flux: 8080 } });

describe('which origins the window treats as itself', () => {
  it('trusts where the app is served from', () => {
    expect(isTrusted('http://localhost:9080/space/abc', origins)).toBe(true);
  });

  it('trusts an embedded app at the port the build assigned it', () => {
    expect(isTrusted('http://localhost:8080/', origins)).toBe(true);
  });

  it('trusts the launcher even when the app is served by Vite', () => {
    const dev = trustedOrigins({ appUrl: 'http://localhost:5173', seedPorts: {} });
    expect(isTrusted('http://localhost:9080/', dev)).toBe(true);
    expect(isTrusted('http://localhost:5173/', dev)).toBe(true);
  });

  it('does not trust a different port on the same host', () => {
    // The executor is on localhost too. "localhost" is not an origin.
    expect(isTrusted('http://localhost:12000/graphql', origins)).toBe(false);
  });

  it('does not trust anywhere else', () => {
    expect(isTrusted('https://attacker.example/', origins)).toBe(false);
    expect(isTrusted('file:///etc/passwd', origins)).toBe(false);
  });

  it('does not trust a URL it cannot parse', () => {
    expect(isTrusted('not a url', origins)).toBe(false);
    expect(isTrusted(undefined, origins)).toBe(false);
  });

  it('trusts nothing extra when the seed names no apps', () => {
    const bare = trustedOrigins({ appUrl: 'http://localhost:9080' });
    expect(bare.has('http://localhost:8080')).toBe(false);
  });

  it('ignores a malformed entry rather than throwing', () => {
    expect(() => trustedOrigins({ appUrl: 'nonsense://', seedPorts: { x: 'not-a-port' } })).not.toThrow();
  });
});

describe('what may be handed to the user browser', () => {
  it('opens http and https', () => {
    expect(isExternallyOpenable('https://example.com')).toBe(true);
    expect(isExternallyOpenable('http://example.com')).toBe(true);
  });

  it('refuses a scheme that would open a file or launch another application', () => {
    // `shell.openExternal` will happily do both, and a page inside WE should not be able to cause
    // either by being clicked.
    expect(isExternallyOpenable('file:///etc/passwd')).toBe(false);
    expect(isExternallyOpenable('ms-msdt:/id')).toBe(false);
    expect(isExternallyOpenable('javascript:alert(1)')).toBe(false);
    expect(isExternallyOpenable('not a url')).toBe(false);
  });
});

describe('the content security policy', () => {
  const production = contentSecurityPolicy({ dev: false, origins });
  const development = contentSecurityPolicy({ dev: true, origins });

  it('refuses to let WE be framed by anybody', () => {
    // The one clause with no counterpart anywhere in application code.
    expect(production).toContain("frame-ancestors 'none'");
  });

  it('does not permit eval in a shipped build', () => {
    // Matched as a standalone source expression rather than a substring: `'wasm-unsafe-eval'`
    // contains "unsafe-eval", so `not.toContain('unsafe-eval')` would read the WASM grant as an
    // eval grant and fail on a policy that is in fact correct.
    const sources = production
      .split('; ')
      .find((d) => d.startsWith('script-src'))
      .split(' ');
    expect(sources).not.toContain("'unsafe-eval'");
    expect(development).toContain("'unsafe-eval'");
  });

  it('permits WebAssembly, which Cesium needs to load at all', () => {
    // script-src governs WASM compilation too, so without this every Cesium module that ships a
    // .wasm (meshoptimizer, Draco, Basis, zip, splats) throws on import — and a rejected chunk
    // import takes app boot down with it, not just the globe.
    const sources = production
      .split('; ')
      .find((d) => d.startsWith('script-src'))
      .split(' ');
    expect(sources).toContain("'wasm-unsafe-eval'");
  });

  it('does not permit inline script in a shipped build', () => {
    const scriptSrc = production.split('; ').find((d) => d.startsWith('script-src'));
    expect(scriptSrc).not.toContain('unsafe-inline');
  });

  it('permits blob: script, which the transcribe AudioWorklet needs', () => {
    // Worklet module loading is governed by script-src, so a bare 'self' silently kills
    // transcription — the kind of breakage nobody traces back to a CSP.
    const scriptSrc = production.split('; ').find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toContain('blob:');
    expect(production).toContain("worker-src 'self' blob:");
  });

  it('permits inline style, which is how every design-system prop resolves', () => {
    const styleSrc = production.split('; ').find((d) => d.startsWith('style-src'));
    expect(styleSrc).toContain("'unsafe-inline'");
  });

  it('still allows embedding, because we-iframe is a product feature', () => {
    expect(production).toContain('frame-src');
    expect(production.split('; ').find((d) => d.startsWith('frame-src'))).toContain('https:');
  });

  it('lets the app reach its own executor', () => {
    const connectSrc = production.split('; ').find((d) => d.startsWith('connect-src'));
    expect(connectSrc).toContain('ws://localhost:*');
    expect(connectSrc).toContain('http://localhost:*');
  });

  it('needs no font CDN, because the webfaces are vendored', () => {
    /*
      The regression this pair of tests exists for. The first CSP blocked
      `fonts.googleapis.com`, which is where `--we-font-family-base` (DM Sans) came from — so the
      entire interface silently fell back to `sans-serif`. The fix was to vendor the faces into
      `@we/tokens` rather than to open the policy, which is also what makes the app render correctly
      with no network at all.
    */
    const fontSrc = production.split('; ').find((d) => d.startsWith('font-src'));
    expect(fontSrc).toBe("font-src 'self' data:");
  });

  it('names the Cesium CDN, which the globe genuinely loads code from', () => {
    // The other half of the same regression: `CESIUM_BASE_URL` points at jsDelivr and Cesium pulls
    // its workers, wasm and widget CSS from there. Naming the host is the honest reading — the
    // dependency is real — and it is far narrower than the blanket `https:` it would otherwise need.
    expect(production.split('; ').find((d) => d.startsWith('script-src'))).toContain('https://cdn.jsdelivr.net');
    expect(production.split('; ').find((d) => d.startsWith('worker-src'))).toContain('https://cdn.jsdelivr.net');
    expect(production.split('; ').find((d) => d.startsWith('style-src'))).toContain('https://cdn.jsdelivr.net');
  });

  it('allows cleartext only to the map tile host, not in general', () => {
    /*
      Cesium's Bing provider takes the tile protocol from `document.location.protocol`, and WE is
      served from http://localhost — so it asks Bing for `http://…tiles.virtualearth.net/…` and the
      globe renders as a bare blue sphere without them. Verified against Chrome: this entry admits
      that URL while cleartext to any other host, including a `…virtualearth.net.attacker.example`
      lookalike, stays refused.
    */
    const connectSrc = production.split('; ').find((d) => d.startsWith('connect-src'));
    expect(connectSrc).toContain('http://*.tiles.virtualearth.net');
    expect(connectSrc).not.toMatch(/(^|\s)http:(\s|$)/);

    // The tiles arrive as images as well as through fetch, so img-src needs the same entry.
    expect(production.split('; ').find((d) => d.startsWith('img-src'))).toContain('http://*.tiles.virtualearth.net');
  });

  it('shuts the doors nothing here needs', () => {
    expect(production).toContain("object-src 'none'");
    expect(production).toContain("base-uri 'self'");
    expect(production).toContain("form-action 'self'");
  });
});

describe('safeOrigin', () => {
  it('answers null rather than throwing, so callers can branch', () => {
    expect(safeOrigin('not a url')).toBeNull();
    expect(safeOrigin('')).toBeNull();
    expect(safeOrigin(undefined)).toBeNull();
    expect(safeOrigin('https://a.example/b?c#d')).toBe('https://a.example');
  });
});

describe('media permissions', () => {
  const origins = trustedOrigins({ appUrl: 'http://localhost:9080', seedPorts: { flux: 8080 } });
  const decide = (over) =>
    allowMediaPermission({ permission: 'media', origin: null, isMainFrame: false, origins, ...over });

  it('grants the camera to the app', () => {
    expect(decide({ origin: 'http://localhost:9080/space/abc' })).toBe(true);
  });

  it('grants it to a registered embedded app', () => {
    expect(decide({ origin: 'http://localhost:8080/' })).toBe(true);
  });

  it('refuses a page embedded from a post', () => {
    // The finding: a permission granted to the window is granted to every frame in it, and
    // `we-iframe` renders arbitrary embed URLs out of post content.
    expect(decide({ origin: 'https://attacker.example/' })).toBe(false);
    expect(decide({ origin: 'https://attacker.example/', isMainFrame: true })).toBe(false);
  });

  it('refuses everything that is not camera, microphone or screen', () => {
    for (const permission of ['notifications', 'geolocation', 'midi', 'clipboard-read', 'something-new']) {
      expect(decide({ permission, origin: 'http://localhost:9080/' })).toBe(false);
    }
  });

  it('grants an unattributable check on the main frame, and refuses one in a subframe', () => {
    /*
      Chromium does not always attribute a permission *check* to a frame: `webContents` can be null
      and the origin empty. Refusing those outright means the app's own camera stops working with
      nothing logged — a worse failure than the one being prevented — and the main frame is WE by
      construction, since `will-navigate` forbids it becoming anything else. A subframe with no
      origin is still refused, because that is where an embed would be.
    */
    expect(decide({ origin: null, isMainFrame: true })).toBe(true);
    expect(decide({ origin: null, isMainFrame: false })).toBe(false);
    expect(decide({ origin: null, isMainFrame: undefined })).toBe(false);
  });
});

describe('which origin a permission request is attributed to', () => {
  it('prefers the most specific answer Electron gives', () => {
    expect(permissionOrigin({ securityOrigin: 'https://a.example', requestingUrl: 'https://b.example' })).toBe(
      'https://a.example',
    );
    expect(permissionOrigin({ requestingUrl: 'https://b.example' }, 'https://c.example')).toBe('https://b.example');
    expect(permissionOrigin({}, 'https://c.example')).toBe('https://c.example');
  });

  it('skips empty strings rather than judging them', () => {
    // `??` alone would accept '' and then refuse it — which is how a working camera turns off.
    expect(permissionOrigin({ securityOrigin: '', requestingUrl: '' }, 'https://c.example')).toBe('https://c.example');
    expect(permissionOrigin({}, '')).toBeNull();
    expect(permissionOrigin(undefined, undefined)).toBeNull();
  });
});
