/**
 * The executor-free boot suite: the REAL session/dataset/profile/space stores and the real
 * BootController, mounted against the in-memory backend ports — no AD4M executor anywhere.
 *
 * This is what the backend contract exists to make possible: boot (already-unlocked and
 * lock→login flows), system-dataset creation, dataset switching, and space create/publish/join/
 * remove all run as vitest tests. The only stub left is the model layer (Ad4mModel statics are
 * executor RPC by construction — neutralizing them is the entity-engine phase); every port runs
 * the real in-memory implementation, supplied through the connector exactly as a host would.
 */
import { render } from '@solidjs/testing-library';
import { createInMemoryBackendPorts, type InMemoryAgentOptions, type InMemoryLifecycle } from '@we/backend-inmemory';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────
// The platform provider supplies the in-memory backend; the model layer and the AD4M-only
// helpers are stubbed; the template/theme/route stores (not under test) become minimal fakes.

let lifecycle: InMemoryLifecycle;
let agentOptions: InMemoryAgentOptions;

vi.mock('../src/frameworks/solid/providers/PlatformProvider', () => ({
  usePlatform: () => ({ isDesktop: false, isDevelopment: true }),
  useBackend: () => ({
    connect: async () => ({}),
    // The real in-memory bundle — the same thing a backend-less host would supply.
    ports: (_client: unknown, ctx: { selfId(): string | undefined }) => {
      const ports = createInMemoryBackendPorts(ctx, { agent: agentOptions });
      lifecycle = ports.lifecycle;
      return ports;
    },
  }),
}));

const navigate = vi.fn();
vi.mock('../src/frameworks/solid/stores/RouteStore', () => ({
  useRouteStore: () => ({ navigate, segments: () => [], currentPath: () => '/' }),
}));

vi.mock('../src/frameworks/solid/stores/TemplateStore', () => ({
  useTemplateStore: () => ({
    provideSpaceLookup: () => {},
    preloadSpaceTemplates: async () => {},
    allTemplates: () => [],
    replaceTemplate: () => {},
  }),
}));

vi.mock('../src/frameworks/solid/stores/ThemeStore', () => ({
  useThemeStore: () => ({
    replaceTheme: () => {},
    restorePersonalTheme: () => {},
    clearSpaceTheme: () => {},
  }),
}));

// Fake Space/AgentSettings statics — the model layer is executor RPC; see the header comment.
const fakeSettings = { perspectiveOrder: '', claudeApiKey: '', save: vi.fn(async () => {}) };
let spaceCounter = 0;

vi.mock('@we/models', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    AgentSettings: {
      findOne: vi.fn(async () => fakeSettings),
      create: vi.fn(async () => fakeSettings),
    },
    Space: {
      findOne: vi.fn(async () => null),
      findAll: vi.fn(async () => []),
      create: vi.fn(async (_p: unknown, data: Record<string, unknown>) => ({ ...data, id: `space-${++spaceCounter}` })),
      update: vi.fn(async () => ({})),
      query: () => ({ subscribe: async (cb: (r: unknown[]) => void) => (cb([]), []), dispose: () => {} }),
    },
    LocationBlock: { create: vi.fn(async () => ({})), findAll: vi.fn(async () => []) },
  };
});

// ── Harness ───────────────────────────────────────────────────────────────────
import { BootController } from '../src/frameworks/solid/providers/BootController';
import { type DatasetStore, DatasetStoreProvider, useDatasetStore } from '../src/frameworks/solid/stores/DatasetStore';
import { ProfileStoreProvider } from '../src/frameworks/solid/stores/ProfileStore';
import { type SessionStore, SessionStoreProvider, useSessionStore } from '../src/frameworks/solid/stores/SessionStore';
import { ShellStoreProvider } from '../src/frameworks/solid/stores/ShellStore';
import { type SpaceStore, SpaceStoreProvider, useSpaceStore } from '../src/frameworks/solid/stores/SpaceStore';
import { provideSeed } from '../src/shared/seedRegistry';

provideSeed({ name: 'test', modules: [] } as never);

interface Stores {
  session: SessionStore;
  datasets: DatasetStore;
  spaces: SpaceStore;
}

