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
import { AgentSettings, CollectionBlock, getEntity, Policy, Space, SpaceLandmark } from '@we/entities';
import { type FeedFind, readFeedWindow } from '@we/module-feed';
import { createEffect, createRoot, createSignal } from 'solid-js';
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

/** Set by a test to wrap the backend's ports before the shell boots against them. */
let onPorts: ((ports: ReturnType<typeof createInMemoryBackendPorts>) => void) | undefined;
/** Datasets that exist before boot — a space the agent already has, say. */
let seededDatasets: { id: string; name: string }[] = [];

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
      const ports = createInMemoryBackendPorts(ctx, { agent: agentOptions, datasets: seededDatasets });
      onPorts?.(ports);
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
/** The app in use, as the stub hands it out: WE's own unless a test puts the agent in another. */
type AppInUse = { id: string; source?: { bundle: string } };
const app = vi.hoisted(() => ({ use: (_app: AppInUse) => {} }));

vi.mock('../src/frameworks/solid/stores/TemplateStore', async () => {
  const { createSignal } = await import('solid-js');
  const [inUse, setInUse] = createSignal<AppInUse>({ id: 'we-app' });
  app.use = setInUse;
  return {
    useTemplateStore: () => ({
      appTemplate: inUse,
      provideSpaceLookup: () => {},
      preloadSpaceTemplates: async () => {},
      allTemplates: () => [],
      currentTemplate: () => undefined,
      defaultTemplateId: () => 'default',
      replaceTemplate: () => {},
    }),
  };
});

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
import { completeResponse } from '@we/entities';
import { withExtractionDefaults } from '@we/entities';

import { BootController } from '../src/frameworks/solid/providers/BootController';
import { AccountStoreProvider } from '../src/frameworks/solid/stores/AccountStore';
import { AppStoreProvider } from '../src/frameworks/solid/stores/AppStore';
import { type DatasetStore, DatasetStoreProvider, useDatasetStore } from '../src/frameworks/solid/stores/DatasetStore';
import { ProfileStoreProvider } from '../src/frameworks/solid/stores/ProfileStore';
import { type RecordStore, RecordStoreProvider, useRecordStore } from '../src/frameworks/solid/stores/RecordStore';
import { type SessionStore, SessionStoreProvider, useSessionStore } from '../src/frameworks/solid/stores/SessionStore';
import { type ShapeStore, ShapeStoreProvider, useShapeStore } from '../src/frameworks/solid/stores/ShapeStore';
import { ShellStoreProvider } from '../src/frameworks/solid/stores/ShellStore';
import { type SpaceStore, SpaceStoreProvider, useSpaceStore } from '../src/frameworks/solid/stores/SpaceStore';
import { NO_STARTER } from '../src/shared/bundles/bundleStarter';
import { createModuleStoreDeps } from '../src/shared/registries/moduleHostServices';
import { provideSeed } from '../src/shared/seedRegistry';
import { writeSpaceLandmark } from '../src/shared/spaceLandmarks';

provideSeed({ name: 'test', modules: [] } as never);

interface Stores {
  session: SessionStore;
  datasets: DatasetStore;
  spaces: SpaceStore;
  records: RecordStore;
  shapes: ShapeStore;
}

function mountShell(): Stores {
  const out = {} as Stores;
  function Capture() {
    out.session = useSessionStore();
    out.datasets = useDatasetStore();
    out.spaces = useSpaceStore();
    out.records = useRecordStore();
    out.shapes = useShapeStore();
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
  onPorts = undefined;
  seededDatasets = [];
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

  /*
    A dataset listing can cost a backend a handle per dataset, and some keep resources behind each
    one nothing releases — so boot reads the list once, and publishes what it read plus
    what it made. Answering from the first read must still include a system dataset created after it.
  */
  it('reads the dataset list once, and publishes the system datasets it created', async () => {
    let listed = 0;
    onPorts = (ports) => {
      const list = ports.lifecycle.list.bind(ports.lifecycle);
      ports.lifecycle.list = async () => {
        listed++;
        return list();
      };
    };
    const stores = mountShell();
    await ready(stores);

    expect(listed).toBe(1);
    expect(
      stores.datasets
        .datasets()
        .map((d) => d.name)
        .sort(),
    ).toEqual(['we-personal', 'we-root', 'we-test']);
  });

  /*
    The root and the personal space share nothing but the list, and each is several round trips to
    a remote backend. One after the other they were most of the wait before a space could open.
  */
  it('brings the root and the personal space up side by side', async () => {
    let releaseRoot!: () => void;
    const rootHeld = new Promise<void>((resolve) => (releaseRoot = resolve));
    const started: string[] = [];
    onPorts = (ports) => {
      const { installRoot, installSpace } = ports.schemas;
      ports.schemas.installRoot = async (dataset) => {
        started.push('root');
        await rootHeld;
        return installRoot(dataset);
      };
      ports.schemas.installSpace = async (dataset, modules) => {
        started.push('personal');
        return installSpace(dataset, modules);
      };
    };
    const stores = mountShell();

    await vi.waitFor(() => expect(started).toEqual(expect.arrayContaining(['root', 'personal'])));
    releaseRoot();
    await ready(stores);
  });

  /*
    The settings read starts beside the root's reinstall rather than after it, so it can land while a
    changed settings model is being rewritten and fail. That must cost a second read, not the root:
    an unset root loses every saved template and theme for the session.
  */
  it('keeps the root when the settings read beside its reinstall fails, and reads them again', async () => {
    seededDatasets = [{ id: 'root-1', name: 'we-root' }];
    let findOne: ReturnType<typeof vi.spyOn> | undefined;
    // Spied when boot lists the datasets: the entities are registered by then, and the root is not
    // up yet. Any earlier and the spy sits on a class that registration replaces.
    onPorts = (ports) => {
      const list = ports.lifecycle.list.bind(ports.lifecycle);
      ports.lifecycle.list = async (options) => {
        // The registered class itself: a spy defined on the neutral stand-in never sees a call.
        findOne ??= vi
          .spyOn(getEntity('AgentSettings') as unknown as { findOne: () => Promise<unknown> }, 'findOne')
          .mockRejectedValueOnce(new Error('No SHACL shape'));
        return list(options);
      };
    };
    try {
      const stores = mountShell();
      await ready(stores);

      expect(stores.datasets.rootDataset()?.id).toBe('root-1');
      expect(findOne).toHaveBeenCalledTimes(2);
    } finally {
      findOne?.mockRestore();
    }
  });

  /*
    A reload on a space's address waited for the whole boot before that space began to load, then
    read its templates, then its schema, one after another. Its templates and schema reads now start
    as soon as the list names it, and the agent's spaces are read beside the system datasets.
  */
  it('starts the addressed space, and reads spaces, while the system datasets come up', async () => {
    seededDatasets = [{ id: 'garden-1', name: 'Garden' }];
    window.history.replaceState({}, '', '/space/garden-1/canvas');
    let releaseRoot!: () => void;
    const rootHeld = new Promise<void>((resolve) => (releaseRoot = resolve));
    const prepared: unknown[] = [];
    onPorts = (ports) => {
      const { installRoot } = ports.schemas;
      ports.schemas.installRoot = async (dataset) => {
        await rootHeld;
        return installRoot(dataset);
      };
      ports.schemas.prepare = (dataset) => prepared.push(dataset);
    };
    try {
      const stores = mountShell();
      const loadSpaces = vi.spyOn(stores.spaces, 'loadSpaces');

      await vi.waitFor(() => expect(prepared).toHaveLength(1));
      await vi.waitFor(() =>
        expect(loadSpaces).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'garden-1' })])),
      );
      expect(stores.session.bootState()).not.toBe('ready');

      releaseRoot();
      await ready(stores);
    } finally {
      window.history.replaceState({}, '', '/');
    }
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

