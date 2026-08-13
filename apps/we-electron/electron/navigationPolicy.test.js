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
  contentSecurityPolicy,
  isExternallyOpenable,
  isTrusted,
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
    expect(production).not.toContain('unsafe-eval');
    expect(development).toContain('unsafe-eval');
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