function mountShell(): Stores {
  const out = {} as Stores;
  function Capture() {
    out.session = useSessionStore();
    out.datasets = useDatasetStore();
    out.spaces = useSpaceStore();
    return null;
  }
  render(() => (
    <ShellStoreProvider>
      <SessionStoreProvider>
        <DatasetStoreProvider>
          <ProfileStoreProvider>
            <SpaceStoreProvider>
              <BootController />
              <Capture />
            </SpaceStoreProvider>
          </ProfileStoreProvider>
        </DatasetStoreProvider>
      </SessionStoreProvider>
    </ShellStoreProvider>
  ));
  return out;
}

const ready = (stores: Stores) => vi.waitFor(() => expect(stores.session.bootState()).toBe('ready'), { timeout: 5000 });

beforeEach(() => {
  agentOptions = { id: 'did:test:james', unlocked: true };
  navigate.mockClear();
});

// ── The suite ─────────────────────────────────────────────────────────────────

describe('boot', () => {
  it('boots to ready against the in-memory backend, creating the system datasets', async () => {
    const stores = mountShell();
    await ready(stores);

    // The boot sequence created we-root and we-test through the lifecycle port.
    const names = (await lifecycle.list()).map((d) => d.name).sort();
    expect(names).toEqual(['we-root', 'we-test']);
    expect(stores.session.me()?.did).toBe('did:test:james');
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('walks the lock → login flow, including a failed password', async () => {
    agentOptions = { unlocked: false, password: 'secret' };
    const stores = mountShell();

    await vi.waitFor(() => expect(stores.session.bootState()).toBe('login'));

    await stores.session.login('wrong');
    expect(stores.session.passwordError()).toBe(true);
    expect(stores.session.bootState()).toBe('login');

    await stores.session.login('secret');
    await ready(stores);
  });

  it('routes to agent creation when no agent exists', async () => {
    agentOptions = { hasAgent: false };
    const stores = mountShell();
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('createAgent'));
  });
});

describe('dataset lifecycle through the real stores', () => {
  it('creates a personal space: new dataset, sidebar order, mySpaces entry', async () => {
    const stores = mountShell();
    await ready(stores);

    await stores.spaces.createSpace('My Space', 'a test space', 'personal', 'hidden');

    const refs = await lifecycle.list();
    expect(refs.map((d) => d.name)).toContain('My Space');
    expect(stores.spaces.mySpaces().map((s) => s.name)).toEqual(['My Space']);
    const created = refs.find((d) => d.name === 'My Space')!;
    expect(stores.datasets.getDatasetOrder()).toContain(created.id);
  }, 10000);

  it('creates a shared space through publish', async () => {
    const stores = mountShell();
    await ready(stores);

    await stores.spaces.createSpace('Shared Space', 'shared', 'shared', 'hidden');

    const created = (await lifecycle.list()).find((d) => d.name === 'Shared Space')!;
    expect(created.sharedUri).toMatch(/^inmemory:\/\//);
    // The Space model stored the CID form (scheme stripped).
    expect(stores.spaces.mySpaces()[0].url).toBe(created.sharedUri!.replace('neighbourhood://', ''));
  }, 10000);

  it("joins a peer's published dataset and switches to it", async () => {
    const stores = mountShell();
    await ready(stores);

    lifecycle.seedShared({ id: 'peer-ds', name: 'Peer Space', sharedUri: 'inmemory://peer-ds' });
    await stores.spaces.joinSpace('inmemory://peer-ds');

    expect((await lifecycle.list()).some((d) => d.id === 'peer-ds')).toBe(true);
    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.name).toBe('Peer Space'));
  }, 10000);

  it('removing a space prunes the dataset list and mySpaces (via the removal callback)', async () => {
    const stores = mountShell();
    await ready(stores);

    await stores.spaces.createSpace('Doomed', 'x', 'personal', 'hidden');
    const doomed = (await lifecycle.list()).find((d) => d.name === 'Doomed')!;

    await stores.spaces.removeSpace(doomed.id);
    expect((await lifecycle.list()).some((d) => d.id === doomed.id)).toBe(false);
    expect(stores.spaces.mySpaces()).toEqual([]);
  }, 10000);

  it('reflects a removal initiated by another client', async () => {
    const stores = mountShell();
    await ready(stores);

    await stores.spaces.createSpace('Remote-Doomed', 'x', 'personal', 'hidden');
    const target = (await lifecycle.list()).find((d) => d.name === 'Remote-Doomed')!;

    lifecycle.removeRemotely(target.id);
    await vi.waitFor(() => expect(stores.datasets.datasets().some((d) => d.uuid === target.id)).toBe(false));
    expect(stores.spaces.mySpaces()).toEqual([]);
  }, 10000);
});