describe('what the backend can do with an identity', () => {
  it('is nothing on a backend with no identity port, so Settings says "coming soon"', async () => {
    const stores = mountShell();
    await ready(stores);

    expect(Object.values(stores.session.identityCapabilities()).every((on) => on === false)).toBe(true);
  });

  it('is what the backend answers once the session is usable, and nothing again after logging out', async () => {
    agentOptions = { unlocked: false, password: 'secret' };
    onPorts = (ports) => {
      // A partial answer: whatever a backend leaves out stays off rather than reading as undefined.
      ports.identity = { capabilities: async () => ({ devices: true, linkDevice: true }) as never };
    };
    const stores = mountShell();
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('login'));
    await stores.session.login('secret');
    await ready(stores);

    await vi.waitFor(() => expect(stores.session.identityCapabilities().devices).toBe(true));
    expect(stores.session.identityCapabilities().linkDevice).toBe(true);
    expect(stores.session.identityCapabilities().password).toBe(false);

    await stores.session.logout();
    // The next person to sign in on this screen is not owed the last one's answer.
    expect(stores.session.identityCapabilities().devices).toBe(false);
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

  /*
    The app somebody is in decides what a space made there starts as: Coasys's, built into this
    deployment's seed, carries its own starter. Its template and theme land under the bundle's id,
    and its landmarks are written — the Coasys seed's starter named them under a key nothing read.
  */
  it('starts a space made in a built-in app as that app’s, and one made in WE’s own as the seed’s', async () => {
    const stores = mountShell();
    await ready(stores);
    app.use({ id: 'coasys--app', source: { bundle: 'coasys' } });
    try {
      const [kit, ...rest] = stores.spaces.starterChoices();
      // In the starter's own words, with its own glyph and what it writes counted from its records.
      expect(kit).toMatchObject({ app: 'Coasys', name: "Coasys's starter kit", icon: 'dna' });
      expect(kit.description).toContain('Social DNA');
      expect(kit.includes).toBe('1 reaction · 3 task states · 5 ways to be involved · a canvas · a board');
      // A template chooses by id; the records stay in the store.
      expect(kit).not.toHaveProperty('starter');
      expect(rest.map((c) => c.id)).toEqual([NO_STARTER]);
      await stores.spaces.createSpace('In Coasys', '', 'personal', 'hidden');
      await stores.spaces.createSpace(
        'Bare in Coasys',
        '',
        'personal',
        'hidden',
        undefined,
        undefined,
        null,
        '',
        '',
        NO_STARTER,
      );
      // One no longer offered is refused before a space exists, rather than swapped for the default.
      await expect(
        stores.spaces.createSpace('Stale', '', 'personal', 'hidden', undefined, undefined, null, '', '', 'gone'),
      ).rejects.toThrow('gone');
    } finally {
      app.use({ id: 'we-app' });
    }
    // The test seed has no starter of its own, so in WE's app there is nothing to choose between.
    expect(stores.spaces.starterChoices().map((c) => c.id)).toEqual([NO_STARTER]);
    await stores.spaces.createSpace('In WE', '', 'personal', 'hidden');

    const rowOf = async (name: string) => {
      const uuid = (await lifecycle.list()).find((d) => d.name === name)!.id;
      await vi.waitFor(() => expect(stores.spaces.spaceList().find((r) => r.uuid === uuid)?.isWeSpace).toBe(true));
      return stores.spaces.spaceList().find((r) => r.uuid === uuid)!;
    };
    expect((await rowOf('In Coasys')).defaultThemeId).toBe('coasys--glow');
    expect((await rowOf('Bare in Coasys')).defaultThemeId).not.toBe('coasys--glow');
    expect((await lifecycle.list()).some((d) => d.name === 'Stale')).toBe(false);
    expect((await rowOf('In WE')).defaultThemeId).not.toBe('coasys--glow');
  }, 10000);

  /*
    `$each` keys by reference, so a row rebuilt as a new object remounts everything under it — in the
    space-settings page that was the scroll position, thrown back to the top by setting a default.
  */
  it('keeps a space’s row the same object when one of its settings changes', async () => {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Row Space', '', 'personal', 'hidden');
    const uuid = (await lifecycle.list()).find((d) => d.name === 'Row Space')!.id;
    const rowOf = () => stores.spaces.spaceList().find((r) => r.uuid === uuid);
    await vi.waitFor(() => expect(rowOf()?.isWeSpace).toBe(true));
    const before = rowOf();

    await stores.spaces.setSpaceDefaultTheme('retro', uuid);

    expect(rowOf()?.defaultThemeId).toBe('retro');
    expect(rowOf()).toBe(before);
  }, 10000);

  /*
    A shared space is published in the background, after it exists and usually after it is open. The
    open space was set before the publish and nothing set it again, so everything keyed on its shared
    address stayed dead until a reload: no way to start a call, no presence, and a URL — and so a
    copied link — carrying the local id.
  */
  it('gives the open space its shared address when a background publish finishes', async () => {
    const stores = mountShell();
    await ready(stores);

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const publish = lifecycle.publish.bind(lifecycle);
    // Held, so the space is open before its publish finishes — the order the background share has.
    vi.spyOn(lifecycle, 'publish').mockImplementationOnce(async (...args: Parameters<typeof publish>) => {
      await held;
      return publish(...args);
    });

    const id = (await stores.spaces.createSpace('Shared', '', 'shared', 'hidden'))!;
    await stores.spaces.navigateToSpace(id);
    route.go(`/space/${id}/chat`);
    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(id));
    expect(stores.datasets.currentDataset()?.sharedUri).toBeUndefined();

    navigate.mockClear();
    release();

    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.sharedUri).toBe(`inmemory://shared-${id}`));
    // The address on screen moves from the local id to the shared one.
    expect(navigate).toHaveBeenCalledWith(`/space/shared-${id}/chat`, { replace: true });
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

  /*
    A join returns before the neighbourhood has synced (coasys/ad4m#1466). Installing the schema
    then read an empty dataset, found none of the creator's shapes and wrote a second copy of every
    one; it must wait for the backend to say the dataset has synced.
  */
  function holdSync(id: string) {
    const installed: string[] = [];
    let release!: () => void;
    let fail!: (error: Error) => void;
    const held = new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    onPorts = (ports) => {
      const { installSpace, hasCoreSchema, hasAnySchema } = ports.schemas;
      const idOf = (dataset: unknown) => (dataset as { id: string }).id;
      ports.schemas.installSpace = async (dataset, modules) => {
        installed.push(idOf(dataset));
        return installSpace(dataset, modules);
      };
      // The held dataset holds a schema only once one is installed into it — none arrives by sync
      // here — where the in-memory backend otherwise answers that every dataset has one.
      ports.schemas.hasCoreSchema = async (dataset) =>
        idOf(dataset) === id ? installed.includes(id) : hasCoreSchema(dataset);
      ports.schemas.hasAnySchema = async (dataset) =>
        idOf(dataset) === id ? installed.includes(id) : hasAnySchema(dataset);
      ports.lifecycle.whenSynced = (datasetId) => (datasetId === id ? held : Promise.resolve());
    };
    return { installed, release: () => release(), fail: (error: Error) => fail(error) };
  }

  it('installs the schema into a joined space only once it has synced', async () => {
    const sync = holdSync('sync-ds');
    const stores = mountShell();
    await ready(stores);
    lifecycle.seedShared({ id: 'sync-ds', name: 'Syncing Space', sharedUri: 'inmemory://sync-ds' });

    const joined = stores.spaces.joinSpace('inmemory://sync-ds');
    await vi.waitFor(() => expect(stores.spaces.joiningSpace()).toBe('sync-ds'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sync.installed, 'installed before the dataset synced').not.toContain('sync-ds');
    expect(stores.spaces.joiningSpace(), 'the join is still in progress while it syncs').toBe('sync-ds');

    sync.release();
    await joined;

    expect(sync.installed).toContain('sync-ds');
    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.name).toBe('Syncing Space'));
    expect(stores.spaces.joiningSpace()).toBe('');
  }, 10000);

  it('fails a join whose space cannot sync, and installs nothing into it', async () => {
    const sync = holdSync('broken-ds');
    const stores = mountShell();
    await ready(stores);
    lifecycle.seedShared({ id: 'broken-ds', name: 'Broken Space', sharedUri: 'inmemory://broken-ds' });

    const joined = stores.spaces.joinSpace('inmemory://broken-ds');
    sync.fail(new Error('The space’s sync language could not be installed.'));

    await expect(joined).rejects.toThrow(/sync language/);
    expect(sync.installed).not.toContain('broken-ds');
    expect(stores.spaces.joinError()).toEqual(expect.objectContaining({ spaceId: 'broken-ds' }));
    expect(stores.spaces.joiningSpace()).toBe('');
  }, 10000);

  it('does not judge a dataset empty, and make it a WE space, before it has synced', async () => {
    // The dataset-added event can switch to a just-joined dataset before the join has finished.
    // Holding no schema then says nothing about what it is: a Flux community looks the same.
    seededDatasets = [{ id: 'unsynced-ds', name: 'Unsynced' }];
    const sync = holdSync('unsynced-ds');
    const stores = mountShell();
    await ready(stores);

    const switched = stores.datasets.switchDataset('unsynced-ds');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sync.installed).not.toContain('unsynced-ds');

    sync.release();
    await switched;

    expect(sync.installed).toContain('unsynced-ds');
    expect(stores.datasets.isWeSpace()).toBe(true);
  }, 10000);

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

  it('gives a new space its collection, and writes the starter under it', async () => {
    /*
      The space collection is the host's and is made whatever the starter says; the canvas, its landmark
      and the settings are the starter's. Both halves are written at the create press, and nothing on
      screen says when either is missing — a space simply arrives without its canvas.
    */
    provideSeed({
      name: 'test',
      modules: [],
      spaceStarters: [
        {
          id: 'test',
          settings: { defaultTemplateId: 'workshop' },
          records: [{ $id: 'canvas', entity: 'CollectionBlock', fields: { kind: 'canvas' }, in: '$root' }],
          landmarks: { canvas: '$canvas' },
          input: true,
        },
      ],
    } as never);
    try {
      const stores = mountShell();
      await ready(stores);

      await stores.spaces.createSpace('Structured', 'x', 'personal', 'hidden');
      const ref = (await lifecycle.list()).find((d) => d.name === 'Structured')!;

      const [space] = await Space.findAll(ref.handle as never, { include: { root: true } });
      expect(space.defaultTemplateId).toBe('workshop');
      const root = (space as unknown as { root?: { id: string; kind: string } }).root;
      expect(root?.kind).toBe('channel');
      // The starter's `input` lands on the space collection itself, where the messages typed outside
      // calls are decided — not on the space, which holds only what new collections start with.
      const rootRecord = await CollectionBlock.findOne(ref.handle as never, { where: { id: root!.id } } as never);
      expect((rootRecord as unknown as { autoExtract?: boolean }).autoExtract).toBe(true);

      const holder = await CollectionBlock.findOne(
        ref.handle as never,
        {
          where: { id: root!.id },
          include: { children: true },
        } as never,
      );
      const contained = (holder as unknown as { children?: { id: string; kind: string }[] })?.children ?? [];
      expect(contained.map((c) => c.kind)).toEqual(['canvas']);

      const landmarks = await SpaceLandmark.findAll(ref.handle as never);
      expect(landmarks.map((r) => [r.name, Array.isArray(r.node) ? r.node[0] : r.node])).toEqual([
        ['canvas', contained[0].id],
      ]);
    } finally {
      provideSeed({ name: 'test', modules: [] } as never);
    }
  }, 10000);

  it('hears a landmark written after the space was entered', async () => {
    /*
      Landmarks were read once, on entering. A space entered while its starter was still writing — or
      one whose board a peer made afterwards — showed "make a board" beside a board that existed.
    */
    const stores = mountShell();
    await ready(stores);

    await stores.spaces.createSpace('Late Landmarks', 'x', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Late Landmarks')!;
    await stores.datasets.switchDataset(ref.id);
    await vi.waitFor(() => expect(stores.spaces.root()).not.toBe(''));
    expect(stores.spaces.landmarks().board).toBeUndefined();

    const [space] = await Space.findAll(ref.handle as never);
    const board = await CollectionBlock.create(ref.handle as never, { kind: 'board', title: 'Board' } as never);
    await writeSpaceLandmark(ref.handle as never, space.id, 'board', board.id);

    await vi.waitFor(() => expect(stores.spaces.landmarks().board).toBe(board.id));
  }, 10000);

  it('says in the model wizard which field will name a record, worked out or chosen', async () => {
    /*
      "Work it out" picks a field called name or title, else the first text field — a rule nothing
      in the list showed, so a field was treated specially on every card with no word of why.
    */
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Named', 'x', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Named')!;
    await stores.datasets.switchDataset(ref.id);

    const { shapes } = stores;
    shapes.openShapeWizard();
    shapes.setShapeField('name', 'Sighting');
    shapes.addProperty();
    shapes.addProperty();
    const [species, notes] = shapes.shapeDraft()!.members.filter((m) => m.kind === 'property');
    shapes.setMemberField(species.rowId, 'name', 'species');
    shapes.setMemberField(notes.rowId, 'name', 'notes');

    // Names are typed in place and announced on blur, as the name input does.
    shapes.commitDraft();

    expect(shapes.draftNameMember()).toBe(species.rowId);
    expect(shapes.nameOptions()[0].label).toBe('Work it out (species)');

    // The first text field, so it follows the order.
    shapes.reorderMembers([notes.rowId, species.rowId]);
    expect(shapes.draftNameMember()).toBe(notes.rowId);
    expect(shapes.nameOptions()[0].label).toBe('Work it out (notes)');

    // A field chosen is the one, and the option stops guessing.
    shapes.setNameMember(species.rowId);
    expect(shapes.draftNameMember()).toBe(species.rowId);
    expect(shapes.nameOptions()[0].label).toBe('Work it out');
  }, 10000);

  it('makes the creator of a space its admin, and lets an admin give and take back a role', async () => {
    /*
      The admin role is the host's, written at the create press like the space collection: a shared
      space must always have somebody who administers it. Every other role is the community's.
    */
    const stores = mountShell();
    await ready(stores);
    const me = stores.session.me()?.did ?? '';

    await stores.spaces.createSpace('Stewarded', 'x', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Stewarded')!;
    await stores.datasets.switchDataset(ref.id);
    await vi.waitFor(() => expect(stores.spaces.roles().map((r) => [r.slug, r.holders])).toEqual([['admin', [me]]]));
    expect(stores.spaces.myRoles()).toEqual(['admin']);

    await stores.spaces.createRole({ name: 'Moderator', description: 'Looks after posts' });
    await stores.spaces.grantRole('moderator', 'did:test:ben');
    await vi.waitFor(() => expect(stores.spaces.memberRoles()['did:test:ben']).toEqual(['moderator']));
    expect(stores.spaces.roles().find((r) => r.slug === 'moderator')).toMatchObject({
      name: 'Moderator',
      description: 'Looks after posts',
    });

    // The last admin keeps the role: somebody else has to be made one first.
    await stores.spaces.revokeRole('admin', me);
    expect(stores.spaces.myRoles()).toEqual(['admin']);

    await stores.spaces.revokeRole('moderator', 'did:test:ben');
    await vi.waitFor(() => expect(stores.spaces.memberRoles()['did:test:ben']).toBeUndefined());
  }, 10000);

  it('answers who administers a shared space from its roles, not from who made it', async () => {
    const stores = mountShell();
    await ready(stores);
    const me = stores.session.me()?.did ?? '';

    await stores.spaces.createSpace('Handed On', 'x', 'shared', 'hidden');
    await vi.waitFor(() =>
      expect(stores.spaces.spaceList().find((s) => s.name === 'Handed On')).toMatchObject({ kind: 'shared' }),
    );
    const ref = (await lifecycle.list()).find((d) => d.name === 'Handed On')!;
    await stores.datasets.switchDataset(ref.id);
    await vi.waitFor(() => expect(stores.spaces.myRoles()).toEqual(['admin']));
    expect(stores.spaces.canAdministerCurrentSpace()).toBe(true);

    // Hand the space on: another admin first, then step down.
    await stores.spaces.grantRole('admin', 'did:test:ben');
    await stores.spaces.revokeRole('admin', me);
    await vi.waitFor(() => expect(stores.spaces.myRoles()).toEqual([]));

    // Having made the space is no way back in while somebody holds the role.
    expect(stores.spaces.canAdministerCurrentSpace()).toBe(false);
    await expect(stores.spaces.grantRole('admin', me)).rejects.toThrow(/administers/);
  }, 10000);

  it('starts a shared space open, and once it is on community, refuses at the write what that does not allow', async () => {
    /*
      End to end through the real check: the store registers it, the backend asks it, and a write the
      space's rules do not allow is refused with nothing written — whichever caller made it.
    */
    const stores = mountShell();
    await ready(stores);
    const me = stores.session.me()?.did ?? '';
    await stores.spaces.createSpace('Ruled', 'x', 'shared', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Ruled')!;
    await stores.datasets.switchDataset(ref.id);
    const handle = ref.handle as never;
    // Nothing written: a space with no policy reads as open, as every space did before.
    await vi.waitFor(() => expect(stores.spaces.policy()).toMatchObject({ loaded: true, preset: 'open' }));
    expect(await Policy.count(handle as never)).toBe(0);
    expect(stores.spaces.policy().roles).toEqual(['admin']);

    // An admin may change the rules; choosing what is in force already writes nothing.
    await stores.spaces.setPolicyPreset('open');
    await stores.spaces.setPolicyPreset('community');
    await vi.waitFor(() => expect(stores.spaces.policy().preset).toBe('community'));
    await stores.spaces.setPolicyPreset('open');
    await vi.waitFor(() => expect(stores.spaces.policy().preset).toBe('open'));
    await stores.spaces.setPolicyPreset('community');
    await vi.waitFor(() => expect(stores.spaces.policy().preset).toBe('community'));
    expect(await Policy.count(handle as never)).toBe(3);

    // Somebody else administers it now; this agent is a member.
    await stores.spaces.grantRole('admin', 'did:test:somebody-else');
    await stores.spaces.revokeRole('admin', me);
    await vi.waitFor(() => expect(stores.spaces.policy().roles).toEqual([]));

    const refused = vi.spyOn(toastService, 'error');
    const [space] = await Space.findAll(handle as never, { where: { name: 'Ruled' } });
    await expect(Space.update(handle as never, space.id, { description: 'mine now' } as never)).rejects.toMatchObject({
      name: 'PolicyRefusal',
    });
    expect(refused).toHaveBeenCalledWith(expect.stringContaining('Space.edit'));
    expect((await Space.findOne(handle as never, { where: { id: space.id } }))?.description).toBe('x');
    await expect(stores.spaces.setPolicyPreset('open')).rejects.toMatchObject({ name: 'PolicyRefusal' });
    expect(stores.spaces.policy().preset).toBe('community');

    // What members make is still theirs to make.
    await expect(CollectionBlock.create(handle, { kind: 'post' } as never)).resolves.toBeDefined();
    refused.mockRestore();
  }, 15000);

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
    // Sharing follows the create; see 'creating a shared space in stages'.
    await vi.waitFor(() => expect(stores.spaces.spaceList().find((s) => s.name === 'Public')?.kind).toBe('shared'));

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

/**
 * Creating a shared space is two stages: the local space, which is what the person waits for, and
 * sharing it, which talks to the network and runs after. Each test holds `publish` open to look at
 * the space between the two.
 */
describe('creating a shared space in stages', () => {
  /** Replaces the backend's publish with one each call of which the test settles by hand. */
  function holdPublish() {
    const calls: { resolve: () => void; reject: (err: Error) => void }[] = [];
    onPorts = (ports) => {
      const publish = ports.lifecycle.publish.bind(ports.lifecycle);
      ports.lifecycle.publish = (id: string, options?: { sharing?: string }) =>
        new Promise<{ uri: string; sharedId: string }>((resolve, reject) => {
          calls.push({ resolve: () => void publish(id, options).then(resolve, reject), reject });
        });
    };
    return calls;
  }
  const row = (stores: Stores, name: string) => stores.spaces.spaceList().find((s) => s.name === name)!;

  it('is ready before it is shared, and shares in the background', async () => {
    const publish = holdPublish();
    const stores = mountShell();
    await ready(stores);

    await stores.spaces.createSpace('Garden', 'x', 'shared', 'hidden');

    // Resolved with publish still open: the space is here, local, and says it is being shared.
    expect(publish).toHaveLength(1);
    expect(row(stores, 'Garden')).toMatchObject({ sharing: 'sharing', shareLink: '', kind: 'personal' });
    const created = (await lifecycle.list()).find((d) => d.name === 'Garden')!;
    const [before] = await Space.findAll(created.handle as never);
    expect(before.url).toBeFalsy();

    publish[0].resolve();

    await vi.waitFor(() => expect(row(stores, 'Garden')).toMatchObject({ sharing: '', kind: 'shared' }));
    const shared = (await lifecycle.list()).find((d) => d.name === 'Garden')!;
    expect(shared.sharedUri).toMatch(/^inmemory:\/\//);
    expect(row(stores, 'Garden').shareLink).toContain(shared.sharedId);
    const [after] = await Space.findAll(shared.handle as never);
    expect(after.url).toBe(shared.sharedId);
  }, 10000);

  it('keeps the space when sharing fails, and shares it on a retry', async () => {
    const publish = holdPublish();
    const stores = mountShell();
    await ready(stores);

    await stores.spaces.createSpace('Workbench', 'x', 'shared', 'hidden');
    publish[0].reject(new Error('the network said no'));

    await vi.waitFor(() =>
      expect(row(stores, 'Workbench')).toMatchObject({ sharing: 'failed', shareError: 'the network said no' }),
    );
    // Still a space: listed, in mySpaces, and local.
    expect(stores.spaces.mySpaces().map((s) => s.name)).toContain('Workbench');
    expect(row(stores, 'Workbench')).toMatchObject({ kind: 'personal', shareLink: '' });

    const retry = stores.spaces.shareSpace(row(stores, 'Workbench').uuid);
    await vi.waitFor(() => expect(row(stores, 'Workbench').sharing).toBe('sharing'));
    publish[1].resolve();
    await retry;

    expect(row(stores, 'Workbench')).toMatchObject({ sharing: '', shareError: '', kind: 'shared' });
    expect(row(stores, 'Workbench').shareLink).not.toBe('');
  }, 10000);

  it('publishes through the server chosen, and asks for it again on a retry', async () => {
    const asked: ({ sharing?: string; server?: string } | undefined)[] = [];
    const publish = holdPublish();
    const hold = onPorts!;
    onPorts = (ports) => {
      hold(ports);
      const held = ports.lifecycle.publish;
      ports.lifecycle.publish = (id: string, options?: { sharing?: string; server?: string }) => {
        asked.push(options);
        return held(id, options);
      };
    };
    const stores = mountShell();
    await ready(stores);

    const server = 'https://link-staging.ad4m.dev';
    await stores.spaces.createSpace('Orchard', 'x', 'shared', 'hidden', undefined, undefined, null, '', server);
    publish[0].reject(new Error('the network said no'));
    await vi.waitFor(() => expect(row(stores, 'Orchard').sharing).toBe('failed'));

    const retry = stores.spaces.shareSpace(row(stores, 'Orchard').uuid);
    await vi.waitFor(() => expect(publish).toHaveLength(2));
    publish[1].resolve();
    await retry;

    expect(asked.map((options) => options?.server)).toEqual([server, server]);
  }, 10000);

  it('refuses a server that is not an http(s) address before creating anything', async () => {
    const publish = holdPublish();
    const stores = mountShell();
    await ready(stores);
    const before = (await lifecycle.list()).length;

    await expect(
      stores.spaces.createSpace('Nowhere', 'x', 'shared', 'hidden', undefined, undefined, null, '', 'link.example.org'),
    ).rejects.toThrow(/not an http\(s\) address/);

    expect(await lifecycle.list()).toHaveLength(before);
    expect(publish).toHaveLength(0);
  }, 10000);

  it('a retry after a step that follows the publish does not publish again', async () => {
    let publishes = 0;
    let failGetOnce = false;
    onPorts = (ports) => {
      const publish = ports.lifecycle.publish.bind(ports.lifecycle);
      const get = ports.lifecycle.get.bind(ports.lifecycle);
      ports.lifecycle.publish = async (id: string, options?: { sharing?: string }) => {
        publishes += 1;
        const result = await publish(id, options);
        failGetOnce = true;
        return result;
      };
      ports.lifecycle.get = async (id: string) => {
        if (failGetOnce) {
          failGetOnce = false;
          throw new Error('lost the executor after publishing');
        }
        return get(id);
      };
    };
    const stores = mountShell();
    await ready(stores);

    await stores.spaces.createSpace('Kiln', 'x', 'shared', 'hidden');
    await vi.waitFor(() => expect(row(stores, 'Kiln').sharing).toBe('failed'));

    await stores.spaces.shareSpace(row(stores, 'Kiln').uuid);

    expect(publishes).toBe(1);
    expect(row(stores, 'Kiln')).toMatchObject({ sharing: '', kind: 'shared' });
  }, 10000);

  it('lists a space in global discovery only once it has the address it is listed under', async () => {
    provideSeed({ name: 'test', modules: [], globalSpaceUrl: 'inmemory://global' } as never);
    try {
      const publish = holdPublish();
      const seedGlobal = onPorts!;
      onPorts = (ports) => {
        seedGlobal(ports);
        ports.lifecycle.seedShared({ id: 'global', name: 'Global', sharedUri: 'inmemory://global' });
      };
      const stores = mountShell();
      await ready(stores);
      await stores.spaces.joinSpace('inmemory://global', false);
      const global = stores.datasets.globalDataset()!;
      expect(global).not.toBeNull();

      await stores.spaces.createSpace('Listed', 'x', 'shared', 'listed');
      expect(await Space.findAll(global.handle as never, { where: { name: 'Listed' } })).toEqual([]);

      publish[0].resolve();

      await vi.waitFor(() => expect(row(stores, 'Listed').kind).toBe('shared'));
      const shared = (await lifecycle.list()).find((d) => d.name === 'Listed')!;
      await vi.waitFor(async () => {
        const [listing] = await Space.findAll(global.handle as never, { where: { name: 'Listed' } });
        expect(listing?.url).toBe(shared.sharedId);
      });
    } finally {
      provideSeed({ name: 'test', modules: [] } as never);
    }
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

describe('how a space presents a type', () => {
  it('lays its own presentation over the model’s, and keeps it through a colour coming and going', async () => {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Presented', 'x', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Presented')!;
    await stores.datasets.switchDataset(ref.id);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.name).toBe('Presented'));
    const spaceId = stores.spaces.currentSpace()!.id;
    const summary = () => stores.records.displays().TaskBlock?.fields.find((f) => f.role === 'summary')?.name;
    expect(summary()).toBe('description');

    await stores.records.setSpaceTypePresentation(spaceId, 'TaskBlock', { display: { summary: 'assignee' } });
    await vi.waitFor(() => expect(summary()).toBe('assignee'));

    // A colour set and cleared in the key does not take the presentation with it.
    await stores.records.setSpaceTypeColor(spaceId, 'TaskBlock', 'accent');
    await stores.records.setSpaceTypeColor(spaceId, 'TaskBlock', '');
    await stores.records.setSpaceTypePresentation(spaceId, 'EventBlock', null);
    await vi.waitFor(() => expect(summary()).toBe('assignee'));

    await stores.records.setSpaceTypePresentation(spaceId, 'TaskBlock', null);
    await vi.waitFor(() => expect(summary()).toBe('description'));
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
  it('edits the record in place, so a change keeps the reaction it changes', async () => {
    /*
      A changed rating is the same person's same reaction, differently weighted, so it keeps its id
      and its `createdAt`. It used to be removed and re-created, because an edit to a record read
      through `include` reached no subscriber — the price was a flicker, the rating passing through
      "nobody has rated this" on its way from three stars to four. A subscription now follows what
      its query includes, so the edit is the write.

      The rest is what an edit could still get wrong: one reaction of this type by this agent,
      holding the new value — and a pair written twice heals on the next change instead of staying
      doubled.
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
        parent: { id: subject.id, relation: 'signals' },
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
    // And the same record, edited.
    expect(second[0].id).toBe(first[0].id);

    // A pair somebody managed to write twice comes back to one on the next change.
    await (Signal as never as typeof Space).create(
      handle,
      { signalTypeId: stars.id, value: 2 } as never,
      { parent: { id: subject.id, relation: 'signals' } } as never,
    );
    expect(await mine()).toHaveLength(2);
    await stores.spaces.upsertSignal(subject.id, stars.id, 5);
    const healed = await mine();
    expect(healed).toHaveLength(1);
    expect(healed[0].value).toBe(5);

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

// ── Extraction settings, on the collection ────────────────────────────────────

describe('what a collection extracts', () => {
  /**
   * The interpretation port's standing-watch half, recording what was registered and removed.
   *
   * And the one fact a watch needs that only the AD4M classes report: which predicate a collection's
   * children are under, read off the class's SHACL. In-memory classes generate none, so it is stood
   * in for here — `we://child`, the name every backend accepts for containment.
   */
  function watchPort() {
    const watched: string[] = [];
    const removed: string[] = [];

    onPorts = (ports) => {
      (ports as unknown as { interpretation: unknown }).interpretation = {
        watch: async (_dataset: unknown, args: { watchId: string; classes: string[] }) => {
          watched.push(args.watchId);
        },
        unwatch: async (_dataset: unknown, watchId: string) => {
          removed.push(watchId);
        },
      };
    };
    return { watched, removed };
  }
  /** Installed after boot: the backend registers its classes afresh each time it starts. */
  function standInContainmentShape() {
    const Collection = getEntity('CollectionBlock') as unknown as { generateSHACL?: unknown };
    Collection.generateSHACL = () => ({ shape: { properties: [{ name: 'children', path: 'we://child' }] } });
  }
  const watchId = (collection: string) => `we-call-${collection.replace(/[^a-zA-Z0-9]+/g, '-')}`;

  /** The interpretation kernel exactly as a module store is handed it — what transcribe calls. */
  function kernel() {
    const deps = createRoot(() =>
      createModuleStoreDeps({
        signal: <T,>(initial: T) => createSignal(initial) as unknown as [() => T, (next: T) => void],
        effect: createEffect,
      }),
    );
    return deps.kernels.interpretation!;
  }
  const looksFor = (k: ReturnType<typeof kernel>, collection: string, entity: string) =>
    k.targets(collection).find((t) => t.entity === entity)?.selected;

  async function enterSpace(stores: Stores, name: string, access: 'personal' | 'shared' = 'personal') {
    standInContainmentShape();
    await stores.spaces.createSpace(name, 'x', access, 'hidden');
    const space = (await lifecycle.list()).find((d) => d.name === name)!;
    await stores.spaces.navigateToSpace(space.id);
    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(space.id));
    await vi.waitFor(() => expect(stores.spaces.root()).not.toBe(''));
    return space.handle as never;
  }

  /** A record's stored extraction fields, as the next reader sees them. */
  const stored = async (handle: never, id: string) =>
    (await CollectionBlock.findOne(handle, { where: { id } } as never)) as unknown as {
      autoExtract?: boolean;
      extractionTargets?: string;
    };

  it('runs the messages outside calls on the space collection’s own switch', async () => {
    const port = watchPort();
    const stores = mountShell();
    await ready(stores);
    const handle = await enterSpace(stores, 'Outside');
    const root = stores.spaces.root();

    // Made with the space's default — on — and watched for it.
    expect((await stored(handle, root)).autoExtract).toBe(true);
    await vi.waitFor(() => expect(port.watched).toContain(watchId(root)));

    // Off, for this collection: stored on it, and the watch removed.
    await stores.spaces.setAutoExtractFor(root, false);
    expect((await stored(handle, root)).autoExtract).toBe(false);
    await vi.waitFor(() => expect(port.removed).toContain(watchId(root)));
    expect(stores.spaces.autoExtractFor(root)).toBe(false);
    // The space's default — what the next collection starts with — is untouched.
    expect(stores.spaces.autoInterpret()).toBe(true);

    // And back on.
    port.watched.length = 0;
    await stores.spaces.setAutoExtractFor(root, true);
    await vi.waitFor(() => expect(port.watched).toContain(watchId(root)));
  }, 15000);

  it('refuses the space collection to a member who does not administer the space, but not a call', async () => {
    const stores = mountShell();
    await ready(stores);
    const handle = await enterSpace(stores, 'Theirs', 'shared');
    const root = stores.spaces.root();
    const call = await CollectionBlock.create(handle, { kind: 'call', mode: 'feed', autoExtract: true } as never);

    // A space somebody else administers: they hold its admin role, and this agent no longer does.
    await vi.waitFor(() => expect(stores.spaces.myRoles()).toEqual(['admin']));
    await stores.spaces.grantRole('admin', 'did:test:somebody-else');
    await stores.spaces.revokeRole('admin', stores.session.me()?.did ?? '');
    await vi.waitFor(() => expect(stores.spaces.canAdministerCurrentSpace()).toBe(false));

    expect(stores.spaces.canSetExtractionFor(root)).toBe(false);
    expect(stores.spaces.canSetExtractionFor(call.id)).toBe(true);

    const refused = vi.spyOn(toastService, 'error');
    await stores.spaces.setAutoExtractFor(root, false);
    expect(refused).toHaveBeenCalled();
    // Refused before anything was written.
    expect((await stored(handle, root)).autoExtract).toBe(true);

    // A call is its participants' to decide.
    await stores.spaces.setAutoExtractFor(call.id, false);
    expect((await stored(handle, call.id)).autoExtract).toBe(false);
    refused.mockRestore();
  }, 15000);

  it('gives a new call the defaults as they stand, and leaves a call already made with its own', async () => {
    const stores = mountShell();
    await ready(stores);
    const handle = await enterSpace(stores, 'Defaults');
    const k = kernel();

    // Made the way the host makes a new feed: the space's defaults as they stand, copied in.
    const before = await CollectionBlock.create(
      handle,
      withExtractionDefaults('CollectionBlock', { kind: 'call', mode: 'feed' }, stores.spaces.currentSpace()) as never,
    );
    await vi.waitFor(() => expect(looksFor(k, before.id, 'TaskBlock')).toBe(true));

    // The community changes its defaults.
    await stores.spaces.setAutoInterpret(false);
    await stores.spaces.setExtractionTarget('TaskBlock', false);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.autoInterpret).toBe(false));

    const after = await CollectionBlock.create(
      handle,
      withExtractionDefaults('CollectionBlock', { kind: 'call', mode: 'feed' }, stores.spaces.currentSpace()) as never,
    );

    await vi.waitFor(() => expect(stores.spaces.autoExtractFor(before.id)).toBe(true));
    await vi.waitFor(() => expect(stores.spaces.autoExtractFor(after.id)).toBe(false));
    // The one already made keeps what it started with; the new one starts with the new list.
    await vi.waitFor(() => expect(looksFor(k, after.id, 'TaskBlock')).toBe(false));
    expect(looksFor(k, before.id, 'TaskBlock')).toBe(true);
  }, 15000);

  it('a call’s switch and chips, through the module’s own kernel, change that call and no other', async () => {
    const port = watchPort();
    const stores = mountShell();
    await ready(stores);
    const handle = await enterSpace(stores, 'Calls');
    const make = () =>
      CollectionBlock.create(
        handle,
        withExtractionDefaults(
          'CollectionBlock',
          { kind: 'call', mode: 'feed' },
          stores.spaces.currentSpace(),
        ) as never,
      );
    const [a, b] = [await make(), await make()];

    // What transcribe holds: the interpretation kernel, exactly as a module store is handed it.
    const interpretation = kernel();

    // A chip: TaskBlock off for call A only.
    await interpretation.setTarget(a.id, 'TaskBlock', false);
    await vi.waitFor(() =>
      expect(interpretation.targets(a.id).find((t) => t.entity === 'TaskBlock')?.selected).toBe(false),
    );
    expect(interpretation.targets(b.id).find((t) => t.entity === 'TaskBlock')?.selected).toBe(true);
    expect(stores.spaces.extractionTargets()).toContain('TaskBlock');

    // The switch: call A off. Its watch is refused from then on; call B's is still registered.
    await interpretation.setAuto(a.id, false);
    await vi.waitFor(() => expect(stores.spaces.autoExtractFor(a.id)).toBe(false));
    await expect(interpretation.watchCollection(a.id)).rejects.toThrow('automatic extraction is off');
    await interpretation.watchCollection(b.id);
    expect(port.watched).toContain(watchId(b.id));
    expect(port.watched).not.toContain(watchId(a.id));
    expect(stores.spaces.autoExtractFor(b.id)).toBe(true);
  }, 15000);
});

// ── Responses, filed and deleted ──────────────────────────────────────────────

describe('a post and what was said under it', () => {
  it('a delete takes the replies, at any depth, and leaves a call about it', async () => {
    registerCoreBlocks();
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Threads', 'x', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Threads')!;
    await stores.spaces.navigateToSpace(ref.id);
    await vi.waitFor(() => expect(stores.spaces.root()).not.toBe(''));
    const handle = ref.handle as never;
    const root = stores.spaces.root();
    const doc = (text: string) => [{ _type: 'block', style: 'normal', children: [{ _type: 'span', text }] }];

    // A post, a reply, a reply to the reply — written the way the discussion writes them.
    const post = (await stores.spaces.createPost(doc('the post')))!;
    const reply = (await stores.spaces.createPost(doc('a reply'), {
      kind: 'reply',
      parentId: post,
      relation: 'responses',
    }))!;
    const nested = (await stores.spaces.createPost(doc('and another'), {
      kind: 'reply',
      parentId: reply,
      relation: 'responses',
    }))!;
    // And a call held about the post — a response too, threaded the same way.
    const call = await CollectionBlock.create(
      handle,
      { kind: 'call', mode: 'feed' } as never,
      {
        parent: { id: post, relation: 'responses' },
      } as never,
    );
    await completeResponse(handle, call.id, post);

    const row = async (id: string) =>
      (await CollectionBlock.findOne(handle, { where: { id } } as never)) as unknown as {
        thread?: string[];
        children?: string[];
      } | null;
    // Before the delete: all three in the post's thread, and none of them a child of anything — the
    // space collection holds the post and nothing that was said under it.
    await vi.waitFor(async () =>
      expect((await row(post))?.thread ?? []).toEqual(expect.arrayContaining([reply, nested, call.id])),
    );
    const before = (await row(root))?.children ?? [];
    expect(before).toContain(post);
    for (const id of [reply, nested, call.id]) expect(before).not.toContain(id);

    await stores.spaces.deleteCollection(post);

    expect(await row(post)).toBeNull();
    expect(await row(reply)).toBeNull();
    expect(await row(nested)).toBeNull();
    // Nothing left pointing at the post from where it lived.
    expect((await row(root))?.children ?? []).not.toContain(post);
    // The call is a conversation of its own, and outlives what it was about.
    expect(await row(call.id)).not.toBeNull();
  }, 15000);
});

/*
  The three links, end to end: a response is in its subject's thread and a child of nothing, and the
  surfaces that ask "what was said in this room" derive the answer from the subject.
*/
describe('where a response was said', () => {
  const doc = (text: string) => [{ _type: 'block', style: 'normal', children: [{ _type: 'span', text }] }];
  const row = async (handle: never, id: string) =>
    (await CollectionBlock.findOne(handle, { where: { id } } as never)) as unknown as {
      thread?: string[];
      children?: string[];
    } | null;

  async function enter(stores: Stores, name: string) {
    await stores.spaces.createSpace(name, 'x', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === name)!;
    await stores.spaces.navigateToSpace(ref.id);
    await vi.waitFor(() => expect(stores.spaces.root()).not.toBe(''));
    return ref;
  }

  it('a comment on a post in a channel is in the post’s thread, not the channel, and marks the channel unread', async () => {
    registerCoreBlocks();
    const stores = mountShell();
    await ready(stores);
    const ref = await enter(stores, 'Forum');
    const other = await enter(stores, 'Elsewhere');
    await stores.spaces.navigateToSpace(ref.id);
    await vi.waitFor(() => expect(stores.spaces.root()).not.toBe(''));
    const handle = ref.handle as never;

    // A channel in the space, and a post in the channel — written the way the app writes them.
    const channel = await CollectionBlock.create(
      handle,
      { kind: 'channel', mode: 'feed' } as never,
      { parent: { id: stores.spaces.root(), relation: 'children', entity: 'CollectionBlock' } } as never,
    );
    const post = (await stores.spaces.createPost(doc('the post'), { parentId: channel.id }))!;

    // This member reads the channel, then somebody comments on the post.
    await stores.spaces.markRead(channel.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const comment = (await stores.spaces.createPost(doc('a comment'), {
      kind: 'reply',
      parentId: post,
      relation: 'responses',
    }))!;

    // In the post's thread, and a child of nothing: the channel holds the post alone.
    await vi.waitFor(async () => expect((await row(handle, post))?.thread ?? []).toEqual([comment]));
    expect((await row(handle, channel.id))?.children ?? []).toEqual([post]);

    // The space's activity is read once per entry, so leave and come back to read it again.
    await stores.spaces.navigateToSpace(other.id);
    await stores.spaces.navigateToSpace(ref.id);
    // Where it was said is derived — the post is in the channel — so the channel has something new.
    await vi.waitFor(() => expect(stores.spaces.unreadNodeIds()).toContain(channel.id));
  }, 15000);

  it('the Feed draws a call about nothing and leaves out a call held about a post', async () => {
    registerCoreBlocks();
    const stores = mountShell();
    await ready(stores);
    const ref = await enter(stores, 'Calls');
    const handle = ref.handle as never;
    const root = stores.spaces.root();

    // A call started from the rail is a child of the space collection.
    const standup = await CollectionBlock.create(
      handle,
      { kind: 'call', mode: 'feed', title: 'Standup' } as never,
      { parent: { id: root, relation: 'children', entity: 'CollectionBlock' } } as never,
    );
    // A call held about a post is a response to the post — in its thread, and a child of nothing.
    const post = (await stores.spaces.createPost(doc('the post')))!;
    const about = await CollectionBlock.create(
      handle,
      { kind: 'call', mode: 'feed', title: 'About the post' } as never,
      { parent: { id: post, relation: 'responses' } } as never,
    );
    await completeResponse(handle, about.id, post);
    const TextBlock = getEntity('TextBlock') as unknown as {
      create(h: never, d: Record<string, unknown>, o: Record<string, unknown>): Promise<{ id: string }>;
    };
    const said = await TextBlock.create(
      handle,
      { text: 'morning all', source: 'spoken' },
      { parent: { id: standup.id, relation: 'children', entity: 'CollectionBlock' } },
    );
    const aside = await TextBlock.create(
      handle,
      { text: 'about that post', source: 'spoken' },
      { parent: { id: about.id, relation: 'children', entity: 'CollectionBlock' } },
    );

    // The Feed's own read, through the host's mapping of a module's `within` onto `parent`
    // (TemplateProvider's `withinAsParent`).
    const find: FeedFind = async (entity, query) => {
      const { within, ...rest } = query as { within?: string } & Record<string, unknown>;
      const options = within
        ? { ...rest, parent: { id: within, relation: 'children', entity: 'CollectionBlock' } }
        : rest;
      return ((await getEntity(entity).findAll(handle, options as never)) ?? []) as never;
    };
    const { rows } = await readFeedWindow(find, { root, shown: 20, fromStart: true, activityTypes: [] });
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(said.id);
    expect(rows.find((r) => r.id === said.id)).toMatchObject({ call: standup.id, callTitle: 'Standup' });
    expect(ids).not.toContain(aside.id);
  }, 15000);
});
