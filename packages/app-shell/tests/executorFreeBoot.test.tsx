/**
 * The executor-free boot suite: the REAL session/dataset/profile/space stores, the real
 * BootController, and real entities — no AD4M executor anywhere.
 *
 * Boot (already-unlocked and lock→login flows), system-dataset creation, dataset switching, and
 * space create/publish/join/remove all run as vitest tests. Entities used to be stubbed here,
 * which meant every assertion about stored data was really an assertion about the stub: a space
 * "created" by a `vi.fn()` returning `{...data, id}` proves the store called something, not that
 * anything was written. They are now compiled from the core manifest and backed by rows, so the
 * suite can read data back the way the app does — and a store that writes the wrong field, or
 * writes nothing at all, fails here rather than in a browser.
 */
import { render } from '@solidjs/testing-library';
import { createInMemoryBackendPorts, type InMemoryAgentOptions, type InMemoryLifecycle } from '@we/backend-inmemory';
import { AgentSettings, Space } from '@we/models';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────
// The platform provider supplies the in-memory backend; the template/theme/route stores (not
// under test) become minimal fakes. Nothing about the data layer is mocked.

let lifecycle: InMemoryLifecycle;
let agentOptions: InMemoryAgentOptions;
/** Set to make the connector reject, standing in for a backend that cannot be reached. */
let connectFailure: string | null = null;

/** Set by the tests that need a host able to restart the backend; absent is the web shape. */
let executorHost:
  | { getSettings: () => Promise<unknown>; setSettings: () => Promise<unknown>; restart: () => Promise<void> }
  | undefined;

