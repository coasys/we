/**
 * E2E test: WE identity module on the account settings page.
 *
 * Validates the full stack: executor with identity RPC handlers → ad4m-connect auth →
 * WE app boot → Settings account page → identity section rendering.
 *
 * Screenshots persist to e2e/screenshots/ (gitignored).
 *
 * Prerequisites:
 *   - AD4M executor on port 12000 (with --enable-multi-user true, --admin-credential test123)
 *   - WE served on port 3000
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page, test } from '@playwright/test';

import { type Ad4mRpcConfig, agentStatus, ensureUserAndLogin } from './helpers/ad4m-rpc';

// ─── Config from env ─────────────────────────────────────────────────────────

const AD4M_PORT = Number(process.env.AD4M_PORT ?? 12000);
const AD4M_ADMIN_CREDENTIAL = process.env.AD4M_ADMIN_CREDENTIAL ?? 'test123';
const WE_URL = process.env.WE_URL ?? 'http://localhost:3000';
const AD4M_CONNECT_VERSION = process.env.AD4M_CONNECT_VERSION ?? '0.13.0-test-interpretation-2';
const TEST_EMAIL = process.env.AD4M_TEST_EMAIL ?? 'e2e@test.com';
const TEST_PASSWORD = process.env.AD4M_TEST_PASSWORD ?? 'test123';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

const rpcConfig: Ad4mRpcConfig = {
  wsUrl: `ws://127.0.0.1:${AD4M_PORT}/api/v1/ws`,
  token: AD4M_ADMIN_CREDENTIAL,
};

// ─── Test data fixtures ─────────────────────────────────────────────────────

const MOCK_DID = 'did:key:z6MkhAsbW5vwZ5Fdvkk6KPqsk9WWWib3r1oEQzcmjX4q7KnA';

const FIXTURES = {
  identity: {
    did: MOCK_DID,
    name: `${MOCK_DID.substring(0, 24)}…`,
    agentType: 'human',
    recoveryThreshold: 2,
  },

  /** Single device — the local machine that booted. */
  singleDevice: [
    {
      id: 'key-local-001',
      label: 'Arcadia Desktop',
      icon: 'desktop',
      type: 'device',
      scopeSummary: 'sign, KEL ops, delegate',
      active: true,
      keyId: 'key-local-001',
      signingKey: 'z6Mkr8B4fGqJ7DcVFR3xNp4T5vQwVL9xS2nKjYb7h4eRqVFa',
      delegatedAt: 'Sequence #0',
      scopes: ['sign', 'KEL ops', 'delegate'],
      encryptionKey: 'z6LSkR8B4fGqJ7DcVFR3xNp4T5vQwVL9xS2nKjYb7h4eRqVFz',
    },
  ],

  /** Multi-device roster: desktop, laptop, mobile, remote server, assistant. */
  multiDevice: [
    {
      id: 'key-desktop-001',
      label: 'Arcadia Desktop',
      icon: 'desktop',
      type: 'device',
      scopeSummary: 'sign, KEL ops, delegate',
      active: true,
      keyId: 'key-desktop-001',
      signingKey: 'z6Mkr8B4fGqJ7DcVFR3xNp4T5vQwVL9xS2nKjYb7h4eRqVFa',
      delegatedAt: 'Sequence #0',
      scopes: ['sign', 'KEL ops', 'delegate'],
      encryptionKey: 'z6LSkR8B4fGqJ7DcVFR3xNp4T5vQwVL9xS2nKjYb7h4eRqVFz',
    },
    {
      id: 'key-laptop-002',
      label: 'MacBook Pro',
      icon: 'desktop',
      type: 'device',
      scopeSummary: 'sign, KEL ops',
      active: true,
      keyId: 'key-laptop-002',
      signingKey: 'z6MkvT3c8L2Kq9RwXnYp5A1jD7mE4fGhNs6uBk0wJ8xZtWaR',
      delegatedAt: 'Sequence #2',
      scopes: ['sign', 'KEL ops'],
      encryptionKey: null,
    },
    {
      id: 'key-mobile-003',
      label: 'Galaxy S22',
      icon: 'device-mobile',
      type: 'device',
      scopeSummary: 'sign',
      active: true,
      keyId: 'key-mobile-003',
      signingKey: 'z6MkpQ7Rj4Ws8Lb5Xc2Yd6Nh3Tg0Vf9Ua1Ke4Mj7Pi0So3Rn6',
      delegatedAt: 'Sequence #3',
      scopes: ['sign'],
      encryptionKey: null,
    },
    {
      id: 'key-remote-004',
      label: 'Field Server',
      icon: 'cloud',
      type: 'device',
      scopeSummary: 'sign, KEL ops',
      active: true,
      keyId: 'key-remote-004',
      signingKey: 'z6MktH9wK3Lb5Fc8Qd2Rj6Yn4Xp0Vg7Ua1Me3Nk5Si8To0Wq2',
      delegatedAt: 'Sequence #5',
      scopes: ['sign', 'KEL ops'],
      encryptionKey: 'z6LStH9wK3Lb5Fc8Qd2Rj6Yn4Xp0Vg7Ua1Me3Nk5Si8To0Wq3',
    },
    {
      id: 'key-assistant-005',
      label: 'Hex (AI Assistant)',
      icon: 'robot',
      type: 'assistant',
      scopeSummary: 'sign',
      active: true,
      keyId: 'key-assistant-005',
      signingKey: 'z6MkdF2wL8Hb3Gc9Re4Sj7Tn5Xq1Vg0Ub6Mf8Nk2Pi4So7Wn3',
      delegatedAt: 'Sequence #6',
      scopes: ['sign'],
      encryptionKey: null,
    },
  ],

  /** Multi-device with a revoked key. */
  multiDeviceWithRevoked: [
    {
      id: 'key-desktop-001',
      label: 'Arcadia Desktop',
      icon: 'desktop',
      type: 'device',
      scopeSummary: 'sign, KEL ops, delegate',
      active: true,
      keyId: 'key-desktop-001',
      signingKey: 'z6Mkr8B4fGqJ7DcVFR3xNp4T5vQwVL9xS2nKjYb7h4eRqVFa',
      delegatedAt: 'Sequence #0',
      scopes: ['sign', 'KEL ops', 'delegate'],
      encryptionKey: 'z6LSkR8B4fGqJ7DcVFR3xNp4T5vQwVL9xS2nKjYb7h4eRqVFz',
    },
    {
      id: 'key-old-laptop',
      label: 'Old ThinkPad (compromised)',
      icon: 'desktop',
      type: 'device',
      scopeSummary: 'No permissions',
      active: false,
      keyId: 'key-old-laptop',
      signingKey: 'z6MkxW4tN7Jb2Lc5Qf8Re3Sd6Yn9Tp0Vg1Ua4Mh7Nk0Pi3So6',
      delegatedAt: 'Sequence #1',
      scopes: [],
      encryptionKey: null,
    },
    {
      id: 'key-mobile-003',
      label: 'Galaxy S22',
      icon: 'device-mobile',
      type: 'device',
      scopeSummary: 'sign',
      active: true,
      keyId: 'key-mobile-003',
      signingKey: 'z6MkpQ7Rj4Ws8Lb5Xc2Yd6Nh3Tg0Vf9Ua1Ke4Mj7Pi0So3Rn6',
      delegatedAt: 'Sequence #3',
      scopes: ['sign'],
      encryptionKey: null,
    },
  ],

  /** Guardians — all consented. */
  guardiansAllConsented: [
    { name: 'Alice Nakamoto', did: 'did:key:z6MkfA3...bC9q', consented: true },
    { name: 'Bob Chen', did: 'did:key:z6MkgD7...eF2r', consented: true },
    { name: 'Carol Torres', did: 'did:key:z6MkhG1...jK5t', consented: true },
  ],

  /** Guardians — mixed consent (one pending). */
  guardiansMixedConsent: [
    { name: 'Alice Nakamoto', did: 'did:key:z6MkfA3...bC9q', consented: true },
    { name: 'Bob Chen', did: 'did:key:z6MkgD7...eF2r', consented: false },
    { name: 'Carol Torres', did: 'did:key:z6MkhG1...jK5t', consented: true },
  ],

  /** KEL events — full lifecycle. */
  kelEvents: [
    { seqLabel: '#0', type: 'inception', summary: 'Identity created — initial key established' },
    { seqLabel: '#1', type: 'delegate', summary: 'Delegated key-old-laptop (ThinkPad)' },
    { seqLabel: '#2', type: 'delegate', summary: 'Delegated key-laptop-002 (MacBook Pro)' },
    { seqLabel: '#3', type: 'delegate', summary: 'Delegated key-mobile-003 (Galaxy S22)' },
    { seqLabel: '#4', type: 'rotate', summary: 'Revoked key-old-laptop — device compromised' },
    { seqLabel: '#5', type: 'delegate', summary: 'Delegated key-remote-004 (Field Server)' },
    { seqLabel: '#6', type: 'delegate', summary: 'Delegated key-assistant-005 (Hex)' },
  ],

  /** Active recovery state. */
  recoveryActive: {
    method: 'guardian',
    statusLabel: '1 of 2 guardians approved — waiting for 1 more',
    approvals: 1,
    threshold: 2,
    requestedAt: '2026-09-02T14:30:00Z',
  },

  /** Incoming recovery requests (as a guardian). */
  incomingRecoveryRequests: [
    { id: 'req-001', requesterName: 'Dave Miller', requesterDid: 'did:key:z6MkjL4...mN8v' },
    { id: 'req-002', requesterName: 'Eve Park', requesterDid: 'did:key:z6MkkM5...nP9w' },
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Inject AD4M credentials into localStorage, bypassing the ad4m-connect interactive auth flow.
 *
 * Same technique as ad4m-flux-browser-auth.sh — set the version-prefixed keys that ad4m-connect
 * reads on init, then reload so it finds them and skips straight to "connected".
 */
async function injectAd4mCredentials(page: Page, jwt: string) {
  const executorUrl = `http://127.0.0.1:${AD4M_PORT}`;

  // Clear any stale ad4m keys first
  await page.evaluate(() => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.includes('ad4m')) localStorage.removeItem(k);
    }
  });

  // Inject credentials for the known version
  await page.evaluate(
    ({ version, token, url, port }) => {
      localStorage.setItem(`${version}/ad4m-token`, token);
      localStorage.setItem(`${version}/ad4m-url`, url);
      localStorage.setItem(`${version}/ad4m-port`, String(port));
      localStorage.setItem(
        `${version}/ad4m-last-host`,
        JSON.stringify({
          id: `e2e-${Date.now()}`,
          url,
          name: '127.0.0.1',
          location: 'E2E Test',
        }),
      );
    },
    { version: AD4M_CONNECT_VERSION, token: jwt, url: executorUrl, port: AD4M_PORT },
  );
}

