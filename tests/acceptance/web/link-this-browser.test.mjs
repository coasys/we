// Scenario CB-11, step 4, the web leg: a person links a browser, and revokes its key.
//
// Skipped, and why: the scenario needs (1) the identity site at `coasys-id.test` (the Connect frame
// and the approval screens), which is not in any repository yet, (2) a WebDriver session for each of
// Chromium, Firefox and WebKit, and (3) the acceptance world (`feat/acceptance-world`) that starts
// the identity store and executors. The edge, which is the part this change can run, is tested in
// `edge.test.mjs`. The steps below are the contract the identity site has to meet; the test turns on
// when `COASYS_ID_SITE` names its built folder.
import { existsSync } from 'node:fs';
import { test } from 'node:test';

const idSite = process.env.COASYS_ID_SITE;
const appSite = process.env.COASYS_APP_SITE ?? 'apps/we-web/dist';
const BROWSERS = ['chromium', 'firefox', 'webkit'];

const reason = !idSite
  ? 'the identity site (coasys.id) does not exist yet: set COASYS_ID_SITE to its built folder'
  : !existsSync(appSite)
    ? `the web app is not built at ${appSite}: run \`COASYS_ENV=staging pnpm --filter @we/app-web build\``
    : false;

for (const browser of BROWSERS) {
  test(`CB-11 step 4 (web): link this browser, ${browser}`, { skip: reason }, async () => {
    // 1. Open https://app.coasys.test through the edge. The signed-out screen says "Link this browser".
    // 2. Press it. The page shows the device link (`coasys:device:1:…`), its QR code and a match code.
    // 3. In the desktop app's identity window, open that link. It shows the same match code.
    // 4. Confirm there. The browser holds a Standing key, signs in, and the page shows the space list.
    // 5. In the identity window, Devices lists the browser (kind: browser) with "Revoke device key".
    // 6. Revoke it. The browser's next renew fails and the page returns to the signed-out screen.
    // 7. No step leaves the browser's key, the code verifier or the token in storage the page can
    //    read after the tab closes (the token lives in memory only).
    throw new Error('unreachable while skipped');
  });
}
