/**
 * The app bridge decides who gets the executor token.
 *
 * That token is unrestricted access to everything the agent has: every space, every message, their
 * identity. The bridge hands it to embedded apps, and until this test existed the only question it
 * asked was "are you a `we-iframe`?" — which is not a question about trust at all. Two of the three
 * places that render a `we-iframe` take their URL straight from post content (`EmbedDisplay` from
 * an EmbedBlock's `url`, `VideoDisplay` from an embed URL), so the answer was yes for a frame
 * pointed at anywhere in the world, chosen by whoever wrote the post.
 *
 * Every case below is that attack in one of its four shapes — credential handoff, the ack, the
 * WebSocket proxy, the HTTP proxy — plus the SSRF the HTTP proxy allowed even to a legitimate app.
 */
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startAppBridge } from '../src/frameworks/solid/services/appBridge';

const APP_ORIGIN = 'https://app.example';
const ATTACKER_ORIGIN = 'https://attacker.example';

/**
 * A stand-in for `we-iframe`: a custom element with a shadow root holding a real `<iframe>`, which
 * is the shape the bridge looks for. The contentWindow is a plain object — the bridge only ever
 * compares it by identity and calls `postMessage` on it.
 */
function mountFrame(src: string) {
  const el = document.createElement('we-iframe');
  el.setAttribute('src', src);
  const posted: { data: unknown; origin: string }[] = [];
  (el as unknown as { postMessage: (d: unknown, o: string) => void }).postMessage = (data, origin) =>
    posted.push({ data, origin });

  const shadow = el.attachShadow({ mode: 'open' });
  const inner = document.createElement('iframe');
  const contentWindow = { postMessage: (data: unknown, origin: string) => posted.push({ data, origin }) };
  Object.defineProperty(inner, 'contentWindow', { value: contentWindow });
  shadow.appendChild(inner);
  document.body.appendChild(el);

  return { el, posted, source: contentWindow as unknown as Window };
}

function send(source: Window, origin: string, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as unknown as MessageEventSource }));
}

let dispose: () => void;
let bridge: ReturnType<typeof startAppBridge>;
const sendConfig = () => bridge.sendConfigToIframes();

beforeEach(() => {
  document.body.innerHTML = '';
  createRoot((d) => {
    dispose = d;
    bridge = startAppBridge({
      isDesktop: true,
      port: () => 12000,
      token: () => 'SECRET-TOKEN',
      serverUrl: () => 'http://localhost:12000',
      agentUnlocked: () => true,
      credentialedOrigins: () => [`${APP_ORIGIN}/flux/`],
    });
  });
});

afterEach(() => {
  bridge?.stop();
  dispose?.();
});

describe('who receives the executor token', () => {
  it('sends it to a frame showing a registered app', () => {
    const app = mountFrame(`${APP_ORIGIN}/flux/`);
    sendConfig();

    expect(app.posted).toHaveLength(1);
    expect(app.posted[0]).toMatchObject({ origin: APP_ORIGIN, data: { token: 'SECRET-TOKEN' } });
  });

  it('sends it to nobody when the only frame is an embed out of a post', () => {
    // The whole finding: a post containing an embed pointed anywhere was enough to be handed the
    // token, because being a `we-iframe` was the entire check.
    const embed = mountFrame(`${ATTACKER_ORIGIN}/page`);
    sendConfig();

    expect(embed.posted).toEqual([]);
  });

  it('still reaches the app when a hostile embed is on the page beside it', () => {
    const app = mountFrame(`${APP_ORIGIN}/flux/`);
    const embed = mountFrame(`${ATTACKER_ORIGIN}/page`);
    sendConfig();

    expect(app.posted).toHaveLength(1);
    expect(embed.posted).toEqual([]);
  });

  it('sends it to nobody rather than to "*" when a src cannot be parsed', () => {
    const broken = mountFrame('not a url');
    sendConfig();

    expect(broken.posted).toEqual([]);
  });
});

describe('REQUEST_AD4M_CONFIG', () => {
  it('answers a registered app', () => {
    const app = mountFrame(`${APP_ORIGIN}/flux/`);
    send(app.source, APP_ORIGIN, { type: 'REQUEST_AD4M_CONFIG' });

    const types = app.posted.map((p) => (p.data as { type: string }).type);
    expect(types).toContain('AD4M_CONFIG_ACK');
    expect(types).toContain('AD4M_CONFIG');
  });

  it('does not even acknowledge an unregistered frame', () => {
    // The ack carries nothing, but confirming "WE is your parent and it is listening" is the first
    // step of the attack rather than a courtesy.
    const embed = mountFrame(`${ATTACKER_ORIGIN}/page`);
    send(embed.source, ATTACKER_ORIGIN, { type: 'REQUEST_AD4M_CONFIG' });

    expect(embed.posted).toEqual([]);
  });
});

describe('the proxies', () => {
  it('refuses a WebSocket proxy for an unregistered frame', () => {
    const ws = vi.fn();
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor(...args: unknown[]) {
          ws(...args);
        }
        close() {}
      },
    );

    const embed = mountFrame(`${ATTACKER_ORIGIN}/page`);
    send(embed.source, ATTACKER_ORIGIN, { type: 'AD4M_PROXY_WS_CONNECT' });

    expect(ws).not.toHaveBeenCalled();
    expect(embed.posted).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('refuses an HTTP proxy request for an unregistered frame', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const embed = mountFrame(`${ATTACKER_ORIGIN}/page`);
    send(embed.source, ATTACKER_ORIGIN, {
      type: 'AD4M_PROXY_HTTP_REQUEST',
      id: '1',
      url: 'http://proxy/graphql',
      method: 'POST',
      headers: {},
      body: null,
    });

    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('refuses to fetch a URL that is not the proxy placeholder, even for the real app', async () => {
    /*
      The SSRF. The rewrite was `url.replace(/^http:\/\/proxy/, base)`, and a `replace` that does not
      match does nothing — so any other URL was fetched verbatim from WE's origin, on the user's
      local network, with the body relayed back. A port scanner with a read channel.
    */
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const app = mountFrame(`${APP_ORIGIN}/flux/`);
    send(app.source, APP_ORIGIN, {
      type: 'AD4M_PROXY_HTTP_REQUEST',
      id: '1',
      url: 'http://192.168.1.1/admin',
      method: 'GET',
      headers: {},
      body: null,
    });

    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(app.posted.at(-1)?.data).toMatchObject({ type: 'AD4M_PROXY_HTTP_ERROR' });
    vi.unstubAllGlobals();
  });

  it('still proxies a real placeholder URL to the executor', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal('fetch', fetchMock);

    const app = mountFrame(`${APP_ORIGIN}/flux/`);
    send(app.source, APP_ORIGIN, {
      type: 'AD4M_PROXY_HTTP_REQUEST',
      id: '1',
      url: 'http://proxy/graphql',
      method: 'POST',
      headers: {},
      body: null,
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:12000/graphql');
    vi.unstubAllGlobals();
  });
});