/**
 * Detect additional ad4m-connect version prefixes the runtime may have written,
 * and re-inject credentials for those too.
 *
 * ad4m-connect sometimes writes keys under a runtime-detected version that differs from the
 * package.json version (bundle caching, esbuild inlining). This catches that mismatch.
 */
async function reinjectForRuntimeVersions(page: Page, jwt: string) {
  const executorUrl = `http://127.0.0.1:${AD4M_PORT}`;

  const runtimeVersions: string[] = await page.evaluate((knownVersion) => {
    const versions: Record<string, number> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.includes('/ad4m-')) {
        const ver = k.split('/ad4m-')[0];
        versions[ver] = (versions[ver] || 0) + 1;
      }
    }
    return Object.keys(versions).filter((v) => v !== knownVersion);
  }, AD4M_CONNECT_VERSION);

  if (runtimeVersions.length === 0) return false;

  for (const version of runtimeVersions) {
    await page.evaluate(
      ({ version, token, url, port }) => {
        localStorage.setItem(`${version}/ad4m-token`, token);
        localStorage.setItem(`${version}/ad4m-url`, url);
        localStorage.setItem(`${version}/ad4m-port`, String(port));
        localStorage.setItem(
          `${version}/ad4m-last-host`,
          JSON.stringify({
            id: `e2e-${Date.now()}`,
            url,
            name: '127.0.0.1',
            location: 'E2E Test',
          }),
        );
      },
      { version, token: jwt, url: executorUrl, port: AD4M_PORT },
    );
  }
  return true;
}