vi.mock('../src/frameworks/solid/providers/PlatformProvider', () => ({
  usePlatform: () => ({ isDesktop: false, isDevelopment: true, executor: executorHost }),
  useBackend: () => ({
    // The real in-memory bundle — the same thing a backend-less host would supply.
    initialize: async (ctx: { selfId(): string | undefined }) => {
      if (connectFailure) throw new Error(connectFailure);
      const ports = createInMemoryBackendPorts(ctx, { agent: agentOptions });
      lifecycle = ports.lifecycle;
      return { client: {}, ports };
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

// ── Harness ───────────────────────────────────────────────────────────────────
import { BootController } from '../src/frameworks/solid/providers/BootController';
import { AccountStoreProvider } from '../src/frameworks/solid/stores/AccountStore';
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
      {/* The mocked platform supplies no `accounts`, so this mounts in its web-degraded form —
          which is what the profile write-through has to tolerate. */}
      <AccountStoreProvider>
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
      </AccountStoreProvider>
    </ShellStoreProvider>
  ));
  return out;
}

const ready = (stores: Stores) => vi.waitFor(() => expect(stores.session.bootState()).toBe('ready'), { timeout: 5000 });

beforeEach(() => {
  agentOptions = { id: 'did:test:james', unlocked: true };
  executorHost = undefined;
  connectFailure = null;
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

describe('first run', () => {
  // The flow that is otherwise only testable by deleting your agent and restarting the app.

  beforeEach(() => {
    agentOptions = { id: 'did:test:newcomer', hasAgent: false };
  });

  it('creates an agent, loads the session, and lands on finishing rather than ready', async () => {
    const stores = mountShell();
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('createAgent'));

    await stores.session.createAgent('a-strong-passphrase');

    // 'finishing', not ready: the boot screen holds while the profile is published.
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('finishing'));
    // ...but the session is fully loaded behind it — same post-unlock load as login.
    expect(stores.session.me()?.did).toBe('did:test:newcomer');
    const names = (await lifecycle.list()).map((d) => d.name).sort();
    expect(names).toEqual(['we-root', 'we-test']);
  }, 10000);

  it('finishing setup reaches ready, and the app is usable from there', async () => {
    const stores = mountShell();
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('createAgent'));

    await stores.session.createAgent('a-strong-passphrase');
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('finishing'));

    stores.session.finishSetup();
    expect(stores.session.bootState()).toBe('ready');

    // A space created by a newly onboarded agent is written like any other.
    await stores.spaces.createSpace('First Space', 'x', 'personal', 'hidden');
    expect(stores.spaces.mySpaces().map((s) => s.name)).toEqual(['First Space']);
  }, 10000);

  it('reports a failed creation and stays put, so the screen can be retried', async () => {
    // An agent already exists — the backend refuses, as the executor does.
    agentOptions = { hasAgent: true, unlocked: false, password: 'existing' };
    const stores = mountShell();
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('login'));

    await stores.session.createAgent('another-passphrase');

    expect(stores.session.createAgentError()).toBe('an agent already exists');
    expect(stores.session.createAgentLoading()).toBe(false);
    expect(stores.session.bootState()).toBe('login');
  });

  it('the passphrase chosen at creation is the one that unlocks later', async () => {
    const stores = mountShell();
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('createAgent'));

    await stores.session.createAgent('chosen-at-creation');
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('finishing'));
    stores.session.finishSetup();

    // logout() locks with the password createAgent captured — a wrong one would throw and
    // leave the agent unlocked, so reaching 'login' proves the capture.
    await stores.session.logout();
    expect(stores.session.bootState()).toBe('login');

    await stores.session.login('chosen-at-creation');
    await ready(stores);
  }, 10000);

  /**
   * Logging out of a session this renderer did not unlock.
   *
   * Reloading the page during a session leaves the backend unlocked and takes the password with it
   * — which is exactly the boot this suite's default `unlocked: true` describes. `lock` needs a
   * password, and AD4M's re-encrypts the wallet's in-memory keys under whatever it is given, so
   * sending a wrong one silently re-keys the running agent and the real password stops working
   * until the executor restarts.
   */
  it('does not lock with a password it does not have, and restarts the backend instead', async () => {
    // Already unlocked and never unlocked by this renderer — a reload mid-session.
    agentOptions = { unlocked: true, password: 'the-real-one' };
    let restarts = 0;
    executorHost = {
      getSettings: async () => ({ mcpEnabled: false, mcpPort: 3001 }),
      setSettings: async () => ({ mcpEnabled: false, mcpPort: 3001 }),
      restart: async () => {
        restarts += 1;
      },
    };
    const stores = mountShell();
    await ready(stores);

    // The in-memory agent refuses a wrong password on lock, so an attempt would land here. The
    // real one accepts anything and re-keys itself with it, which is the bug being avoided.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await stores.session.logout();
    const lockFailures = logged.mock.calls.filter((args) => String(args[0]).includes('agent lock failed'));
    logged.mockRestore();

    expect(lockFailures).toEqual([]);
    expect(restarts).toBe(1);
    expect(stores.session.bootState()).toBe('login');
  }, 10000);

  it('locks rather than restarting when it does hold the password', async () => {
    agentOptions = { unlocked: false, password: 'secret' };
    let restarts = 0;
    executorHost = {
      getSettings: async () => ({ mcpEnabled: false, mcpPort: 3001 }),
      setSettings: async () => ({ mcpEnabled: false, mcpPort: 3001 }),
      restart: async () => {
        restarts += 1;
      },
    };
    const stores = mountShell();
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('login'));

    await stores.session.login('secret');
    await ready(stores);
    await stores.session.logout();

    // The fast path: a restart here would cost seconds and reload the window for nothing.
    expect(restarts).toBe(0);
    expect(stores.session.bootState()).toBe('login');
    // And the password still works, which is the whole point.
    await stores.session.login('secret');
    await ready(stores);
  }, 10000);
});

