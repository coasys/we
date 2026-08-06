/**
 * RuntimeStore: capability degradation and the consent queue.
 *
 * The two properties worth pinning. **Degradation** — a backend supplying no runtime port must
 * leave every flag false rather than throwing, because that is precisely the in-memory backend's
 * situation and the settings template gates whole sections on those flags. **The consent queue** —
 * requests raised while the app runs must not be dropped, since a dropped one is indistinguishable
 * from the bug this store exists to fix: an embedded app waiting on a prompt nobody showed.
 *
 * SessionStore is faked rather than booted: RuntimeStore reads exactly one thing from it
 * (`backendPorts`), so driving that directly is both the smaller harness and the more direct test.
 */
import { render } from '@solidjs/testing-library';
import type { BackendPorts, ConsentRequest, RuntimeAdminPort } from '@we/backend-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let ports: Partial<BackendPorts> | null = null;

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({ backendPorts: () => ports }),
}));

// Never 'settings', so the on-demand load effect stays dormant and each test drives the store
// explicitly. The load-on-open behaviour is asserted separately below.
let activeShellView: string | null = null;
vi.mock('../src/frameworks/solid/stores/ShellStore', () => ({
  useShellStore: () => ({ activeShellView: () => activeShellView }),
}));

import {
  parsePeerInfos,
  type RuntimeStore,
  RuntimeStoreProvider,
  useRuntimeStore,
} from '../src/frameworks/solid/stores/RuntimeStore';

function mount(): RuntimeStore {
  let store!: RuntimeStore;
  function Capture() {
    store = useRuntimeStore();
    return null;
  }
  render(() => (
    <RuntimeStoreProvider>
      <Capture />
    </RuntimeStoreProvider>
  ));
  return store;
}

/** A runtime port that records what it was asked to do. */
function stubRuntime(overrides: Partial<RuntimeAdminPort> = {}) {
  const calls: string[] = [];
  let emit: ((r: ConsentRequest) => void) | null = null;
  const port: RuntimeAdminPort = {
    async trustedAgents() {
      calls.push('trustedAgents');
      return ['did:peer:one'];
    },
    async trustAgent(id) {
      calls.push(`trust:${id}`);
    },
    async untrustAgent(id) {
      calls.push(`untrust:${id}`);
    },
    async authorizedApps() {
      calls.push('authorizedApps');
      return [];
    },
    onConsentRequest(handler) {
      emit = handler;
      return () => {
        emit = null;
      };
    },
    async approve(request) {
      calls.push(`approve:${request.kind}`);
      return request.kind === 'capability' ? 'secret-code' : undefined;
    },
    async deny(request) {
      calls.push(`deny:${request.kind}`);
    },
    ...overrides,
  };
  return { port, calls, fire: (r: ConsentRequest) => emit?.(r) };
}

const capabilityRequest: ConsentRequest = {
  kind: 'capability',
  title: 'Flux wants access',
  message: 'Flux is requesting capabilities',
  app: { name: 'Flux', description: 'social', url: 'https://flux', capabilities: ['READ all AD4M data'] },
  payload: '{"auth":{}}',
};

const trustRequest: ConsentRequest = {
  kind: 'trust',
  title: 'Unknown peer',
  message: 'An unknown agent wants to be trusted',
  peerId: 'did:peer:stranger',
  payload: 'did:peer:stranger',
};

beforeEach(() => {
  ports = null;
  activeShellView = null;
});

describe('degrading when the backend administers nothing', () => {
  it('reports every capability false rather than throwing', () => {
    ports = {}; // a port bundle with no `runtime` — what the in-memory backend supplies
    const store = mount();

    expect(store.canAdminister()).toBe(false);
    expect(store.canManageTrust()).toBe(false);
    expect(store.canManageNetwork()).toBe(false);
    expect(store.canManageApps()).toBe(false);
  });

  it('actions no-op instead of throwing, so a mis-gated template cannot crash the page', async () => {
    ports = {};
    const store = mount();

    await store.loadTrustedAgents();
    await store.trustAgent('did:peer:one');
    await store.loadAuthorizedApps();

    expect(store.trustedAgents()).toEqual([]);
    expect(store.error()).toBe('');
  });

  it('detects capabilities member by member, not all-or-nothing', () => {
    // Trust only: no network, no apps.
    ports = { runtime: { trustedAgents: async () => [] } };
    const store = mount();

    expect(store.canAdminister()).toBe(true);
    expect(store.canManageTrust()).toBe(true);
    expect(store.canManageNetwork()).toBe(false);
    expect(store.canManageApps()).toBe(false);
  });
});

describe('trust settings', () => {
  it('reloads the list after every mutation, so the UI cannot drift from the backend', async () => {
    const { port, calls } = stubRuntime();
    ports = { runtime: port };
    const store = mount();

    await store.trustAgent('did:peer:two');

    expect(calls).toEqual(['trust:did:peer:two', 'trustedAgents']);
    expect(store.trustedAgents()).toEqual(['did:peer:one']);
  });

  it('ignores a blank id rather than sending it', async () => {
    const { port, calls } = stubRuntime();
    ports = { runtime: port };
    const store = mount();

    await store.trustAgent('   ');
    expect(calls).toEqual([]);
  });

  it('surfaces a failure as text instead of an unhandled rejection', async () => {
    const { port } = stubRuntime({
      trustedAgents: async () => {
        throw new Error('executor unreachable');
      },
    });
    ports = { runtime: port };
    const store = mount();

    await store.loadTrustedAgents();

    expect(store.error()).toBe('executor unreachable');
    expect(store.loading()).toBe(false);
  });
});

