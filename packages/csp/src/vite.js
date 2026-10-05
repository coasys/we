import { readFileSync } from 'node:fs';

import { buildContentSecurityPolicy } from './index.js';

/**
 * The policy as a `<meta>` tag in the page — and, for the web host, as a Netlify header too.
 *
 * The tag goes first in `<head>`, because a policy only governs what comes after it. Netlify gets the
 * same policy as a header as well, in a `_headers` file written into the build, for the one clause a
 * meta tag cannot carry: `frame-ancestors`, which stops somebody else's page framing ours. Both are
 * enforced; they say the same thing apart from that clause.
 *
 * Electron does not use this. It sets the policy as a header on its own documents, from a file its
 * prebuild writes with the same builder.
 *
 * `seedFile` is read when the config resolves, so a change to the seed's content sources needs a
 * restart of the dev server, like any other seed change.
 */
export function contentSecurityPolicy({ host, seedFile }) {
  let dev = false;
  let seed = {};

  return {
    name: 'we:content-security-policy',
    configResolved(config) {
      dev = config.command === 'serve';
      seed = JSON.parse(readFileSync(seedFile, 'utf8'));
      // Built once here so an invalid seed fails the build at the start, not halfway through.
      buildContentSecurityPolicy({ host, dev, seed });
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: buildContentSecurityPolicy({ host, dev, seed, meta: true }),
          },
          injectTo: 'head-prepend',
        },
      ];
    },
    generateBundle() {
      if (host !== 'web') return;
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: `/*\n  Content-Security-Policy: ${buildContentSecurityPolicy({ host, dev: false, seed })}\n`,
      });
    },
  };
}

/**
 * Knockout — vendored inside `@cesium/widgets`, and reached by every `import { Viewer } from
 * 'cesium'` — opens its UMD wrapper by finding the global object as `this || (0, eval)("this")`.
 *
 * Under a module, `this` is `undefined`, so that always takes the eval branch; under a production
 * CSP with no 'unsafe-eval' the eval throws at *import* time, before a line of Knockout runs. The
 * rejected chunk import propagates to app boot, which is why a packaged build died with
 * "[we] the app failed to start" rather than merely losing the globe.
 *
 * `globalThis` is what the idiom is reaching for and has been available since ES2020, so the
 * rewrite is exact rather than a workaround. Done here rather than by granting 'unsafe-eval',
 * which would hand every dependency in the bundle a capability one vendored file wanted.
 *
 * The check that it still applies is made at the end of the build rather than per file. Cesium
 * vendors three knockout files — the library, an ES5 plugin and a re-export shim — and only the
 * library carries the idiom, so requiring it of each one fails on two files that are already fine.
 * What actually matters is that *something* was rewritten: a Cesium upgrade that renames or
 * restructures the vendored copy would otherwise leave this a silent no-op, and the symptom is a
 * packaged app that does not boot.
 *
 * Every host needs it, since every host now serves a policy without 'unsafe-eval'. It lived in the
 * Electron build alone while Electron was the only host with a policy.
 */
export function rewriteKnockoutGlobalEval() {
  const NEEDLE = 'this||(0,eval)("this")';
  let rewrote = false;

  return {
    name: 'we:rewrite-knockout-global-eval',
    apply: 'build',
    transform(code, id) {
      if (!id.includes('@cesium/widgets') || !code.includes(NEEDLE)) return null;
      rewrote = true;
      return { code: code.replaceAll(NEEDLE, 'this||globalThis'), map: null };
    },
    buildEnd(error) {
      if (error || rewrote) return;
      throw new Error(
        `[we] no @cesium/widgets file contained \`${NEEDLE}\`, so nothing was rewritten. Knockout's ` +
          'global lookup has changed shape — re-check it against the production CSP (which grants no ' +
          "'unsafe-eval') before dropping this plugin.",
      );
    },
  };
}
