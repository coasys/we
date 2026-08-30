/**
 * Platform backend connector.
 *
 * Replaces the ad4m-connect dialog with the platform's own auth flow:
 *   1. Check for stored platform JWT → try refresh
 *   2. If no session → mount login/signup UI and wait for auth
 *   3. On auth success → get AD4M credentials from Worker response
 *   4. Connect to assigned executor with those credentials
 *   5. Return BackendInitResult
 *
 * The auth UI mounts a self-contained login form into the DOM during boot, similar to how
 * ad4m-connect injects its own connect dialog. After auth completes, the form unmounts and
 * the WE shell takes over rendering (including the platform module's schema fragments for
 * billing, usage, etc.).
 */
import { Ad4mClient } from '@coasys/ad4m';
import type { BackendConnector, BackendInitResult } from '@we/app-shell/shared';
import { createAd4mBackendPorts } from '@we/backend-ad4m';
import { type AuthResult, PlatformApi } from '@we/module-platform';

// ─── Session persistence ────────────────────────────────────────────────────

const STORAGE_TOKEN = 'platform:token';
const STORAGE_REFRESH = 'platform:refreshToken';
const STORAGE_EXECUTOR = 'platform:executorUrl';
const STORAGE_AD4M_EMAIL = 'platform:ad4mEmail';
const STORAGE_AD4M_PASSWORD = 'platform:ad4mPassword';

interface StoredSession {
  token: string;
  refreshToken: string;
  executorUrl: string;
  ad4mEmail: string;
  ad4mPassword: string;
}

function loadSession(): StoredSession | null {
  const token = localStorage.getItem(STORAGE_TOKEN);
  const refreshToken = localStorage.getItem(STORAGE_REFRESH);
  const executorUrl = localStorage.getItem(STORAGE_EXECUTOR);
  const ad4mEmail = localStorage.getItem(STORAGE_AD4M_EMAIL);
  const ad4mPassword = localStorage.getItem(STORAGE_AD4M_PASSWORD);
  if (!token || !refreshToken || !executorUrl || !ad4mEmail || !ad4mPassword) return null;
  return { token, refreshToken, executorUrl, ad4mEmail, ad4mPassword };
}

function saveSession(result: AuthResult): void {
  localStorage.setItem(STORAGE_TOKEN, result.token);
  localStorage.setItem(STORAGE_REFRESH, result.refreshToken);
  localStorage.setItem(STORAGE_EXECUTOR, result.executor.url);
  localStorage.setItem(STORAGE_AD4M_EMAIL, result.ad4m.email);
  localStorage.setItem(STORAGE_AD4M_PASSWORD, result.ad4m.password);
}

function clearSession(): void {
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_REFRESH);
  localStorage.removeItem(STORAGE_EXECUTOR);
  localStorage.removeItem(STORAGE_AD4M_EMAIL);
  localStorage.removeItem(STORAGE_AD4M_PASSWORD);
}

// ─── Executor connection ────────────────────────────────────────────────────

async function connectToExecutor(
  executorUrl: string,
  ad4mEmail: string,
  ad4mPassword: string,
): Promise<{ client: Ad4mClient; token: string }> {
  // The executor URL from the Worker points at the tunnel (e.g. https://executor-1.coasys.org).
  // AD4M client connects via WebSocket at /graphql.
  const wsUrl = executorUrl.replace(/^http/, 'ws') + '/graphql';
  const client = new Ad4mClient(wsUrl);

  // Login to the executor with the platform-generated AD4M credentials.
  // This returns the AD4M JWT, which the client stores internally for subsequent calls.
  const ad4mToken = await client.agent.login(ad4mEmail, ad4mPassword);

  return { client, token: ad4mToken };
}

// ─── Auth UI ────────────────────────────────────────────────────────────────

/**
 * Mount a self-contained login/signup form and wait for authentication.
 *
 * Returns the AuthResult from the Worker once the user has authenticated.
 * The form handles its own mode toggle (login ↔ signup) and error display.
 */
