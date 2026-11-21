/**
 * The one source of `dist/_headers` (AR-03 4.6.2, AR-09 4.7): the header set of every route this
 * site serves, for Cloudflare Pages. Pages adds the headers of every rule that matches a path and
 * cannot remove one, so each route gets one rule with its whole set and no rule overlaps another.
 *
 * `'wasm-unsafe-eval'` is in `script-src` of `/connect` only: the frame runs `@coasys/identity-wasm`,
 * and no other page of the site does. `/signup`, `/login`, `/step`, `/restore`, `/reset` and `/connect/browser`
 * are not built in slice 4.A; their rules arrive with their pages.
 */

export interface SiteEndpoints {
  env: string;
  store: string;
  platform: string;
  /** The origins that may embed `/connect`, from the registry's first-party and approved apps. */
  frameOrigins: string[];
  /** Extra `connect-src` sources a local test build needs; empty in production and staging. */
  connectExtra: string[];
}

type Rule = { path: string; headers: Record<string, string> };

const PERMISSIONS = 'camera=(self), microphone=(), geolocation=(), clipboard-read=(), payment=(), usb=()';

function rule(path: string, e: SiteEndpoints, route: 'locked' | 'connect' | 'asset'): Rule {
  const local = e.env === 'e2e';
  const connect =
    route === 'connect'
      ? ["'self'", e.store, e.platform, 'https:', 'wss:', ...e.connectExtra]
      : ["'self'", e.store, e.platform];
  const csp = [
    "default-src 'none'",
    route === 'connect' ? "script-src 'self' 'wasm-unsafe-eval'" : "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "frame-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
    `frame-ancestors ${route === 'connect' ? e.frameOrigins.join(' ') : "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
    // A local test build is served over http: the policy would upgrade its own fetches.
    ...(local ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
  const headers: Record<string, string> = {
    'Content-Security-Policy': csp,
    'Cross-Origin-Opener-Policy': route === 'connect' ? 'unsafe-none' : 'same-origin',
    'Cross-Origin-Resource-Policy': route === 'connect' ? 'cross-origin' : 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': PERMISSIONS,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': route === 'asset' ? 'public, max-age=31536000, immutable' : 'no-store',
  };
  if (route !== 'connect') {
    headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
    headers['X-Frame-Options'] = 'DENY';
  }
  if (!local) headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
  return { path, headers };
}

/** Every rule of the site, in the order of the file. */
function headerRules(e: SiteEndpoints): Rule[] {
  return [
    rule('/', e, 'locked'),
    rule('/o', e, 'locked'),
    rule('/connect', e, 'connect'),
    rule('/assets/*', e, 'asset'),
    rule('/.well-known/*', e, 'locked'),
  ];
}

/** The text of `_headers`. */
export function renderHeaders(e: SiteEndpoints): string {
  return headerRules(e)
    .map(
      ({ path, headers }) =>
        `${path}\n${Object.entries(headers)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join('\n')}`,
    )
    .join('\n\n')
    .concat('\n');
}

/** Parses `_headers` text back to rules, for the checks that read the built file or a live site. */
export function parseHeaders(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (!line.startsWith(' ')) rules.push({ path: line.trim(), headers: {} });
    else {
      const at = line.indexOf(':');
      rules[rules.length - 1].headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return rules;
}
