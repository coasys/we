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
import { createBlocks, registerCoreBlocks } from '@we/block-shared';
import { toastService } from '@we/components/solid';
import { AgentSettings, CollectionBlock, getEntity, Space } from '@we/entities';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────
// The platform provider supplies the in-memory backend; the template/theme/route stores (not
// under test) become minimal fakes. Nothing about the data layer is mocked.

let lifecycle: InMemoryLifecycle;
let agentOptions: InMemoryAgentOptions;
/** Set to make the connector reject, standing in for a backend that cannot be reached. */
let connectFailure: string | null = null;
/** Supplied by connectors whose session is the connection — the web host's, in practice. */
let disconnect: (() => Promise<void>) | undefined;

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
      return { client: {}, ports, ...(disconnect ? { disconnect } : {}) };
    },
  }),
}));

const navigate = vi.fn();
/**
 * The address, as a signal a test can move. `navigate` deliberately does not write it: the route
 * effect would then switch datasets on every navigation, and the tests asserting what was asked for
 * would be asserting what the route effect made of it.
 */
const route = vi.hoisted(() => ({ go: (_to: string) => {} }));
vi.mock('../src/frameworks/solid/stores/RouteStore', async () => {
  const { createSignal } = await import('solid-js');
  const [href, setHref] = createSignal('/');
  route.go = setHref;
  const url = () => new URL(href(), 'http://we.test');
  return {
    useRouteStore: () => ({
      navigate,
      segments: () => url().pathname.split('/').filter(Boolean),
      currentPath: () => url().pathname,
      params: () => Object.fromEntries(url().searchParams),
    }),
  };
});

// Stubbed rather than mounted: these two pull in the whole template and theme registries, and this
// file is about the boot and dataset flow. The cost is that they must carry every member SpaceStore
// reads — a missing one is a `not a function` at provider construction, which fails every test in
// the file at once rather than the one that cares.
vi.mock('../src/frameworks/solid/stores/TemplateStore', () => ({
  useTemplateStore: () => ({
    provideSpaceLookup: () => {},
    preloadSpaceTemplates: async () => {},
    allTemplates: () => [],
    currentTemplate: () => undefined,
    defaultTemplateId: () => 'default',
    replaceTemplate: () => {},
  }),
}));

vi.mock('../src/frameworks/solid/stores/ThemeStore', () => ({
  useThemeStore: () => ({
    allThemes: () => [],
    defaultThemeId: () => 'default',
    // Templates may suggest a theme; the boot suite has none, so the value only has to exist.
    useTemplateTheme: () => true,
    replaceTheme: () => {},
    restorePersonalTheme: () => {},
    clearSpaceTheme: () => {},
  }),
}));

// ── Harness ───────────────────────────────────────────────────────────────────
import { BootController } from '../src/frameworks/solid/providers/BootController';
import { AccountStoreProvider } from '../src/frameworks/solid/stores/AccountStore';
import { AppStoreProvider } from '../src/frameworks/solid/stores/AppStore';
import { type DatasetStore, DatasetStoreProvider, useDatasetStore } from '../src/frameworks/solid/stores/DatasetStore';
import { ProfileStoreProvider } from '../src/frameworks/solid/stores/ProfileStore';
import { type RecordStore, RecordStoreProvider, useRecordStore } from '../src/frameworks/solid/stores/RecordStore';
import { type SessionStore, SessionStoreProvider, useSessionStore } from '../src/frameworks/solid/stores/SessionStore';
import { ShapeStoreProvider } from '../src/frameworks/solid/stores/ShapeStore';
import { ShellStoreProvider } from '../src/frameworks/solid/stores/ShellStore';
import { type SpaceStore, SpaceStoreProvider, useSpaceStore } from '../src/frameworks/solid/stores/SpaceStore';
import { provideSeed } from '../src/shared/seedRegistry';

provideSeed({ name: 'test', modules: [] } as never);

interface Stores {
  session: SessionStore;
  datasets: DatasetStore;
  spaces: SpaceStore;
  records: RecordStore;
}

