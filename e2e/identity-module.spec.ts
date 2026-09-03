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
  console.log('Settings page opened, Account tab active');
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

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-we-app-booted.png'),
      fullPage: true,
    });
    console.log('Step 1: App booted, screenshot saved');

    // ── Step 2: Open Settings ──
    await openSettings(page);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-settings-account-page.png'),
      fullPage: true,
    });
    console.log('Step 2: Settings account page, screenshot saved');

    // ── Step 3: Verify the identity section rendered ──
    // The identity section shows "Identity" heading with fingerprint icon,
    // plus either the tabbed content (Devices, Guardians, Recovery, Log)
    // or a loading spinner while the identity client connects.
    const identityVisible = await page.evaluate(() => {
      const body = document.body.textContent || '';
      // The identity section always shows the "Identity" heading.
      // Content shows either tabs or loading spinner.
      const hasIdentityHeading = body.includes('Identity');
      const hasTabsOrLoading =
        body.includes('Devices') ||
        body.includes('Guardians') ||
        body.includes('Recovery') ||
        body.includes('Loading identity');
      return hasIdentityHeading && hasTabsOrLoading;
    });

    // ── Step 4: Interact with identity tabs ──
    // Try clicking through the tabs for additional screenshots
    const guardiansTab = page.locator('we-tab').filter({ hasText: 'Guardians' });
    if (await guardiansTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await guardiansTab.click();
      await page.waitForTimeout(1000);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '03-identity-guardians-tab.png'),
        fullPage: true,
      });
      console.log('Step 4a: Guardians tab screenshot saved');
    }

    const logTab = page.locator('we-tab').filter({ hasText: 'Log' });
    if (await logTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await logTab.click();
      await page.waitForTimeout(1000);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, '04-identity-log-tab.png'),
        fullPage: true,
      });
      console.log('Step 4b: Log tab screenshot saved');
    }

    // Final screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '05-final-state.png'),
      fullPage: true,
    });

    // Assert the identity section rendered
    expect(identityVisible).toBe(true);
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

    // Success: the handler responded (either result or domain-level error).
    // The key assertion: the error should NOT be "Unknown type" — that would
    // mean the identity_ws handlers were never registered.
    if (resolveResponse.error) {
      expect(resolveResponse.error.message).not.toContain('Unknown type');
      console.log('identity.resolve correctly returned domain error:', resolveResponse.error.message);
    } else {
      console.log('identity.resolve returned result:', JSON.stringify(resolveResponse.result));
    }
  });
});
