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
 *
 * ## Which iframes count
 *
 * Everything below is gated on `isCredentialedOrigin`, and that gate is the whole security model of
 * this file. Being a `we-iframe` is not evidence of anything: two of the three places that render
 * one take their URL straight from post content — `EmbedDisplay` renders an EmbedBlock's `url`, and
 * `VideoDisplay` an embed URL. So a post containing an embed pointing anywhere at all used to be
 * enough: the page inside it sends `REQUEST_AD4M_CONFIG`, and the reply carried the executor token,
 * which is unrestricted access to everything the agent has. A link in a post, for the whole node.
 *
 * The allowlist is the *registered* embeds — `moduleRegistry.embeds()`, which come from bundled
 * feature modules and are therefore code rather than data. That is the distinction that matters:
 * anything an attacker can author is on the wrong side of it.
 */
import { createEffect } from 'solid-js';

import { moduleRegistry } from '../../../shared/registries/moduleRegistry';

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
  /**
   * Origins allowed to receive credentials and use the proxies. Defaults to the registered embeds,
   * which is what a real deployment wants; injectable so a test can state its own.
   */
  credentialedOrigins?: () => string[];
}

/** The stand-in origin an embedded app addresses the executor by. */
const PROXY_PLACEHOLDER = /^http:\/\/proxy(?=\/|$)/;

/** The origin of a URL, or null if it has none we could compare against. */
function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    // A relative embed URL resolves against this document, so its origin is our own — which is
    // correct: an app served from WE's own origin is as trusted as WE.
    return new URL(url, window.location.href).origin;
  } catch {
    return null;
  }
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

  const credentialedOrigins = () => deps.credentialedOrigins?.() ?? moduleRegistry.embeds().map((embed) => embed.url);

  /** Whether an origin belongs to a registered embed — see the note at the top of this file. */
  function isCredentialedOrigin(origin: string | null | undefined): boolean {
    if (!origin) return false;
    return credentialedOrigins().some((url) => originOf(url) === origin);
  }

  /**
   * The `we-iframe` whose inner frame is this window, if it is one we would credential.
   *
   * Two conditions, and both are load-bearing. The contentWindow match says the sender is an iframe
   * this document mounted rather than a page that embedded WE. The origin check says it is an
   * iframe pointed at a registered app rather than at a URL out of a post — the check that was
   * missing, and the reason an EmbedBlock could ask for the executor token.
   *
   * `we-iframe` is a Lit element, so the real `<iframe>` is in its shadow root, not on the element.
   */
  function credentialedFrameFor(source: Window | null, origin: string): Element | null {
    if (!source || !isCredentialedOrigin(origin)) return null;
    return (
      Array.from(document.querySelectorAll('we-iframe')).find(
        (el) => (el.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null)?.contentWindow === source,
      ) ?? null
    );
  }

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
      if (typeof el.postMessage !== 'function') return;

      // Never `'*'`. The payload is the executor token, so an unparseable or unregistered src means
      // no send at all — not a broadcast to whoever happens to be in the frame.
      const iframeOrigin = originOf(el.getAttribute('src'));
      if (!isCredentialedOrigin(iframeOrigin)) return;

      el.postMessage(payload, iframeOrigin!);
      sent++;
    });

    if (sent === 0) {
      console.warn('appBridge: no registered-app we-iframe found to send AD4M_CONFIG');
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
      // The proxy opens a WebSocket to the executor carrying WE's own auth token, so serving one is
      // the same act as handing over the token. Gated identically: a frame this document mounted,
      // pointed at a registered app. `event.origin` empty fails the check, which is what we want —
      // a proxy frame carrying GraphQL responses must never be sent to '*'.
      if (!credentialedFrameFor(source, event.origin)) {
        console.warn('appBridge: rejected AD4M_PROXY_WS_CONNECT from an unregistered source');
        return;
      }
      const iframeOrigin = event.origin;

      // Close any stale connection for this frame
      const existing = proxyConnections.get(source);
      if (existing) {
        existing.ws.close();
        proxyConnections.delete(source);
      }

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
      if (!credentialedFrameFor(source, event.origin)) {
        console.warn('appBridge: rejected AD4M_PROXY_HTTP_REQUEST from an unregistered source');
        return;
      }

      const { id, url, method, headers, body } = event.data as {
        id: string;
        url: string;
        method: string;
        headers: Record<string, string>;
        body: ArrayBuffer | null;
      };
      // Verified above, so never '*'.
      const iframeOrigin = event.origin;

      if (typeof url !== 'string' || typeof method !== 'string') {
        console.warn('appBridge: rejected AD4M_PROXY_HTTP_REQUEST with invalid url/method type');
        return;
      }

      /*
        The URL must name the placeholder origin, and this is a rejection rather than a rewrite.

        It used to be `url.replace(/^http:\/\/proxy/, base)` — and a `replace` that does not match
        does nothing, so any other URL was fetched exactly as sent. From WE's origin, on the local
        network, with the response body relayed back: `http://192.168.1.1/`, another service on
        localhost, a metadata endpoint. A port scanner with a read channel, driven by the embedded
        app. The proxy exists to reach the executor; nothing else is a valid destination.
      */
      if (!PROXY_PLACEHOLDER.test(url)) {
        console.warn('appBridge: rejected AD4M_PROXY_HTTP_REQUEST for a non-proxy URL');
        source.postMessage(
          { type: 'AD4M_PROXY_HTTP_ERROR', id, message: 'Only http://proxy/... URLs may be proxied' },
          iframeOrigin,
        );
        return;
      }

      const base = baseUrl();
      if (!base) {
        source.postMessage({ type: 'AD4M_PROXY_HTTP_ERROR', id, message: 'No executor URL available' }, iframeOrigin);
        return;
      }

      // Replace the placeholder origin with the real executor base URL.
      const realUrl = url.replace(PROXY_PLACEHOLDER, base);

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
      //
      // Gated like everything else, and the `|| '*'` is gone with it. The ack carries nothing, but
      // an unregistered frame learning that WE is its parent and is listening is the first step of
      // the attack rather than a courtesy — and it should be told nothing at all.
      if (!credentialedFrameFor(source, event.origin)) return;
      source!.postMessage({ type: 'AD4M_CONFIG_ACK' }, event.origin);

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
