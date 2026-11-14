/**
 * What each web connector tells the ports about the node's operator.
 *
 * The executor keeps some calls — installing and running local AI — to its operator credential, and
 * the ports offer them only where `operator` is true. So a connector that passed the wrong answer
 * either hides working controls from the operator or offers controls the executor refuses. These
 * tests read what each connector hands `createAd4mBackendPorts`, with the real credential check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const created = vi.hoisted(() => ({ options: [] as { operator?: boolean }[], token: '' }));

vi.mock('@we/backend-ad4m', async (importActual) => ({
  ...(await importActual<typeof import('@we/backend-ad4m')>()),
  createAd4mBackendPorts: (_client: unknown, _ctx: unknown, options: { operator?: boolean }) => {
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
    port: 12000,
    userInfo: undefined,
    disconnect: () => {},
    connectAsGuest: async () => ({}),
    authState: 'authenticated',
    addEventListener: () => {},
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
  vi.stubGlobal('window', { location: { origin: 'https://we.example.test', href: 'https://we.example.test/' } });
  vi.stubGlobal('document', { querySelectorAll: () => [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the WE web connector', () => {
  it('passes operator: holdsOperatorCredential(token)', async () => {
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
});

describe('the guest connector', () => {
  it('passes operator: false, whatever the token is', async () => {
    const { createGuestConnector } = await import('./guestConnector');

    for (const token of [GRANT, OPERATOR]) {
      created.token = token;
      await createGuestConnector('https://node.example.org').initialize({} as never);
    }
    expect(created.options.map((o) => o.operator)).toEqual([false, false]);
  });
});

describe("AD4M Connect's settings button", () => {
  it('is hidden while signed in and shows again when the session ends', async () => {
    const element = { style: { display: '' } };
    vi.stubGlobal('document', { querySelectorAll: () => [element] });
    let onChange = () => {};
    const core = {
      authState: 'authenticated',
      addEventListener: (_: string, listener: () => void) => {
        onChange = listener;
      },
    };
    const { hideWhileSignedIn } = await import('./ad4mConnector');
    hideWhileSignedIn(core as never);
    expect(element.style.display).toBe('none');
    core.authState = 'unauthenticated';
    onChange();
    expect(element.style.display).toBe('');
  });
});
