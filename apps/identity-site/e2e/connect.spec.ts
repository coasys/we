import { expect, type Page, test } from '@playwright/test';

import { world } from '../tests/fakes.ts';
import { seedKey } from './seed.ts';
import { APP_ORIGIN, EXECUTOR, EXECUTOR_ORIGIN, SITE, startWorld, STRANGER_ORIGIN, type World } from './servers.ts';

let world_: World;
test.beforeEach(async ({ page }) => {
  world_ = await startWorld('dist-e2e');
  // The fixture's ticket and key log are of one moment: the browser's clock is that moment too.
  await page.clock.setFixedTime(new Date(world.now * 1000));
});
test.afterEach(async () => {
  await world_.close();
});

type Logged = { origin: string; data: { type: string; [key: string]: unknown } };
const log = (page: Page) => page.evaluate(() => (window as unknown as { log: Logged[] }).log);

/** Opens the app's page, waits for the frame's `ready`, and puts the fixture key in the frame's storage. */
async function openApp(page: Page, linked: boolean) {
  await page.goto(`${APP_ORIGIN}/`);
  await expect.poll(async () => (await log(page)).some((m) => m.data.type === 'ready' && m.origin === SITE)).toBe(true);
  const frame = page.frames().find((f) => f.url().startsWith(SITE))!;
  await seedKey(frame, linked);
  if (linked) world_.store.claimed = { offerId: world.browser.offerId };
  await page.evaluate(() => (window as unknown as { sendRequest(): void }).sendRequest());
  return page.frameLocator('#f');
}

async function connect(page: Page, linked: boolean) {
  const frame = await openApp(page, linked);
  await expect(frame.getByText('Notes at ' + APP_ORIGIN + ' wants to connect')).toBeVisible();
  if (!linked) {
    // The browser has a key and no identity: the frame asks to link it, and has no password field.
    await expect(frame.getByRole('heading', { name: 'Link this browser' })).toBeVisible({ timeout: 20_000 });
    expect(await frame.locator('input[type=password]').count()).toBe(0);
    expect(await frame.locator('body').innerHTML()).toContain('coasys:device:1:');
    world_.store.offer();
    await expect(frame.getByRole('heading', { name: 'Compare this code' }).or(frame.locator('.devices'))).toBeVisible({
      timeout: 20_000,
    });
  }
  const device = frame.getByRole('button', { name: /MacBook Pro/ });
  await expect(device).toBeVisible({ timeout: 20_000 });
  await expect(frame.getByRole('button')).toHaveCount(1);
  await device.click();
  await expect
    .poll(async () => (await log(page)).some((m) => m.data.type === 'connected'), { timeout: 20_000 })
    .toBe(true);
  const answer = (await log(page)).find((m) => m.data.type === 'connected')!;
  expect(answer.origin).toBe(SITE);
  expect(answer.data).toEqual({
    type: 'connected',
    state: 'state-1',
    executor: EXECUTOR,
    code: 'code-1',
    did: `did:scid:coasys:1:${world.scid}`,
  });
  expect(world_.executor.logins[0].proof.statement).toMatchObject({
    purpose: 'login',
    client: { kind: 'web', origin: APP_ORIGIN },
    codeChallenge: 'pkce-challenge',
    audience: EXECUTOR_ORIGIN,
  });
  expect(world_.store.refused).toEqual([]);
}

test('links this browser, then connects from a frame on another origin and answers the exact origin', async ({
  page,
}) => {
  await connect(page, false);
  expect(world_.store.match()).toMatch(/^[A-Z2-7]{3} [A-Z2-7]{3}$/);
});

test('a linked browser goes straight to the device and connects', async ({ page }) => {
  await connect(page, true);
});

// The key is read back from IndexedDB here: the signing key as a CryptoKey and the X25519 secret
// under an AES key. WebKit cannot read back an X25519 CryptoKey, which is why it is not stored as one.
test('renews and signs out with the key kept in IndexedDB', async ({ page }) => {
  await connect(page, true);

  // Renew: a fresh challenge from the executor, the same grant, signed by the same browser key.
  await page.evaluate(
    ({ challenge, executor }) =>
      (window as unknown as { sendToFrame(m: unknown): void }).sendToFrame({
        type: 'renew',
        state: 'state-1',
        executor,
        challenge,
        grantId: 'grant-1',
      }),
    { challenge: world_.executor.sessionChallenge(), executor: EXECUTOR },
  );
  await expect.poll(async () => (await log(page)).some((m) => m.data.type === 'renewed')).toBe(true);

  // Sign-out: the frame forgets the session, so a later renew gets no answer.
  const before = (await log(page)).length;
  await page.evaluate(
    ({ challenge, executor }) => {
      const w = window as unknown as { sendToFrame(m: unknown): void };
      w.sendToFrame({ type: 'sign-out', state: 'state-1' });
      w.sendToFrame({ type: 'renew', state: 'state-1', executor, challenge, grantId: 'grant-1' });
    },
    { challenge: world_.executor.sessionChallenge(), executor: EXECUTOR },
  );
  await page.waitForTimeout(500);
  expect((await log(page)).length).toBe(before);
});

test('a page that is not in the registry gets no answer and is not framed at all by the headers', async ({ page }) => {
  await page.goto(`${STRANGER_ORIGIN}/`);
  await page.waitForTimeout(1500);
  // frame-ancestors lists only the registered app origin: the frame never loads, so it never says `ready`.
  expect(await log(page)).toEqual([]);
});

test('the server sends the headers of _headers: /o cannot be framed and /connect can be, by the app only', async ({
  request,
}) => {
  const other = await request.get(`${SITE}/o`);
  expect(other.headers()['x-frame-options']).toBe('DENY');
  expect(other.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  const connect = await request.get(`${SITE}/connect`);
  expect(connect.headers()['x-frame-options']).toBeUndefined();
  expect(connect.headers()['content-security-policy']).toContain(`frame-ancestors ${APP_ORIGIN}`);
  expect(connect.headers()['content-security-policy']).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(connect.headers()['referrer-policy']).toBe('no-referrer');
});