describe('a boot that cannot reach the backend', () => {
  it('keeps why it failed, so the screen has something to say', async () => {
    // 'error' is the one boot state with no form and no spinner behind it. Without the message the
    // boot screen renders its background and nothing else, with no way forward but closing the app
    // — which is what a web session whose connection failed used to get.
    connectFailure = 'Could not connect to the executor';
    const stores = mountShell();

    await vi.waitFor(() => expect(stores.session.bootState()).toBe('error'));
    expect(stores.session.bootError()).toBe('Could not connect to the executor');
  });

  it('reports nothing wrong on a boot that works', async () => {
    const stores = mountShell();
    await ready(stores);

    expect(stores.session.bootError()).toBe('');
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
    // The Space model stores the adapter-minted scheme-less shared id.
    expect(stores.spaces.mySpaces()[0].url).toBe(created.sharedId);
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
    await vi.waitFor(() => expect(stores.datasets.datasets().some((d) => d.id === target.id)).toBe(false));
    expect(stores.spaces.mySpaces()).toEqual([]);
  }, 10000);
});

describe('what the stores actually wrote', () => {
  // These assertions were impossible while entities were stubbed: a stubbed `create` returns
  // whatever it was handed, so it agrees with any store, including one that stored the wrong
  // thing. Reading it back through the same import the app uses is the whole point.

  it('writes a space into its own dataset, with the fields the caller gave', async () => {
    const stores = mountShell();
    await ready(stores);

    await stores.spaces.createSpace('Readable', 'written by the store', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Readable')!;

    const spaces = await Space.findAll(ref.handle as never);
    expect(spaces).toHaveLength(1);
    expect(spaces[0].name).toBe('Readable');
    expect(spaces[0].description).toBe('written by the store');
    expect(spaces[0].author).toBe('did:test:james');
  }, 10000);

  it('persists sidebar order as settings, not just as store state', async () => {
    const stores = mountShell();
    await ready(stores);

    await stores.spaces.createSpace('Ordered', 'x', 'personal', 'hidden');
    const created = (await lifecycle.list()).find((d) => d.name === 'Ordered')!;
    const root = (await lifecycle.list()).find((d) => d.name === 'we-root')!;

    // The store reports an order; this checks it survived as data an agent carries between
    // sessions, in the dataset that holds settings.
    const settings = await AgentSettings.findOne(root.handle as never);
    expect(settings?.datasetOrder).toContain(created.id);
    expect(stores.datasets.getDatasetOrder()).toContain(created.id);
  }, 10000);

  it('records a shared space by its global id, and a personal one without', async () => {
    const stores = mountShell();
    await ready(stores);

    await stores.spaces.createSpace('Public', 'x', 'shared', 'listed');
    await stores.spaces.createSpace('Private', 'x', 'personal', 'hidden');

    const shared = (await lifecycle.list()).find((d) => d.name === 'Public')!;
    const personal = (await lifecycle.list()).find((d) => d.name === 'Private')!;

    const [publicSpace] = await Space.findAll(shared.handle as never);
    const [privateSpace] = await Space.findAll(personal.handle as never);

    // `url` carries the shared id — the fact `Space.access` used to duplicate.
    expect(publicSpace.url).toBe(shared.sharedId);
    expect(privateSpace.url).toBeFalsy();
    expect(publicSpace.discovery).toBe('listed');
  }, 10000);
});

describe('sidebar ordering', () => {
  it('reorders, and the new order survives as persisted settings', async () => {
    const stores = mountShell();
    await ready(stores);

    await stores.spaces.createSpace('First', 'x', 'personal', 'hidden');
    await stores.spaces.createSpace('Second', 'x', 'personal', 'hidden');

    const before = stores.datasets.orderedDatasets().map((d) => d.id);
    expect(before).toHaveLength(2);

    await stores.datasets.reorderDatasets([before[1], before[0]]);

    // The derived list the sidebar renders must follow the new order...
    expect(stores.datasets.orderedDatasets().map((d) => d.id)).toEqual([before[1], before[0]]);

    // ...and it must have been written, or the order is lost on the next boot.
    const root = (await lifecycle.list()).find((d) => d.name === 'we-root')!;
    const settings = await AgentSettings.findOne(root.handle as never);
    expect(JSON.parse(settings!.datasetOrder as string)).toEqual([before[1], before[0]]);
  }, 10000);
});