function mountShell(): Stores {
  const out = {} as Stores;
  function Capture() {
    out.session = useSessionStore();
    out.datasets = useDatasetStore();
    out.spaces = useSpaceStore();
    out.records = useRecordStore();
    return null;
  }
  render(() => (
    <ShellStoreProvider>
      {/* The mocked platform supplies no `accounts`, so this mounts in its web-degraded form —
          which is what the profile write-through has to tolerate. */}
      <AccountStoreProvider>
        <SessionStoreProvider>
          <DatasetStoreProvider>
            {/* SpaceStore reads the extraction candidates off ShapeStore and hands the wizard back
                an enroller, so the two mount in the order the real StoreProvider uses. */}
            <ShapeStoreProvider>
              {/* SpaceStore hands the record layer the vocabularies this community owns — a task's
                  own states — so the two mount in the order the real StoreProvider uses. */}
              <RecordStoreProvider>
                <ProfileStoreProvider>
                  {/* SpaceStore hands the installed-module set down to AppStore, so it must mount
                  inside one — the same nesting the real StoreProvider uses. */}
                  <AppStoreProvider>
                    <SpaceStoreProvider>
                      <BootController />
                      <Capture />
                    </SpaceStoreProvider>
                  </AppStoreProvider>
                </ProfileStoreProvider>
              </RecordStoreProvider>
            </ShapeStoreProvider>
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
  disconnect = undefined;
  navigate.mockClear();
  route.go('/');
});

// ── The suite ─────────────────────────────────────────────────────────────────

describe('boot', () => {
  it('boots to ready against the in-memory backend, creating the system datasets', async () => {
    const stores = mountShell();
    await ready(stores);

    // The boot sequence created the system datasets through the lifecycle port.
    const names = (await lifecycle.list()).map((d) => d.name).sort();
    expect(names).toEqual(['we-personal', 'we-root', 'we-test']);
    expect(stores.session.me()?.did).toBe('did:test:james');
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('walks the lock → login flow, including a failed password', async () => {
    agentOptions = { unlocked: false, password: 'secret' };
    const stores = mountShell();

    await vi.waitFor(() => expect(stores.session.bootState()).toBe('login'));

    // Rejects now: a schema chaining `onSuccess` off sign-in used to fire it on a failed one.
    await expect(stores.session.login('wrong')).rejects.toThrow();
    expect(stores.session.passwordError()).toBe(true);
    expect(stores.session.bootState()).toBe('login');

    await stores.session.login('secret');
    await ready(stores);
  });

  it('does not blame the password for a failure that happened after it was accepted', async () => {
    agentOptions = { unlocked: false, password: 'secret' };
    const stores = mountShell();
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('login'));

    // The unlock succeeds; the load behind it does not. Injected at the seam the boot controller
    // registers through, because every step inside that load catches its own errors — which is why
    // this bug is latent on the dataset path rather than reproducible through it.
    stores.session.onSessionUnlocked(async () => {
      throw new Error('dataset store unreachable');
    });

    await expect(stores.session.login('secret')).rejects.toThrow(/unreachable/);

    // The bug: one `try` covered both halves, so a data failure reported "Incorrect password" about
    // a password the executor had just accepted — sending the user to change something that was
    // never wrong.
    expect(stores.session.passwordError()).toBe(false);
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
    expect(names).toEqual(['we-personal', 'we-root', 'we-test']);
  }, 10000);

  it('does not strand the user on the create screen after the agent exists', async () => {
    const stores = mountShell();
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('createAgent'));

    stores.session.onSessionUnlocked(async () => {
      throw new Error('dataset store unreachable');
    });

    await expect(stores.session.createAgent('a-strong-passphrase')).rejects.toThrow(/unreachable/);

    /*
      The agent was created. Sharing one catch with the load meant this reported "Could not create
      your agent" and left the user on the create screen — where retrying calls `generate` again and
      the executor refuses, because an agent already exists. There was no way out.

      A boot failure instead: `error` has a screen and a retry, which is the shape this needs.
    */
    expect(stores.session.bootState()).toBe('error');
    expect(stores.session.bootError()).toMatch(/unreachable/);
    expect(stores.session.createAgentError()).toBe('');
  });

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

    await expect(stores.session.createAgent('another-passphrase')).rejects.toThrow(/already exists/);

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
      getSettings: async () => ({ mcpEnabled: false, mcpPort: 3001, logLevels: {} }),
      setSettings: async () => ({ mcpEnabled: false, mcpPort: 3001, logLevels: {} }),
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

  it('ends the connection when that is what the session is, rather than showing a lock that is not there', async () => {
    // A remote node reached over ad4m-connect: already unlocked, and never unlocked by a password
    // this app holds. Returning to the sign-in form asked for a password against a keystore that is
    // not there — refused every time, while reloading walked straight back in, because nothing
    // about the session had actually ended.
    agentOptions = { unlocked: true, password: 'not-ours' };
    let disconnects = 0;
    disconnect = async () => {
      disconnects += 1;
    };
    let restarts = 0;
    executorHost = {
      getSettings: async () => ({ mcpEnabled: false, mcpPort: 3001, logLevels: {} }),
      setSettings: async () => ({ mcpEnabled: false, mcpPort: 3001, logLevels: {} }),
      restart: async () => {
        restarts += 1;
      },
    };
    const stores = mountShell();
    await ready(stores);

    // Stubbed both to keep jsdom quiet and because the reload is the other half of the act: the
    // connect UI runs once per document, so a disconnected session that stayed on this one would
    // have nothing to reconnect with.
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location);

    await stores.session.logout();

    expect(disconnects).toBe(1);
    expect(reload).toHaveBeenCalled();
    // Preferred over restarting even where a host could: forgetting the connection is what ends
    // this session, and restarting someone else's node is not on offer.
    expect(restarts).toBe(0);
  }, 10000);

  it('locks rather than restarting when it does hold the password', async () => {
    agentOptions = { unlocked: false, password: 'secret' };
    let restarts = 0;
    executorHost = {
      getSettings: async () => ({ mcpEnabled: false, mcpPort: 3001, logLevels: {} }),
      setSettings: async () => ({ mcpEnabled: false, mcpPort: 3001, logLevels: {} }),
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

  /**
   * The bug this suite exists to keep fixed: a join the backend completes and the *call* does not.
   *
   * AD4M's client times every call out at 30s, and a first join — fetch the neighbourhood, install
   * its link language — routinely runs past that while still working. The 408 that came back said
   * nothing about whether the join had worked, and the store believed it: none of the work that
   * makes a joined space usable happened, and the join gate stayed up over a space the agent was
   * by then a member of. Only a page refresh found it.
   */
  it('finishes a join whose call timed out after the backend had already done it', async () => {
    const stores = mountShell();
    await ready(stores);

    lifecycle.seedShared({ id: 'slow-ds', name: 'Slow Space', sharedUri: 'inmemory://slow-ds' });

    // The shape of the real failure: the backend does the whole job, the caller is told nothing.
    const backendJoin = lifecycle.join.bind(lifecycle);
    vi.spyOn(lifecycle, 'join').mockImplementationOnce(async (uri: string) => {
      await backendJoin(uri);
      throw new Error("RPC error 408: RPC call 'neighbourhood.join' timed out after 30000ms");
    });

    await stores.spaces.joinSpace('inmemory://slow-ds');

    // Recovered rather than abandoned: switched to, and reported as no longer joining.
    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.name).toBe('Slow Space'));
    expect(stores.spaces.joiningSpace()).toBe('');
    expect(stores.spaces.joinError()).toBeNull();
  }, 20000);

  it('reports a backend that answered, rather than waiting out the recovery window', async () => {
    const stores = mountShell();
    await ready(stores);

    // Nothing published at that address — a verdict, not a timeout. Waiting changes nothing, so
    // this has to come back now; the test's own timeout is the assertion that it does.
    await expect(stores.spaces.joinSpace('inmemory://not-a-space')).rejects.toThrow(/nothing published/);

    expect(stores.spaces.joiningSpace()).toBe('');
    expect(stores.spaces.joinError()).toEqual({
      spaceId: 'not-a-space',
      message: expect.stringContaining('Check the link'),
    });
  }, 10000);

  it('collapses two joins of the same space into one', async () => {
    const stores = mountShell();
    await ready(stores);

    lifecycle.seedShared({ id: 'twice-ds', name: 'Twice Space', sharedUri: 'inmemory://twice-ds' });
    const joinSpy = vi.spyOn(lifecycle, 'join');

    // A double click, or a gate and a list asking at once. Two joins racing produce two datasets
    // for one address, and nothing afterwards can tell which one the space is in.
    await Promise.all([stores.spaces.joinSpace('inmemory://twice-ds'), stores.spaces.joinSpace('inmemory://twice-ds')]);

    expect(joinSpy).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.name).toBe('Twice Space'));
  }, 10000);

  it('takes the web share link as well as the URI and the bare id', async () => {
    const stores = mountShell();
    await ready(stores);

    lifecycle.seedShared({ id: 'linked-ds', name: 'Linked Space', sharedUri: 'inmemory://linked-ds' });
    await stores.spaces.joinSpace('https://we.example/space/linked-ds');

    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.name).toBe('Linked Space'));
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

describe('the personal space', () => {
  it('is made beside the root, and is never listed as a space', async () => {
    const stores = mountShell();
    await ready(stores);
    await vi.waitFor(() => expect(stores.datasets.personalDataset()).not.toBeNull());

    const personal = stores.datasets.personalDataset()!;
    const root = stores.datasets.rootDataset()!;
    expect(personal.name).toBe('we-personal');
    expect(personal.id).not.toBe(root.id);
    expect(stores.datasets.systemDatasetUuids()).toEqual(expect.arrayContaining([personal.id, root.id]));

    await stores.spaces.createSpace('Somewhere', 'x', 'personal', 'hidden');
    expect(stores.datasets.orderedDatasets().map((d) => d.name)).toEqual(['Somewhere']);
    expect(stores.spaces.mySpaces().map((s) => s.uuid)).not.toContain(personal.id);
  }, 10000);

  it('holds a composition, written the way a post is — which is what a note is', async () => {
    const stores = mountShell();
    await ready(stores);
    await vi.waitFor(() => expect(stores.datasets.personalDataset()).not.toBeNull());
    const personal = stores.datasets.personalDataset()!;
    // The composer registers these when it mounts; this suite mounts no renderer.
    registerCoreBlocks();

    const root = await createBlocks(personal.handle, [{ _type: 'block', text: 'only mine' }], { kind: 'post' });

    const notes = await CollectionBlock.findAll(personal.handle as never, { where: { kind: 'post' } });
    expect(notes.map((note) => note.id)).toEqual([root!.id]);
    expect(notes[0].textContent).toContain('only mine');
  }, 10000);

  it('does not take a reference into it anywhere, since there is no space there to go to', async () => {
    const stores = mountShell();
    await ready(stores);
    await vi.waitFor(() => expect(stores.datasets.personalDataset()).not.toBeNull());
    const personal = stores.datasets.personalDataset()!;
    navigate.mockClear();

    await stores.spaces.openRecordRef(`we:p:${personal.id}/CollectionBlock/some-note`);

    expect(navigate).not.toHaveBeenCalled();
  }, 10000);
});

describe('blocks on a canvas', () => {
  it('are creatable like any content, each saying how it is made, and named and drawn like any kind', async () => {
    const stores = mountShell();
    await ready(stores);

    const creatable = stores.records.creatableEntities();
    const find = (value: string) => creatable.find((entity) => entity.value === value);
    expect(find('ImageBlock')).toMatchObject({ label: 'Image', icon: 'image', via: 'form' });
    expect(find('TextBlock')).toMatchObject({ label: 'Text', icon: 'text-t', via: 'form' });
    expect(find('CollectionBlock')).toMatchObject({ via: 'composer' });
    // Not content, so not here — no flag needed to keep them out.
    expect(find('Relationship')).toBeUndefined();
    expect(find('RelationshipType')).toBeUndefined();

    // The key reads names and glyphs from `displays` — a quote dropped on a canvas included.
    const displays = stores.records.displays();
    expect(displays.ImageBlock).toMatchObject({ label: 'Image', icon: 'image' });
    expect(displays.TextBlock).toMatchObject({ label: 'Text', icon: 'text-t' });
    expect(displays.EmbedBlock?.label).toBe('Embed');
    expect(displays.Relationship).toBeDefined();
  }, 10000);
});

describe('a record form with something typed in it', () => {
  it('knows it has changed as soon as a field is typed into, not only when the draft is replaced', async () => {
    const stores = mountShell();
    await ready(stores);

    stores.records.openRecordForm('TaskBlock');
    expect(stores.records.recordDraftDirty()).toBe(false);

    // Written in place, so the input keeps its focus — which once left this false for good, and
    // closing or going Back threw the typing away without asking.
    stores.records.setRecordField('title', 'Book the room');
    expect(stores.records.recordDraftDirty()).toBe(true);

    stores.records.setRecordField('title', '');
    expect(stores.records.recordDraftDirty()).toBe(false);
  }, 10000);
});

describe('bringing a note into a space', () => {
  it('copies it in as a post, with nothing saying where it came from, and undoes', async () => {
    const stores = mountShell();
    await ready(stores);
    await vi.waitFor(() => expect(stores.datasets.personalDataset()).not.toBeNull());
    registerCoreBlocks();
    const personal = stores.datasets.personalDataset()!;
    const note = await createBlocks(personal.handle, [{ _type: 'block', text: 'ready to post' }], { kind: 'post' });

    await stores.spaces.createSpace('Gardeners', 'x', 'personal', 'hidden');
    const space = (await lifecycle.list()).find((d) => d.name === 'Gardeners')!;
    await stores.spaces.navigateToSpace(space.id);
    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(space.id));

    toastService.toasts().forEach((toast) => toastService.remove(toast.id));
    await stores.records.bringIn({
      items: [
        { ref: { entity: 'CollectionBlock', id: note!.id, dataset: `p:${personal.id}` }, label: 'ready to post' },
      ],
    });

    const posts = await CollectionBlock.findAll(space.handle as never, { where: { kind: 'post' } });
    expect(posts).toHaveLength(1);
    expect(posts[0].textContent).toContain('ready to post');
    // A note's personal space names nothing to anybody else, so the copy does not name it.
    expect(posts[0].sourceRef ?? '').toBe('');
    // The note itself is untouched.
    expect(await CollectionBlock.findAll(personal.handle as never, { where: { kind: 'post' } })).toHaveLength(1);

    const [toast] = toastService.toasts();
    expect(toast.action?.label).toBe('Undo');
    toast.action!.run();
    await vi.waitFor(async () =>
      expect(await CollectionBlock.findAll(space.handle as never, { where: { kind: 'post' } })).toHaveLength(0),
    );
  }, 10000);

  it('puts a single block on a canvas as itself, not inside a post', async () => {
    const stores = mountShell();
    await ready(stores);
    await vi.waitFor(() => expect(stores.datasets.personalDataset()).not.toBeNull());
    registerCoreBlocks();
    const personal = stores.datasets.personalDataset()!;
    const note = await createBlocks(
      personal.handle,
      [
        { _type: 'block', text: 'the heading' },
        { _type: 'block', text: 'just this paragraph' },
      ],
      { kind: 'post' },
    );
    const [, paragraph] = (await CollectionBlock.findOne(personal.handle as never, { where: { id: note!.id } }))!
      .children as string[];

    await stores.spaces.createSpace('Workshop', 'x', 'personal', 'hidden');
    const space = (await lifecycle.list()).find((d) => d.name === 'Workshop')!;
    await stores.spaces.navigateToSpace(space.id);
    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(space.id));
    const canvas = await createBlocks(space.handle, [], { kind: 'canvas' });

    await stores.records.dropOnCanvas(canvas!.id, {
      entity: 'TextBlock',
      id: paragraph,
      dataset: `p:${personal.id}`,
      within: { entity: 'CollectionBlock', id: note!.id },
      label: 'just this paragraph',
      x: 40,
      y: 60,
    });

    // No post was made to hold it.
    expect(await CollectionBlock.findAll(space.handle as never, { where: { kind: 'post' } })).toHaveLength(0);
    const texts = (await getEntity('TextBlock').findAll(space.handle as never, {})) as unknown as {
      id: string;
      text: string;
    }[];
    expect(texts.map((t) => t.text)).toEqual(['just this paragraph']);
    // It is on the canvas, where it landed.
    const placements = (await getEntity('Placement').findAll(space.handle as never, {})) as unknown as {
      nodeId?: string;
      x?: number;
    }[];
    expect(placements.some((p) => p.x === 40)).toBe(true);
  }, 10000);

  it('leaves alone a post already in the space', async () => {
    const stores = mountShell();
    await ready(stores);
    registerCoreBlocks();
    await stores.spaces.createSpace('Here', 'x', 'personal', 'hidden');
    const space = (await lifecycle.list()).find((d) => d.name === 'Here')!;
    await stores.spaces.navigateToSpace(space.id);
    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(space.id));
    const post = await createBlocks(space.handle, [{ _type: 'block', text: 'already here' }], { kind: 'post' });

    await stores.records.bringIn({ items: [{ ref: { entity: 'CollectionBlock', id: post!.id } }] });

    expect(await CollectionBlock.findAll(space.handle as never, { where: { kind: 'post' } })).toHaveLength(1);
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

describe('moving between spaces', () => {
  /*
    The workshop names its call in `?call=` on a screen below the space's root, and the space's root
    redirects there without the query — so arriving back at the root lost the call. Walking away and
    back must land where you were.
  */
  it('returns to the screen and query you left a space at', async () => {
    const stores = mountShell();
    await ready(stores);

    await stores.spaces.createSpace('Space A', 'x', 'personal', 'hidden');
    await stores.spaces.createSpace('Space B', 'x', 'personal', 'hidden');
    const refs = await lifecycle.list();
    const a = refs.find((d) => d.name === 'Space A')!.id;
    const b = refs.find((d) => d.name === 'Space B')!.id;

    await stores.spaces.navigateToSpace(a);
    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(a));
    route.go(`/space/${a}/canvas?call=c1`);

    await stores.spaces.navigateToSpace(b);
    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(b));
    route.go(`/space/${b}/canvas`);

    navigate.mockClear();
    await stores.spaces.navigateToSpace(a);
    expect(navigate).toHaveBeenCalledWith(`/space/${a}/canvas?call=c1`);

    // The space already on screen still goes to its root on a click.
    route.go(`/space/${a}/canvas?call=c1`);
    navigate.mockClear();
    await stores.spaces.navigateToSpace(a);
    expect(navigate).toHaveBeenCalledWith(`/space/${a}`);
  }, 10000);
});