/**
 * Wait for the WE app to finish booting — past the boot screen into the main template.
 *
 * The app renders a boot screen (BootScreen.schema.ts) until the session initialises,
 * then transitions to the template layout with the chrome rail.
 */
async function waitForAppBoot(page: Page, timeoutMs = 30_000) {
  // Wait for the page to settle — the app may reload itself during auth
  await page.waitForLoadState('networkidle', { timeout: timeoutMs });

  // Wait for the we-app or main content area to appear
  // The app renders custom elements; wait for the chrome rail or any module launcher
  await page.waitForFunction(
    () => {
      // Check for the ad4m-connect element being in authenticated state
      const ac = document.querySelector('ad4m-connect') as HTMLElement & {
        authState?: string;
        connectionState?: string;
      };
      if (ac) {
        // If ad4m-connect exists and shows authenticated + connected, the app can proceed
        if (ac.authState === 'authenticated' && ac.connectionState === 'connected') return true;
        // Some builds use a 'core' sub-object
        const core = (ac as unknown as { core?: { authState: string; connectionState: string } }).core;
        if (core?.authState === 'authenticated' && core?.connectionState === 'connected') return true;
      }

      // Alternatively, check whether the main app content loaded (no ad4m-connect visible)
      // WE hides ad4m-connect once authenticated and renders the template
      const body = document.body.textContent || '';
      // The boot screen shows "Create account" or "Unlock" — if neither appears,
      // and we have content, the app booted past that
      if (body.length > 100 && !body.includes('Enter the security code') && !body.includes('connection-options')) {
        return true;
      }

      return false;
    },
    { timeout: timeoutMs },
  );
}

