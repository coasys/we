/**
 * What each web connector tells the ports about the node's operator.
 *
 * The executor keeps some calls — installing and running local AI — to its operator credential, and
 * the ports offer them only where `operator` is true. So a connector that passed the wrong answer
 * either hides working controls from the operator or offers controls the executor refuses. These
 * tests read what each connector hands `createAd4mBackendPorts`, with the real credential check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const created = vi.hoisted(() => ({
  options: [] as { operator?: boolean }[],
  token: '',
  client: undefined as unknown,
  /** What each session client was constructed with, and whether it was closed. */
  clients: [] as { args: unknown[]; closed: boolean }[],
  /** connect's embedded-proxy transport, as `AD4M_CONFIG { proxy: true }` leaves it on the core. */
  proxy: undefined as undefined | { baseUrl: string; options: Record<string, unknown> },
}));

vi.mock('@coasys/ad4m', async (importActual) => {
  const actual = await importActual<typeof import('@coasys/ad4m')>();
  class RecordingClient extends actual.Ad4mClient {
    #record: { args: unknown[]; closed: boolean };
    constructor(...args: ConstructorParameters<typeof actual.Ad4mClient>) {
      super(...args);
      this.#record = { args, closed: false };
      created.clients.push(this.#record);
    }
    close() {
      this.#record.closed = true;
      super.close();
    }
  }
  return { ...actual, Ad4mClient: RecordingClient };
});

vi.mock('@we/backend-ad4m', async (importActual) => ({
  ...(await importActual<typeof import('@we/backend-ad4m')>()),
  createAd4mBackendPorts: (client: unknown, _ctx: unknown, options: { operator?: boolean }) => {
    created.client = client;
    created.options.push(options);
    return {};
  },
}));

vi.mock('@we/seed-file', () => ({ default: { ad4m: {} } }));

vi.mock('./storedSession', () => ({ storedGuestHost: () => null, hasStoredSession: () => false }));

function fakeCore() {
  return {
    connectedHost: undefined,
    isMultiUser: async () => false,
    get token() {
      return created.token;
    },
    baseUrl: 'http://localhost:12000',
    get proxy() {
      return created.proxy;
    },
    port: 12000,
    userInfo: undefined,
    disconnect: () => {},
    connectAsGuest: async () => ({}),
  };
}

vi.mock('@coasys/ad4m-connect', () => ({
  getAd4mConnect: () => ({ core: fakeCore(), client: Promise.resolve({}) }),
}));

vi.mock('@coasys/ad4m-connect/core', () => ({
  default: function Ad4mConnect() {
    return fakeCore();
  },
}));

// A grant is a JWT: three dot-separated parts. The operator credential is not.
const GRANT = 'eyJhbGciOiJFUzI1NiJ9.eyJjYXBhYmlsaXRpZXMiOltdfQ.c2lnbmF0dXJl';
const OPERATOR = 'the-admin-credential';

beforeEach(() => {
  created.options = [];
  created.clients = [];
  created.proxy = undefined;
  vi.stubGlobal('window', { location: { origin: 'https://we.example.test', href: 'https://we.example.test/' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// The first dynamic import of a connector transforms its module graph (later imports hit the
// shared module cache). The guest one takes ~3.5 s on a CI runner, and over vitest's 5 s default
// when several PRs run at once.
const IMPORT_TIMEOUT = 30_000;

describe('the WE web connector', () => {
  it('passes operator: holdsOperatorCredential(token)', { timeout: IMPORT_TIMEOUT }, async () => {
    const { holdsOperatorCredential } = await import('@we/backend-ad4m');
    const { ad4mConnector } = await import('./ad4mConnector');

    for (const token of [GRANT, OPERATOR]) {
      created.token = token;
      await ad4mConnector.initialize({} as never);
      expect(created.options.at(-1)?.operator).toBe(holdsOperatorCredential(token));
    }
    // Both answers were exercised: the app's grant is not the operator, the admin credential is.
    expect(created.options.map((o) => o.operator)).toEqual([false, true]);
  });

  it(
    "hands the ports a client of this bundle's own SDK, not connect's vendored one",
    { timeout: IMPORT_TIMEOUT },
    async () => {
      const { Ad4mClient } = await import('@coasys/ad4m');
      const { ad4mConnector } = await import('./ad4mConnector');

      created.token = GRANT;
      await ad4mConnector.initialize({} as never);

      // ad4m-connect resolves its auth flow with a client from the SDK copy it vendored — an
      // older one, without perspective.mount / shapes / instance* — so the session's client is
      // built on this bundle's own @coasys/ad4m from the same url and token.
      expect(created.client).toBeInstanceOf(Ad4mClient);
    },
  );

  it(
    "keeps connect's embedded proxy transport rather than dialling the executor directly",
    { timeout: IMPORT_TIMEOUT },
    async () => {
      const { ad4mConnector } = await import('./ad4mConnector');
      class PostMessageWs {}
      const fetchImpl = async () => new Response();
      created.proxy = { baseUrl: 'http://proxy', options: { webSocketImpl: PostMessageWs, fetchImpl } };
      created.token = GRANT;

      await ad4mConnector.initialize({} as never);

      // In proxy mode connect's own baseUrl names no reachable executor: frames go through the
      // parent by postMessage. The session client has to ride the same transport.
      expect(created.clients).toHaveLength(1);
      const [url, token, options] = created.clients[0].args as [string, string, Record<string, unknown>];
      expect(url).toBe('http://proxy');
      expect(token).toBe(GRANT);
      expect(options.webSocketImpl).toBe(PostMessageWs);
      expect(options.fetchImpl).toBe(fetchImpl);
    },
  );

  it('dials the executor at connect’s baseUrl when there is no proxy', { timeout: IMPORT_TIMEOUT }, async () => {
    const { ad4mConnector } = await import('./ad4mConnector');
    created.token = GRANT;
    await ad4mConnector.initialize({} as never);
    expect(created.clients.map((c) => c.args.slice(0, 2))).toEqual([['http://localhost:12000', GRANT]]);
  });
});

describe('the guest connector', () => {
  it('passes operator: false, whatever the token is', { timeout: IMPORT_TIMEOUT }, async () => {
    const { createGuestConnector } = await import('./guestConnector');

    for (const token of [GRANT, OPERATOR]) {
      created.token = token;
      await createGuestConnector('https://node.example.org').initialize({} as never);
    }
    expect(created.options.map((o) => o.operator)).toEqual([false, false]);
  });

  it("keeps connect's embedded proxy transport", { timeout: IMPORT_TIMEOUT }, async () => {
    const { createGuestConnector } = await import('./guestConnector');
    class PostMessageWs {}
    created.proxy = { baseUrl: 'http://proxy', options: { webSocketImpl: PostMessageWs } };
    created.token = GRANT;
    await createGuestConnector('https://node.example.org').initialize({} as never);
    const [url, , options] = created.clients[0].args as [string, string, Record<string, unknown>];
    expect(url).toBe('http://proxy');
    expect(options.webSocketImpl).toBe(PostMessageWs);
  });
});