describe('changing a reaction', () => {
  it('replaces the record rather than editing it, because an edit notifies nobody', async () => {
    /*
      A rating moved from three stars to four did nothing anybody could see, the author included.

      The write landed. What did not happen was the re-read. Every surface fetches reactions as
      `include: { signals: true }` on the record, so the live query is over the RECORD's class, and
      the executor builds that subscription's trigger from `build_model_trigger_predicates` — the
      predicates of the subscribed class's own shape, plus the parent predicate. It does not walk
      `include`. `we://signal` is in that set, so adding or removing a reaction fires it; `we://value`,
      which belongs to the Signal, is not. An in-place edit changes the store and wakes no reader.

      So the shape IS the requirement: a change has to touch `we://signal`, which means removing and
      adding. The test asserts the record's identity changed, because that is the observable
      difference between the two implementations — and the obvious tidy-up, one write instead of
      two, is exactly what broke it.

      The rest of the assertion is what a naive delete-then-create could still get wrong: one
      reaction of this type by this agent, holding the new value, not two.
    */
    const stores = mountShell();
    await ready(stores);

    await stores.spaces.createSpace('Raters', 'x', 'personal', 'hidden');
    const space = (await lifecycle.list()).find((d) => d.name === 'Raters')!;
    await stores.spaces.navigateToSpace(space.id);
    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(space.id));

    const handle = space.handle as never;
    const SignalType = getEntity('SignalType')!;
    const Signal = getEntity('Signal')!;
    const stars = await (SignalType as never as typeof Space).create(handle, {
      name: 'Stars',
      slug: 'stars',
      mode: 'rating',
      rangeMin: 0,
      rangeMax: 5,
    } as never);
    const subject = await CollectionBlock.create(handle, { kind: 'post', textContent: 'rate me' } as never);

    const mine = async () =>
      (await (Signal as never as typeof Space).findAll(handle, {
        parent: { id: subject.id, predicate: 'we://signal' },
        where: { signalTypeId: stars.id, author: 'did:test:james' },
      } as never)) as unknown as { id: string; value: number }[];

    await stores.spaces.upsertSignal(subject.id, stars.id, 3);
    const first = await mine();
    expect(first).toHaveLength(1);
    expect(first[0].value).toBe(3);

    await stores.spaces.upsertSignal(subject.id, stars.id, 4);
    const second = await mine();
    // One reaction, the new value — not two rows where the reader finds the stale one first.
    expect(second).toHaveLength(1);
    expect(second[0].value).toBe(4);
    // And a different record, which is what touching `we://signal` twice amounts to.
    expect(second[0].id).not.toBe(first[0].id);

    /*
      A zero is an ordinary value now, and is stored.

      It used to be the withdrawal, which meant a type whose range includes 0 could not hold it — a
      0–100 slider dragged to the bottom was written as "did not answer". The two acts are spelled
      apart: a number is a reaction, `null` takes it back.
    */
    await stores.spaces.upsertSignal(subject.id, stars.id, 0);
    const zeroed = await mine();
    expect(zeroed).toHaveLength(1);
    expect(zeroed[0].value).toBe(0);

    // And withdrawing is its own act, which removes the record rather than storing anything.
    await stores.spaces.withdrawSignal(subject.id, stars.id);
    expect(await mine()).toHaveLength(0);
  }, 10000);
});