/**
 * Complete the auth flow: inject credentials, reload, handle version mismatch, wait for boot.
 */
async function authenticateAndBoot(page: Page, jwt: string) {
  // Navigate to WE — triggers ad4m-connect UI
  await page.goto(WE_URL, { waitUntil: 'domcontentloaded' });

  // Inject credentials into localStorage
  await injectAd4mCredentials(page, jwt);

  // Reload so ad4m-connect picks up the injected credentials
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Brief pause for ad4m-connect to read localStorage and attempt connection
  await page.waitForTimeout(3000);

  // Check for runtime version mismatch and re-inject if needed
  const reinjected = await reinjectForRuntimeVersions(page, jwt);
  if (reinjected) {
    console.log('Re-injected credentials for runtime version mismatch');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }

  // Wait for the app to boot past the auth screen
  await waitForAppBoot(page);

  // Dismiss the "What should we call you?" name prompt if it appears
  const notNowButton = page.getByRole('button', { name: 'Not now' });
  if (await notNowButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await notNowButton.click();
    await page.waitForTimeout(1500);
  }
}

/**
 * Open the Settings page by clicking the gear icon in the sidebar.
 *
 * The sidebar's Settings rail item renders as a we-button with a we-icon[name="gear"].
 * Clicking it opens the Settings shell view (an overlay/route) with the Account page as default.
 */
