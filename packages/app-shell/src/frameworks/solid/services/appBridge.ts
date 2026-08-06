/**
 * appBridge — credential handoff and network proxying for embedded apps (we-iframe).
 *
 * A service, not a store: it exposes no reactive state to schemas or components. It exists so
 * embedded AD4M-ecosystem apps (e.g. Flux) inside `we-iframe` elements can reach the executor:
 *
 *   - AD4M_CONFIG handoff: iframes request credentials (REQUEST_AD4M_CONFIG) and receive either
 *     raw port/token (desktop — they open their own WebSocket) or `proxy: true` (web — browser
 *     PNA blocks them from reaching localhost, so they go through the postMessage proxy below).
 *   - AD4M_PROXY_WS_*: the host opens a real WebSocket on the iframe's behalf and relays frames.
 *   - AD4M_PROXY_HTTP_*: the host performs fetches from its privileged origin and replies.
 *
 * This is deliberately backend-ecosystem-specific and isolated here: a deployment that embeds no
 * external apps simply doesn't start it.
 */
import { createEffect } from 'solid-js';

export interface AppBridgeDeps {
  isDesktop: boolean;
  port: () => number | undefined;
  token: () => string | undefined;
  /** Explicit executor base URL (remote connections); falls back to localhost:port when absent. */
  serverUrl: () => string | undefined;
  /**
   * Whether the agent is unlocked — gates the desktop credential send (see effect below).
   *
   * Deliberately *not* the boot state: what the gate protects against is handing credentials to an
   * embedded app while the executor would answer "Agent is locked", and unlocked-ness is only
   * incidentally the same thing as "boot finished". Naming the real condition means a new boot
   * state (onboarding, say) can't silently start withholding credentials.
   */
  agentUnlocked: () => boolean;
}

/**
 * Starts the bridge: installs the window message listener immediately and registers an effect
 * that flushes a queued credential request once conditions are met. Call once, synchronously,
 * inside a reactive root, BEFORE any async boot work — REQUEST_AD4M_CONFIG from an embedded app
 * must never be dropped, including during the (possibly long) ad4m-connect auth flow on first
 * load where the embedded app's 30-second timeout would otherwise expire.
 *
 * Returns the sendConfig function so the boot path can also push credentials proactively.
 */
