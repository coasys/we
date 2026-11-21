// Scenario CB-11, step 4, the web leg: a person links a browser, and revokes its key.
//
// What runs here is the part that needs only the identity site and the network around it: the frame
// built from `apps/identity-site` (its own `_headers` applied), embedded by a page on another origin,
// in each of Chromium, Firefox and WebKit, against a registry, an identity store and an executor
// that speak the real wire formats (the store serves the fixture's key log and sealed ticket, and the
// frame verifies all of it with `@coasys/identity-wasm`). Steps 1 to 2 and the match code of step 3
// are checked, and so is the end of step 4 as far as the frame goes: the browser's key is accepted
// through the identity's log and the person can sign in with it.
//
// What does not run here: step 3's other half (a desktop app's identity window opening the link and
// showing the same match code), the revoke of steps 5 and 6, and the storage check of step 7 after a
// tab closes. They need the desktop identity window and a real store, which the acceptance world
// (`feat/acceptance-world`) starts; they are not in this file and are not claimed by it.
//
// Run: `COASYS_ENV=e2e pnpm --filter @we/identity-site exec vite build --outDir dist-e2e --emptyOutDir`,
// then `node --test tests/acceptance/web`. WebKit needs its system libraries; where the Playwright
// launcher cannot find them, `COASYS_WEBKIT_LAUNCHER` names a launcher script that sets the library path.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/identity-site');
const { chromium, firefox, webkit } = createRequire(path.join(site, 'package.json'))('@playwright/test');
const { world } = await import(path.join(site, 'tests/fakes.ts'));
const { seedKey } = await import(path.join(site, 'e2e/seed.ts'));
const { APP_ORIGIN, SITE, startWorld } = await import(path.join(site, 'e2e/servers.ts'));

const dist = path.join(site, 'dist-e2e');
const BROWSERS = { chromium, firefox, webkit };

for (const [name, engine] of Object.entries(BROWSERS)) {
  test(
    `CB-11 step 4 (web): link this browser, ${name}`,
    {
      skip: existsSync(dist)
        ? false
        : `build the site first: COASYS_ENV=e2e pnpm --filter @we/identity-site exec vite build --outDir dist-e2e`,
    },
    async () => {
      const launcher = name === 'webkit' ? process.env.COASYS_WEBKIT_LAUNCHER : undefined;
      const browser = await engine.launch(launcher ? { executablePath: launcher } : {});
      const running = await startWorld(dist);
      try {
        const page = await (await browser.newContext()).newPage();
        // The fixture's ticket and key log are of one moment; the browser's clock is that moment too.
        await page.clock.setFixedTime(new Date(world.now * 1000));
        await page.goto(`${APP_ORIGIN}/`);
        const log = () => page.evaluate(() => window.log);
        await page.waitForFunction(() => window.log.some((m) => m.data.type === 'ready'));
        const frameHandle = page.frames().find((f) => f.url().startsWith(SITE));
        assert.ok(frameHandle, 'the frame is on the identity site');
        // 1. The browser has no key yet in this frame's storage partition: put the fixture key there, unlinked.
        await seedKey(frameHandle, false);
        await page.evaluate(() => window.sendRequest());
        const frame = page.frameLocator('#f');
        // 2. The frame offers to link, has no password field, and shows the device link and its QR code.
        await frame.getByRole('heading', { name: 'Link this browser' }).waitFor({ timeout: 20_000 });
        assert.equal(await frame.locator('input[type=password]').count(), 0);
        assert.match(await frame.locator('body').innerHTML(), /coasys:device:1:/);
        await frame.getByAltText(/QR code/).waitFor();
        // 3. The holder's offer is claimed, and the frame shows the match code the holder will show too.
        running.store.offer();
        await frame
          .getByRole('heading', { name: 'Compare this code' })
          .or(frame.locator('.devices'))
          .waitFor({ timeout: 20_000 });
        assert.match(running.store.match(), /^[A-Z2-7]{3} [A-Z2-7]{3}$/);
        // 4. The holder spends the offer; the frame finds this browser in the identity's log and lists the person's devices.
        await frame.getByRole('button', { name: /MacBook Pro/ }).waitFor({ timeout: 20_000 });
        await frame.getByRole('button', { name: /MacBook Pro/ }).click();
        await page.waitForFunction(() => window.log.some((m) => m.data.type === 'connected'), undefined, {
          timeout: 20_000,
        });
        const answer = (await log()).find((m) => m.data.type === 'connected');
        assert.equal(answer.origin, SITE);
        assert.equal(answer.data.did, `did:scid:coasys:1:${world.scid}`);
        assert.deepEqual(running.store.refused, []);
      } finally {
        await running.close();
        await browser.close();
      }
    },
  );
}