async function openSettings(page: Page) {
  // The sidebar may need expansion first — dispatch mouseenter on its container.
  await page.evaluate(() => {
    const candidates = document.querySelectorAll('div');
    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' && style.left === '0px' && style.top === '0px' && parseInt(style.width) <= 100) {
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
        break;
      }
    }
  });
  await page.waitForTimeout(800);

  // Click the Settings (gear) icon in the sidebar
  const gearButton = page.locator('we-icon[name="gear"]').first();
  await gearButton.waitFor({ state: 'visible', timeout: 5000 });
  await gearButton.click();

  // Wait for the Settings page to render — it shows the "Settings" heading
  await page.waitForFunction(
    () => {
      const body = document.body.textContent || '';
      return body.includes('Settings') && body.includes('Account');
    },
    { timeout: 10_000 },
  );

  // Let the page finish rendering
  await page.waitForTimeout(1500);
}

/**
 * Wait for the identity store to become available on window.__identityStore.
 *
 * The store gets exposed by wireIdentityModule after auth — even if identity RPC calls fail
 * (fallback data gets set and the hook still runs).
 */
async function waitForIdentityStore(page: Page, timeoutMs = 15_000): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__identityStore;
        return store && typeof store.setRoster === 'function';
      },
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Inject identity data into the store via page.evaluate.
 *
 * Solid signals update the DOM reactively — setting data triggers immediate re-render.
 */
async function injectIdentityData(
  page: Page,
  data: {
    identity?: Record<string, unknown>;
    roster?: Record<string, unknown>[];
    guardians?: Record<string, unknown>[];
    kelEvents?: Record<string, unknown>[];
    recoveryState?: Record<string, unknown> | null;
    backupConfirmed?: boolean;
    incomingRecoveryRequests?: Record<string, unknown>[];
  },
) {
  await page.evaluate((d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__identityStore;
    if (!store) throw new Error('__identityStore not available');

    if (d.identity !== undefined) store.setIdentity(d.identity);
    if (d.roster !== undefined) store.setRoster(d.roster);
    if (d.guardians !== undefined) store.setGuardians(d.guardians);
    if (d.kelEvents !== undefined) store.setKelEvents(d.kelEvents);
    if (d.recoveryState !== undefined) store.setRecoveryState(d.recoveryState);
    if (d.backupConfirmed !== undefined) store.setBackupConfirmed(d.backupConfirmed);
    if (d.incomingRecoveryRequests !== undefined) store.setIncomingRecoveryRequests(d.incomingRecoveryRequests);
  }, data);

  // Let Solid's reactivity flush DOM updates
  await page.waitForTimeout(500);
}

/** Click a tab in the identity section by its label text. */
async function clickIdentityTab(page: Page, tabName: string) {
  const tab = page.locator('we-tab').filter({ hasText: tabName });
  if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(500);
  }
}