function waitForAuth(api: PlatformApi): Promise<AuthResult> {
  return new Promise<AuthResult>((resolve) => {
    const container = document.createElement('div');
    container.id = 'platform-auth';
    Object.assign(container.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '10000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--we-color-surface, #1a1a2e)',
      fontFamily: 'var(--we-font-family, system-ui, -apple-system, sans-serif)',
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      width: '360px',
      padding: '48px 32px',
      background: 'var(--we-color-surface-raised, #25253e)',
      borderRadius: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
    });

    const inputCss = [
      'width: 100%',
      'padding: 10px 14px',
      'border-radius: 8px',
      'border: 1px solid var(--we-color-border, #3a3a5c)',
      'background: var(--we-color-surface, #1a1a2e)',
      'color: var(--we-color-text, #e0e0f0)',
      'font-size: 14px',
      'outline: none',
      'box-sizing: border-box',
    ].join('; ');

    const btnCss = [
      'width: 100%',
      'padding: 10px',
      'border-radius: 8px',
      'background: var(--we-color-accent, #6366f1)',
      'color: white',
      'border: none',
      'font-size: 14px',
      'cursor: pointer',
      'font-weight: 500',
    ].join('; ');

    let mode: 'login' | 'signup' = 'login';
    const errorEl = document.createElement('div');
    errorEl.style.cssText = 'color: #ef4444; font-size: 13px; min-height: 20px;';

    function render() {
      card.innerHTML = '';

      const title = document.createElement('h2');
      title.textContent = mode === 'login' ? 'Sign in to Coasys' : 'Create account';
      title.style.cssText =
        'margin: 0 0 8px; color: var(--we-color-text, #e0e0f0); font-size: 22px; text-align: center;';
      card.appendChild(title);

      const emailInput = document.createElement('input');
      emailInput.type = 'email';
      emailInput.placeholder = 'Email';
      emailInput.style.cssText = inputCss;
      card.appendChild(emailInput);

      const passwordInput = document.createElement('input');
      passwordInput.type = 'password';
      passwordInput.placeholder = 'Password';
      passwordInput.style.cssText = inputCss;
      card.appendChild(passwordInput);

      let inviteInput: HTMLInputElement | undefined;
      if (mode === 'signup') {
        inviteInput = document.createElement('input');
        inviteInput.placeholder = 'Invite code';
        inviteInput.style.cssText = inputCss;
        card.appendChild(inviteInput);
      }

      card.appendChild(errorEl);

      const submitBtn = document.createElement('button');
      submitBtn.textContent = mode === 'login' ? 'Sign in' : 'Create account';
      submitBtn.style.cssText = btnCss;
      submitBtn.addEventListener('click', async () => {
        errorEl.textContent = '';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Loading…';
        try {
          const result =
            mode === 'login'
              ? await api.login(emailInput.value, passwordInput.value)
              : await api.signup(emailInput.value, passwordInput.value, inviteInput!.value);
          saveSession(result);
          container.remove();
          resolve(result);
        } catch (err: unknown) {
          errorEl.textContent = (err as Error).message || 'Authentication failed';
          submitBtn.disabled = false;
          submitBtn.textContent = mode === 'login' ? 'Sign in' : 'Create account';
        }
      });
      card.appendChild(submitBtn);

      const toggle = document.createElement('button');
      toggle.textContent = mode === 'login' ? 'Create an account' : 'Already have an account?';
      toggle.style.cssText =
        'background: none; border: none; color: var(--we-color-accent, #6366f1); cursor: pointer; font-size: 13px; padding: 4px;';
      toggle.addEventListener('click', () => {
        mode = mode === 'login' ? 'signup' : 'login';
        errorEl.textContent = '';
        render();
      });
      card.appendChild(toggle);

      const selfHost = document.createElement('div');
      selfHost.style.cssText = 'text-align: center; font-size: 12px; color: var(--we-color-text-muted, #8888aa);';
      selfHost.innerHTML =
        'Prefer to self-host? <a href="https://docs.coasys.org/self-host" target="_blank" rel="noopener" style="color: var(--we-color-accent, #6366f1);">Learn more</a>';
      card.appendChild(selfHost);
    }

    render();
    container.appendChild(card);
    document.body.appendChild(container);
  });
}

// ─── Connector ──────────────────────────────────────────────────────────────

export const platformConnector: BackendConnector = {
  async initialize(ctx): Promise<BackendInitResult> {
    const apiBaseUrl = import.meta.env.VITE_PLATFORM_API_URL ?? window.location.origin;
    const api = new PlatformApi(apiBaseUrl);

    let executorUrl: string;
    let ad4mEmail: string;
    let ad4mPassword: string;

    // Try to restore a stored session.
    const stored = loadSession();
    if (stored) {
      try {
        // Verify the token still works by refreshing.
        const refreshed = await api.refresh(stored.refreshToken);
        localStorage.setItem(STORAGE_TOKEN, refreshed.token);
        executorUrl = stored.executorUrl;
        ad4mEmail = stored.ad4mEmail;
        ad4mPassword = stored.ad4mPassword;
      } catch {
        // Session expired. Clear and fall through to auth UI.
        clearSession();
        const result = await waitForAuth(api);
        executorUrl = result.executor.url;
        ad4mEmail = result.ad4m.email;
        ad4mPassword = result.ad4m.password;
      }
    } else {
      // Check for guest entry via URL params: /join/<id> or ?space=<id>.
      const params = new URLSearchParams(window.location.search);
      const guestSpaceParam = params.get('space');
      const pathParts = window.location.pathname.split('/');
      const joinIdx = pathParts.indexOf('join');
      const guestSpacePath = joinIdx >= 0 ? pathParts[joinIdx + 1] : null;
      const guestSpace = guestSpaceParam ?? guestSpacePath;

      if (guestSpace) {
        const result = await api.guestEntry(guestSpace);
        saveSession(result);
        executorUrl = result.executor.url;
        ad4mEmail = result.ad4m.email;
        ad4mPassword = result.ad4m.password;
      } else {
        // No session. Show auth UI and wait.
        const result = await waitForAuth(api);
        executorUrl = result.executor.url;
        ad4mEmail = result.ad4m.email;
        ad4mPassword = result.ad4m.password;
      }
    }

    // Connect to the assigned AD4M executor.
    const { client, token: ad4mToken } = await connectToExecutor(executorUrl, ad4mEmail, ad4mPassword);

    return {
      client,
      ports: createAd4mBackendPorts(client, ctx, {
        // Hosted platform — the user never administers the executor.
        administersNode: false,
        capabilities: { read: true, write: true, ai: true },
      }),
      host: {
        id: 'coasys-platform',
        name: 'Coasys Platform',
        url: executorUrl,
      },
      account: {
        email: ad4mEmail,
      },
      disconnect: async () => {
        clearSession();
        window.location.reload();
      },
      connection: {
        port: parseInt(new URL(executorUrl).port || '12000', 10),
        token: ad4mToken,
        url: executorUrl,
      },
    };
  },
};