export function startAppBridge(deps: AppBridgeDeps) {
  // Tracks whether an iframe requested AD4M_CONFIG while credentials weren't available yet
  // (or, on desktop, while the agent was still locked).
  let pendingConfigRequest = false;

  function sendConfigToIframes() {
    const port = deps.port();
    const token = deps.token();
    if (port === undefined || token === undefined) return;

    // Send to ALL mounted we-iframe elements (there may be multiple apps)
    const weIframes = document.querySelectorAll('we-iframe') as NodeListOf<
      HTMLElement & { postMessage: (data: Record<string, unknown>, origin: string) => void }
    >;

    // On desktop, pass the raw port/token so the embedded app can open its own WebSocket.
    // On web, the embedded app cannot reach localhost directly (browser PNA enforcement),
    // so we tell it to use the postMessage proxy instead. Port is intentionally omitted.
    const url = deps.serverUrl();
    const payload: Record<string, unknown> = deps.isDesktop
      ? { type: 'AD4M_CONFIG', port, token, ...(url ? { url } : {}) }
      : { type: 'AD4M_CONFIG', token, proxy: true };

    let sent = 0;
    weIframes.forEach((el) => {
      if (typeof el.postMessage === 'function') {
        const rawSrc = el.getAttribute('src');
        const iframeOrigin = rawSrc ? new URL(rawSrc).origin : '*';
        el.postMessage(payload, iframeOrigin);
        sent++;
      }
    });

    if (sent === 0) {
      console.warn('appBridge: no we-iframe elements found to send AD4M_CONFIG');
    }
  }

  // Tracks live WebSocket proxies keyed by the iframe's contentWindow.
  // Used when the host forwards AD4M WebSocket traffic on behalf of embedded apps
  // that cannot open their own connections (e.g. browser PNA enforcement on web).
  // origin is stored so proxy response frames can be targeted to the specific iframe
  // origin rather than broadcast with '*'.
  const proxyConnections = new Map<Window, { ws: WebSocket; origin: string }>();

  const baseUrl = () => {
    const port = deps.port();
    return deps.serverUrl() ?? (port !== undefined ? `http://localhost:${port}` : null);
  };

  // Listen for requests from iframes asking for AD4M config.
  // Reads port/token from signals at call time so it works even when called before
  // credentials are available (e.g. during the web auth flow on first load).
  const handleMessage = (event: MessageEvent) => {
    const source = event.source as Window | null;

    // ── AD4M_PROXY_WS_* protocol ─────────────────────────────────────────
    // Embedded apps that receive proxy:true open no WebSocket themselves;
    // instead they send these messages and we proxy frames via a real WebSocket.

    if (event.data?.type === 'AD4M_PROXY_WS_CONNECT' && source) {
      // Gate: only serve requests from known we-iframe contentWindows.
      // we-iframe is a Lit web component — the real <iframe> lives inside its
      // shadow DOM, so we must look there rather than on the element itself.
      // Without this, any child iframe in WE's page could use WE as a
      // WebSocket proxy to the executor using WE's own auth token.
      const weIframesForWsCheck = document.querySelectorAll('we-iframe');
      const isKnownWsIframe = Array.from(weIframesForWsCheck).some(
        (el) => (el.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null)?.contentWindow === source,
      );
      if (!isKnownWsIframe) {
        console.warn('appBridge: rejected AD4M_PROXY_WS_CONNECT from unknown source');
        return;
      }

      // Close any stale connection for this frame
      const existing = proxyConnections.get(source);
      if (existing) {
        existing.ws.close();
        proxyConnections.delete(source);
      }

      // Pin to the verified origin of the requesting iframe so all proxy
      // response frames are delivered only to that origin.
      // Reject if origin is empty — we must never fall back to '*' for
      // frames carrying sensitive GraphQL responses.
      if (!event.origin) {
        console.warn('appBridge: rejected AD4M_PROXY_WS_CONNECT with empty origin');
        return;
      }
      const iframeOrigin = event.origin;

      const token = deps.token();
      const base = baseUrl();
      if (!base) {
        source.postMessage({ type: 'AD4M_PROXY_WS_ERROR' }, iframeOrigin);
        return;
      }

      const wsBase = base.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
      const tokenParam = token ? `token=${encodeURIComponent(token)}` : '';
      const wsUrl = tokenParam ? `${wsBase}/api/v1/ws?${tokenParam}` : `${wsBase}/api/v1/ws`;

      const ws = new WebSocket(wsUrl);
      proxyConnections.set(source, { ws, origin: iframeOrigin });

      ws.onopen = () => source.postMessage({ type: 'AD4M_PROXY_WS_OPEN' }, iframeOrigin);
      ws.onmessage = (e) => source.postMessage({ type: 'AD4M_PROXY_WS_MESSAGE', data: e.data }, iframeOrigin);
      ws.onerror = () => source.postMessage({ type: 'AD4M_PROXY_WS_ERROR' }, iframeOrigin);
      ws.onclose = (e) => {
        proxyConnections.delete(source);
        source.postMessage({ type: 'AD4M_PROXY_WS_CLOSED', code: e.code, reason: e.reason }, iframeOrigin);
      };
      return;
    }

    if (event.data?.type === 'AD4M_PROXY_WS_SEND' && source) {
      const entry = proxyConnections.get(source);
      if (entry && entry.ws.readyState === WebSocket.OPEN) {
        entry.ws.send(event.data.data as string);
      }
      return;
    }

    if (event.data?.type === 'AD4M_PROXY_WS_CLOSE' && source) {
      const entry = proxyConnections.get(source);
      if (entry) {
        entry.ws.close(event.data.code as number | undefined, event.data.reason as string | undefined);
        proxyConnections.delete(source);
      }
      return;
    }

    // ── AD4M_PROXY_HTTP_* protocol ────────────────────────────────────────
    // Embedded apps that received proxy:true cannot make direct HTTP requests
    // to the executor (cross-origin / PNA). They send AD4M_PROXY_HTTP_REQUEST
    // and we make the real fetch from our privileged origin, then reply.
    if (event.data?.type === 'AD4M_PROXY_HTTP_REQUEST' && source) {
      // Gate: only serve requests from known we-iframe contentWindows, not from
      // arbitrary third-party pages that may have embedded WE as a child frame.
      // we-iframe is a Lit web component — the real <iframe> lives inside its shadow DOM.
      const weIframesForHttpCheck = document.querySelectorAll('we-iframe');
      const isKnownIframe = Array.from(weIframesForHttpCheck).some(
        (el) => (el.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null)?.contentWindow === source,
      );
      if (!isKnownIframe) {
        console.warn('appBridge: rejected AD4M_PROXY_HTTP_REQUEST from unknown source');
        return;
      }

      const { id, url, method, headers, body } = event.data as {
        id: string;
        url: string;
        method: string;
        headers: Record<string, string>;
        body: ArrayBuffer | null;
      };
      const iframeOrigin = event.origin || '*';

      if (typeof url !== 'string' || typeof method !== 'string') {
        console.warn('appBridge: rejected AD4M_PROXY_HTTP_REQUEST with invalid url/method type');
        return;
      }

      const base = baseUrl();
      if (!base) {
        source.postMessage({ type: 'AD4M_PROXY_HTTP_ERROR', id, message: 'No executor URL available' }, iframeOrigin);
        return;
      }

      // Replace the placeholder origin with the real executor base URL.
      const realUrl = url.replace(/^http:\/\/proxy(?=\/|$)/, base);

      (async () => {
        try {
          const response = await fetch(realUrl, { method, headers, body: body ?? undefined });
          const responseBody = await response.arrayBuffer();
          source.postMessage(
            {
              type: 'AD4M_PROXY_HTTP_RESPONSE',
              id,
              status: response.status,
              statusText: response.statusText,
              body: responseBody,
            },
            iframeOrigin,
            [responseBody],
          );
        } catch (e) {
          source.postMessage(
            { type: 'AD4M_PROXY_HTTP_ERROR', id, message: e instanceof Error ? e.message : String(e) },
            iframeOrigin,
          );
        }
      })();
      return;
    }

    // ─────────────────────────────────────────────────────────────────────

    if (event.data?.type === 'REQUEST_AD4M_CONFIG') {
      // Immediately acknowledge so the embedded app knows the parent window is alive and
      // its "parent not found" timeout can be safely cancelled. The actual AD4M_CONFIG
      // follows as soon as credentials are available (possibly much later, after auth).
      if (source) {
        source.postMessage({ type: 'AD4M_CONFIG_ACK' }, event.origin || '*');
      }

      const port = deps.port();
      const token = deps.token();
      const agentReady = !deps.isDesktop || deps.agentUnlocked();
      if (port !== undefined && token !== undefined && agentReady) {
        // Credentials available and agent is unlocked — respond immediately
        sendConfigToIframes();
      } else {
        // Either credentials not yet available, or on desktop the agent is still locked.
        // Queue; the effect below flushes once conditions are met.
        pendingConfigRequest = true;
      }
    }
  };

  window.addEventListener('message', handleMessage);

  // Send AD4M_CONFIG to iframes as soon as credentials are available AND the agent is unlocked.
  //
  // The two platforms have different timing:
  //
  // Web: port+token are set by backend.connectionDetails() AFTER ad4m-connect's auth UI completes,
  // so the agent is already unlocked at that point. We send immediately — no need to wait for
  // the rest of the boot chain, which would add unnecessary delay against the ACK-cleared but
  // still-finite wait in ad4m-connect.
  //
  // Desktop: port+token are set early (before the session is usable) from stored credentials,
  // while the agent may still be locked waiting for the user's password. Sending AD4M_CONFIG here
  // would cause ad4m-connect's checkAuth() to fail with "Agent is locked". We must wait until the
  // agent is unlocked first.
  createEffect(() => {
    const port = deps.port();
    const token = deps.token();
    // Always read agentUnlocked() before any early returns so SolidJS tracks it as a dependency.
    // Without this, when pendingConfigRequest is false on the first run, agentUnlocked() would
    // never be accessed and the effect would not re-run when the agent unlocks.
    const unlocked = deps.agentUnlocked();
    if (!pendingConfigRequest || port === undefined || token === undefined) return;
    if (deps.isDesktop && !unlocked) return;
    pendingConfigRequest = false;
    sendConfigToIframes();
  });

  return {
    /** Push credentials to all mounted iframes now (no-op while credentials are missing). */
    sendConfigToIframes,
    /** Remove the listener and close any open proxy WebSocket connections. */
    stop: () => {
      window.removeEventListener('message', handleMessage);
      proxyConnections.forEach(({ ws }) => ws.close());
      proxyConnections.clear();
    },
  };
}