describe('a card’s presentation, drawn before it is stored', () => {
  it('holds each field on its own, so one settling does not retire the other', async () => {
    /*
      The improvement consolidating on `@we/optimism` bought the canvas.

      A colour and a size are written by different gestures and answered by different pushes. Held
      together as one patch per record, the first to come back retired the other — so recolouring a
      card you had just resized snapped it back to its old size for the rest of that round trip.
      Keyed per field, each answers for itself.

      `previewCardStyle` is used because it is synchronous and holds exactly as a write does; what is
      under test is the holding and the settling, not the round trip.
    */
    const stores = mountShell();
    await ready(stores);

    stores.records.previewCardStyle('card-1', 'color', 'danger-100');
    stores.records.previewCardStyle('card-1', 'rotation', 15);
    expect(stores.records.pendingCardStyle()['card-1']).toEqual({ color: 'danger-100', rotation: 15 });

    // The graph reports the records whose own data now says what was written. Only the colour has
    // landed, but the report is per record — so the rotation must survive it on its own terms.
    stores.records.confirmPending(['card-1']);
    expect(stores.records.pendingCardStyle()['card-1']).toBeUndefined();

    // And a second card's holds are untouched by a report about the first.
    stores.records.previewCardStyle('card-2', 'color', 'warning-100');
    stores.records.confirmPending(['card-1']);
    expect(stores.records.pendingCardStyle()['card-2']).toEqual({ color: 'warning-100' });
  }, 10000);

  it('a preview is not a write, so it settles rather than standing until the backstop', async () => {
    // A slider emits continuously as it is dragged. Counted as writes those holds would never be
    // judged — nothing returns to decrement them — and the card would show its last dragged frame
    // for ten seconds after the real value had landed.
    const stores = mountShell();
    await ready(stores);

    for (const degrees of [5, 10, 15, 20]) stores.records.previewCardStyle('card-3', 'rotation', degrees);
    expect(stores.records.pendingCardStyle()['card-3']).toEqual({ rotation: 20 });

    stores.records.confirmPending(['card-3']);
    expect(stores.records.pendingCardStyle()['card-3']).toBeUndefined();
  }, 10000);
});