describe('the consent queue', () => {
  it('surfaces a request raised while the app is running', () => {
    const { port, fire } = stubRuntime();
    ports = { runtime: port };
    const store = mount();

    fire(capabilityRequest);

    expect(store.pendingConsent()?.kind).toBe('capability');
    expect(store.pendingConsent()?.app?.name).toBe('Flux');
  });

  it('holds a second request instead of dropping it', async () => {
    const { port, fire } = stubRuntime();
    ports = { runtime: port };
    const store = mount();

    fire(capabilityRequest);
    fire(trustRequest);
    expect(store.pendingConsent()?.kind).toBe('capability');

    await store.approveConsent();

    // The second request is still there — dropping it would leave that asker hanging, which is
    // the exact failure this store exists to prevent.
    expect(store.pendingConsent()?.kind).toBe('trust');
  });

  it('keeps the secret a capability approval returns, and clears it on the next approval', async () => {
    const { port, fire } = stubRuntime();
    ports = { runtime: port };
    const store = mount();

    fire(capabilityRequest);
    await store.approveConsent();
    expect(store.consentSecret()).toBe('secret-code');

    // A trust approval returns nothing; a stale code from the previous approval must not linger.
    fire(trustRequest);
    await store.approveConsent();
    expect(store.consentSecret()).toBe('');
  });

  it('denying clears the prompt', async () => {
    const { port, calls, fire } = stubRuntime();
    ports = { runtime: port };
    const store = mount();

    fire(trustRequest);
    await store.denyConsent();

    expect(calls).toContain('deny:trust');
    expect(store.pendingConsent()).toBeNull();
  });

  it('denying clears the prompt even when the backend cannot say no', async () => {
    // No `deny` member — the user still declined, and must not be trapped on the modal.
    const { port, fire } = stubRuntime({ deny: undefined });
    ports = { runtime: port };
    const store = mount();

    fire(trustRequest);
    await store.denyConsent();

    expect(store.pendingConsent()).toBeNull();
  });

  it('stops delivering once the subscription is torn down', () => {
    const { port, fire } = stubRuntime();
    ports = { runtime: port };

    let store!: RuntimeStore;
    function Capture() {
      store = useRuntimeStore();
      return null;
    }
    const { unmount } = render(() => (
      <RuntimeStoreProvider>
        <Capture />
      </RuntimeStoreProvider>
    ));

    unmount();
    fire(capabilityRequest);

    // The adapter's unsubscribe is a flag flip rather than a real teardown (AD4M's exception
    // callback has no removal API), so this is the assertion that keeps that honest.
    expect(store.pendingConsent()).toBeNull();
  });
});

describe('loading on demand', () => {
  it('loads nothing while the settings overlay is closed', async () => {
    const { port, calls } = stubRuntime();
    ports = { runtime: port };

    const store = mount();
    await vi.waitFor(() => expect(store.canManageTrust()).toBe(true));

    expect(calls).toEqual([]);
  });

  it('loads trust and apps when the settings overlay is open', async () => {
    activeShellView = 'settings';
    const { port, calls } = stubRuntime();
    ports = { runtime: port };

    const store = mount();

    await vi.waitFor(() => expect(store.trustedAgents()).toEqual(['did:peer:one']));
    expect([...calls].sort()).toEqual(['authorizedApps', 'trustedAgents']);
  });

  it('asks for nothing the backend cannot answer', async () => {
    activeShellView = 'settings';
    const calls: string[] = [];
    // Trust only — the apps load must not be attempted.
    ports = {
      runtime: {
        trustedAgents: async () => {
          calls.push('trustedAgents');
          return [];
        },
      },
    };

    mount();
    await vi.waitFor(() => expect(calls).toEqual(['trustedAgents']));
  });

  // Network metrics stay manual: a diagnostic blob nobody asked for is the same mistake as
  // loading everything at boot, one level down.
  it('never fetches network metrics on open', async () => {
    activeShellView = 'settings';
    const { port, calls } = stubRuntime({
      networkMetrics: async () => {
        calls.push('networkMetrics');
        return '{}';
      },
    });
    ports = { runtime: port };

    mount();
    await vi.waitFor(() => expect(calls).toContain('trustedAgents'));
    expect(calls).not.toContain('networkMetrics');
  });
});

describe('parsePeerInfos', () => {
  it('reads a JSON array', () => {
    expect(parsePeerInfos('["one","two"]')).toEqual(['one', 'two']);
  });

  it('reads one record per line', () => {
    expect(parsePeerInfos(' one \n\n two \n')).toEqual(['one', 'two']);
  });

  it('reads nothing from blank text', () => {
    expect(parsePeerInfos('   \n  ')).toEqual([]);
  });
});
