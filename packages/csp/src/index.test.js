import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy, CESIUM_CDN, seedSources } from './index.js';

/** One directive's sources, as a list — so a substring of one source cannot pass for another. */
function sources(policy, name) {
  const directive = policy.split('; ').find((d) => d.startsWith(`${name} `));
  if (!directive) throw new Error(`no ${name} in: ${policy}`);
  return directive.split(' ').slice(1);
}

const production = buildContentSecurityPolicy({ host: 'electron', dev: false });
const development = buildContentSecurityPolicy({ host: 'electron', dev: true });

describe('the content security policy', () => {
  it('refuses to let WE be framed by anybody, except where a meta tag cannot say so', () => {
    expect(production).toContain("frame-ancestors 'none'");
    // A meta tag ignores frame-ancestors and the browser warns; Netlify's header carries it instead.
    expect(buildContentSecurityPolicy({ host: 'web', meta: true })).not.toContain('frame-ancestors');
  });

  it('does not permit eval or inline script in a shipped build', () => {
    // As a list rather than a substring: `'wasm-unsafe-eval'` contains "unsafe-eval".
    expect(sources(production, 'script-src')).not.toContain("'unsafe-eval'");
    expect(sources(production, 'script-src')).not.toContain("'unsafe-inline'");
    expect(sources(development, 'script-src')).toContain("'unsafe-eval'");
  });

  it('permits WebAssembly, which Cesium needs to load at all', () => {
    // script-src governs WASM compilation too, so without this every Cesium module that ships a
    // .wasm throws on import — and a rejected chunk import takes app boot down with it.
    expect(sources(production, 'script-src')).toContain("'wasm-unsafe-eval'");
  });

  it('permits blob: script and workers, which the transcribe AudioWorklet and Cesium need', () => {
    expect(sources(production, 'script-src')).toContain('blob:');
    expect(sources(production, 'worker-src')).toContain('blob:');
  });

  it('permits inline style, which is how every design-system prop resolves', () => {
    expect(sources(production, 'style-src')).toContain("'unsafe-inline'");
  });

  it('needs no font CDN, because the webfaces are vendored', () => {
    // The first policy blocked Google Fonts, where DM Sans came from, and the whole interface fell
    // back to sans-serif. The fix was to vendor the faces, which also makes the app work offline.
    expect(sources(production, 'font-src')).toEqual(["'self'", 'data:']);
  });

  it('names the Cesium CDN, which the globe genuinely loads code from', () => {
    for (const name of ['script-src', 'worker-src', 'style-src'])
      expect(sources(production, name)).toContain(CESIUM_CDN);
  });

  it('lets the app reach its executor wherever it is, and nothing else in cleartext', () => {
    const connect = sources(production, 'connect-src');
    expect(connect).toEqual(expect.arrayContaining(['https:', 'wss:', 'http://localhost:*', 'ws://localhost:*']));
    // Cleartext only to loopback and Bing's tiles, never in general.
    expect(connect).not.toContain('http:');
    expect(connect).not.toContain('ws:');
    // A custom-element library fetches its own icons as data URIs, which reach no server.
    expect(connect).toContain('data:');
  });

  it('shuts the doors nothing here needs', () => {
    expect(production).toContain("object-src 'none'");
    expect(production).toContain("base-uri 'self'");
    expect(production).toContain("form-action 'self'");
  });
});

describe('where a template could send data', () => {
  /*
    The reason the policy names sources. Data leaves a page only in a request, so these three — the
    requests a template can cause by naming a URL — must not allow every https site, or a template
    that builds `https://attacker.example/?data=…` into an image, a video or a frame sends it there.
  */
  for (const host of ['electron', 'tauri', 'web']) {
    it(`does not let an image, a video or a frame load from anywhere (${host})`, () => {
      const policy = buildContentSecurityPolicy({ host });
      for (const name of ['img-src', 'media-src', 'frame-src']) {
        expect(sources(policy, name), name).not.toContain('https:');
        expect(sources(policy, name), name).not.toContain('*');
      }
    });
  }

  it('still embeds the video players a post can contain', () => {
    expect(sources(production, 'frame-src')).toEqual(
      expect.arrayContaining([
        'https://www.youtube.com',
        'https://www.youtube-nocookie.com',
        'https://player.vimeo.com',
      ]),
    );
  });

  it('frames localhost only on a desktop host, where embedded apps are served from', () => {
    expect(sources(production, 'frame-src')).toContain('http://localhost:*');
    expect(sources(buildContentSecurityPolicy({ host: 'web' }), 'frame-src')).not.toContain('http://localhost:*');
  });
});

describe('what a deployment adds', () => {
  const seed = {
    contentSecurity: { images: ['https://upload.wikimedia.org'], media: ['https://*.example.org'], frames: [] },
    apps: [{ paths: { webUrl: 'https://flux.example.org/app' } }],
  };

  it('adds its sources to the right directives, and its embedded apps to frames', () => {
    const policy = buildContentSecurityPolicy({ host: 'web', seed });
    expect(sources(policy, 'img-src')).toContain('https://upload.wikimedia.org');
    expect(sources(policy, 'media-src')).toContain('https://*.example.org');
    expect(sources(policy, 'frame-src')).toContain('https://flux.example.org');
  });

  it('refuses a source that would allow everywhere, and says which', () => {
    for (const bad of ['https:', '*', 'https://*', 'http://example.org', 'https://example.org/path', 'example.org']) {
      expect(() => seedSources({ contentSecurity: { images: [bad] } }), bad).toThrow(/is not an origin/);
    }
  });

  it('refuses a list that is not a list', () => {
    expect(() => seedSources({ contentSecurity: { frames: 'https://a.example' } })).toThrow(/must be a list/);
  });
});

describe('Tauri', () => {
  it('lets the page talk to its own core', () => {
    expect(sources(buildContentSecurityPolicy({ host: 'tauri' }), 'connect-src')).toEqual(
      expect.arrayContaining(['ipc:', 'http://ipc.localhost']),
    );
  });
});