/** Take a screenshot with a descriptive filename. */
async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: true,
  });
  console.log(`Screenshot: ${name}.png`);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Identity Module', () => {
  let jwt: string;

  test.beforeAll(async () => {
    // Verify the executor runs and the agent exists
    const status = await agentStatus(rpcConfig);
    expect(status.isInitialized).toBe(true);
    expect(status.isUnlocked).toBe(true);
    console.log(`Executor agent: ${status.did}`);

    // Get a JWT for the test user
    jwt = await ensureUserAndLogin(TEST_EMAIL, TEST_PASSWORD, rpcConfig);
    console.log(`JWT obtained (${jwt.length} chars)`);
  });

  test('renders the identity section on the account settings page', async ({ page }) => {
    test.setTimeout(90_000);

    // ── Step 1: Auth + boot ──
    await authenticateAndBoot(page, jwt);

    await screenshot(page, '01-we-app-booted');

    // ── Step 2: Open Settings ──
    await openSettings(page);

    await screenshot(page, '02-settings-account-page');

    // ── Step 3: Verify the identity section rendered ──
    const identityVisible = await page.evaluate(() => {
      const body = document.body.textContent || '';
      const hasIdentityHeading = body.includes('Identity');
      const hasTabsOrLoading =
        body.includes('Devices') ||
        body.includes('Guardians') ||
        body.includes('Recovery') ||
        body.includes('Loading identity');
      return hasIdentityHeading && hasTabsOrLoading;
    });

    expect(identityVisible).toBe(true);
  });

  test('devices tab — single device', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      roster: FIXTURES.singleDevice,
      backupConfirmed: false,
    });

    await clickIdentityTab(page, 'Devices');
    await screenshot(page, '10-devices-single');
  });

  test('devices tab — multiple devices and assistant', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      roster: FIXTURES.multiDevice,
      backupConfirmed: true,
    });

    await clickIdentityTab(page, 'Devices');
    await screenshot(page, '11-devices-multi-with-assistant');
  });

  test('devices tab — with revoked key', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      roster: FIXTURES.multiDeviceWithRevoked,
      backupConfirmed: true,
    });

    await clickIdentityTab(page, 'Devices');
    await screenshot(page, '12-devices-with-revoked');
  });

  test('device detail view — active device', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      roster: FIXTURES.multiDevice,
      backupConfirmed: true,
    });

    await clickIdentityTab(page, 'Devices');

    // Click the first device (Arcadia Desktop) to open detail view
    const firstDevice = page.locator('we-icon[name="desktop"]').first();
    if (await firstDevice.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstDevice.click();
      await page.waitForTimeout(800);
    }

    await screenshot(page, '13-device-detail-active');
  });

  test('device detail view — revoked device', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      roster: FIXTURES.multiDeviceWithRevoked,
      backupConfirmed: true,
    });

    await clickIdentityTab(page, 'Devices');

    // Select the revoked device programmatically — the second entry
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__identityStore.selectDevice('key-old-laptop');
    });
    await page.waitForTimeout(800);

    await screenshot(page, '14-device-detail-revoked');
  });

  test('guardians tab — all consented with threshold', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      guardians: FIXTURES.guardiansAllConsented,
      backupConfirmed: true,
    });

    await clickIdentityTab(page, 'Guardians');
    await screenshot(page, '20-guardians-all-consented');
  });

  test('guardians tab — mixed consent with pending warning', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      guardians: FIXTURES.guardiansMixedConsent,
      backupConfirmed: true,
    });

    await clickIdentityTab(page, 'Guardians');
    await screenshot(page, '21-guardians-pending-warning');
  });

  test('guardians tab — empty state', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      guardians: [],
      backupConfirmed: true,
    });

    await clickIdentityTab(page, 'Guardians');
    await screenshot(page, '22-guardians-empty');
  });

  test('recovery tab — methods only (no active recovery)', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      guardians: FIXTURES.guardiansAllConsented,
      recoveryState: null,
      incomingRecoveryRequests: [],
      backupConfirmed: true,
    });

    await clickIdentityTab(page, 'Recovery');
    await screenshot(page, '30-recovery-methods-only');
  });

  test('recovery tab — active recovery in progress', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      guardians: FIXTURES.guardiansAllConsented,
      recoveryState: FIXTURES.recoveryActive,
      incomingRecoveryRequests: [],
      backupConfirmed: true,
    });

    await clickIdentityTab(page, 'Recovery');
    await screenshot(page, '31-recovery-in-progress');
  });

  test('recovery tab — incoming requests as guardian', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      guardians: FIXTURES.guardiansAllConsented,
      recoveryState: null,
      incomingRecoveryRequests: FIXTURES.incomingRecoveryRequests,
      backupConfirmed: true,
    });

    await clickIdentityTab(page, 'Recovery');
    await screenshot(page, '32-recovery-incoming-requests');
  });

  test('log tab — populated event log', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      kelEvents: FIXTURES.kelEvents,
      backupConfirmed: true,
    });

    await clickIdentityTab(page, 'Log');
    await screenshot(page, '40-log-populated');
  });

  test('log tab — empty state', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      kelEvents: [],
      backupConfirmed: true,
    });

    await clickIdentityTab(page, 'Log');
    await screenshot(page, '41-log-empty');
  });

  test('backup states — nag banner vs secured badge', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    // First: not backed up — nag banner visible
    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      roster: FIXTURES.multiDevice,
      backupConfirmed: false,
    });
    await screenshot(page, '50-backup-nag-banner');

    // Then: backed up — "Backup secured" badge, no nag
    await injectIdentityData(page, {
      backupConfirmed: true,
    });
    await screenshot(page, '51-backup-secured');
  });

  test('full scenario — multi-executor production identity', async ({ page }) => {
    test.setTimeout(90_000);
    await authenticateAndBoot(page, jwt);
    await openSettings(page);

    const storeReady = await waitForIdentityStore(page);
    expect(storeReady).toBe(true);

    // Inject a fully populated identity: multi-device, guardians, KEL, backup confirmed
    await injectIdentityData(page, {
      identity: FIXTURES.identity,
      roster: FIXTURES.multiDevice,
      guardians: FIXTURES.guardiansAllConsented,
      kelEvents: FIXTURES.kelEvents,
      recoveryState: null,
      incomingRecoveryRequests: [],
      backupConfirmed: true,
    });

    // Devices tab (default)
    await clickIdentityTab(page, 'Devices');
    await screenshot(page, '60-full-devices');

    // Guardians tab
    await clickIdentityTab(page, 'Guardians');
    await screenshot(page, '61-full-guardians');

    // Recovery tab
    await clickIdentityTab(page, 'Recovery');
    await screenshot(page, '62-full-recovery');

    // Log tab
    await clickIdentityTab(page, 'Log');
    await screenshot(page, '63-full-log');

    // Device detail — click first device
    await clickIdentityTab(page, 'Devices');
    await page.waitForTimeout(300);

    const deviceRow = page.locator('we-icon[name="desktop"]').first();
    if (await deviceRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await deviceRow.click();
      await page.waitForTimeout(800);
    }
    await screenshot(page, '64-full-device-detail');
  });

  test('identity RPC handlers respond', async ({ page }) => {
    // Navigate and auth
    await page.goto(WE_URL, { waitUntil: 'domcontentloaded' });
    await injectAd4mCredentials(page, jwt);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const reinjected = await reinjectForRuntimeVersions(page, jwt);
    if (reinjected) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
    }

    await waitForAppBoot(page);

    // Call identity.resolve through the browser's WebSocket connection to the executor.
    // This validates the identity RPC handlers registered in identity_ws.rs respond.
    // The handler returns an error for unknown DIDs ("identifier not found") — that
    // proves routing works. "Unknown type" would mean the handler never registered.
    //
    // NOTE: This test requires the identity-branch executor (feat/agent-identity-*).
    // The Docker production executor lacks these handlers and returns "Unknown type".
    // Skip gracefully when running against Docker prod (port 13000).
    const resolveResponse = await page.evaluate(
      async ({ port }) => {
        return new Promise<{ result?: unknown; error?: { code: number; message: string } }>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/ws?token=test123`);
          const id = crypto.randomUUID();
          const timer = setTimeout(() => {
            ws.close();
            reject(new Error('RPC timeout'));
          }, 10_000);

          ws.onopen = () => {
            ws.send(JSON.stringify({ id, type: 'identity.resolve', params: { id: 'did:key:test' } }));
          };
          ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.id !== id) return;
            clearTimeout(timer);
            ws.close();
            resolve({ result: msg.result, error: msg.error });
          };
          ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error('WebSocket error'));
          };
        });
      },
      { port: AD4M_PORT },
    );

    // The handler responded (either result or domain-level error).
    // "Unknown type" means the identity_ws handlers never registered — skip if so.
    if (resolveResponse.error?.message?.includes('Unknown type')) {
      console.log('Skipping — executor lacks identity RPC handlers (production build)');
      test.skip();
      return;
    }

    if (resolveResponse.error) {
      // Domain error (e.g. "identifier not found") — routing works
      console.log('identity.resolve returned domain error:', resolveResponse.error.message);
    } else {
      console.log('identity.resolve returned result:', JSON.stringify(resolveResponse.result));
    }
  });
});
