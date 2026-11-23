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
import { cleanup, render } from '@solidjs/testing-library';
import { createInMemoryBackendPorts, type InMemoryAgentOptions, type InMemoryLifecycle } from '@we/backend-inmemory';
import { type EntityManifest, ModuleSchemasRefused } from '@we/backend-shared';
import { createBlocks, registerCoreBlocks } from '@we/block-shared';
import { toastService } from '@we/components/solid';
import { provideFileSaver } from '@we/design-utils';
import {
  AgentSettings,
  CollectionBlock,
  getEntity,
  getEntityForDataset,
  ModelRun,
  Policy,
  Space,
  SpaceLandmark,
  unregisterEntity,
} from '@we/entities';
import { type FeedFind, readFeedWindow } from '@we/module-feed';
import { notesModule } from '@we/module-notes';
import { pocketModule } from '@we/module-pocket';
import { createEffect, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

/**
 * Set by a test that boots twice against one backend: a reload, with what the first boot wrote still
 * there. Absent, every boot gets a backend of its own.
 */
let keepBackend = false;
let keptPorts: ReturnType<typeof createInMemoryBackendPorts> | undefined;

/**
 * The first-screen gate, made new for each test rather than once for the file.
 *
 * The real one is a module singleton that holds once per app, so in this file the first test to boot
 * held it and every test after ran beneath a gate nothing opened but the eight-second ceiling — the
 * harness mounts no Feed and no layout to say the screen is up. Here it holds only when a test sets
 * `gate.holds` before mounting, and that test opens it with `gate.current.answered()`, as the Feed's
 * first page does. Every other test boots with it open.
 */
const gate = vi.hoisted(() => ({
  holds: false,
  current: undefined as unknown as import('../src/shared/firstScreen').FirstScreen,
  reset: () => {},
}));
vi.mock('../src/frameworks/solid/firstScreen', async () => {
  const { createFirstScreen } = await import('../src/shared/firstScreen');
  const { createSignal } = await import('solid-js');
  gate.reset = () => {
    gate.current = createFirstScreen({
      signal: <T,>(initial: T): [() => T, (next: T) => void] => {
        const [read, write] = createSignal(initial);
        return [read, (next: T) => void write(() => next)];
      },
    });
  };
  gate.reset();
  return {
    firstScreen: {
      open: () => gate.current.open(),
      whenOpen: () => gate.current.whenOpen(),
      hold: () => {
        if (gate.holds) gate.current.hold();
      },
      waiting: () => gate.current.waiting(),
      answered: () => gate.current.answered(),
      drawn: () => gate.current.drawn(),
    },
  };
});

vi.mock('../src/frameworks/solid/providers/PlatformProvider', () => ({
  usePlatform: () => ({ isDesktop: false, isDevelopment: true, executor: executorHost }),
  useBackend: () => ({
    // The real in-memory bundle — the same thing a backend-less host would supply.
    initialize: async (ctx: { selfId(): string | undefined }) => {
      if (connectFailure) throw new Error(connectFailure);
      const ports =
        (keepBackend && keptPorts) ||
        createInMemoryBackendPorts(ctx, { agent: agentOptions, datasets: seededDatasets });
      keptPorts = ports;
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
const app = vi.hoisted(() => ({
  use: (_app: AppInUse) => {},
  /*
    The template registry and the template on screen, so a test can put one up and watch what a
    save swaps in and rolls back. `put`/`shown` are rebound to each mounted provider — the mock
    owns the signal — and `list` is cleared in `beforeEach`.
  */
  templates: {
    list: [] as { id: string; _fromSpace?: boolean }[],
    put: (_t: unknown) => {},
    shown: (): Record<string, unknown> => ({}),
    /** Every id painted, in order — whether a repaint happened is as testable as what it painted. */
    repaints: [] as string[],
  },
}));

vi.mock('../src/frameworks/solid/stores/TemplateStore', async () => {
  const { createSignal, createEffect } = await import('solid-js');
  const { useDatasetStore } = await import('../src/frameworks/solid/stores/DatasetStore');
  const { SpacePreference, AGENT_DEFAULT, FOLLOW_SPACE } = await import('@we/entities');
  const { latestPerSpace } = await import('../src/frameworks/solid/stores/latestPerSpace');
  const [inUse, setInUse] = createSignal<AppInUse>({ id: 'we-app' });
  app.use = setInUse;
  return {
    useTemplateStore: () => {
      /*
        A signal behind the property, so a template put up and one repainted both read — the
        real store is a Solid store for the same reason.
      */
      const [current, setCurrentRaw] = createSignal<Record<string, unknown>>({});
      const setCurrent = (t: never) => {
        app.templates.repaints.push((t as { id?: string }).id ?? '');
        setCurrentRaw(t);
      };
      app.templates.put = (t) => setCurrent(t as never);
      app.templates.shown = current;
      const datasets = useDatasetStore();

      /*
        The real store's space-template follow, modelled rather than stubbed: when the record the
        space lookup serves names a different `defaultTemplateId` for the dataset on screen, its
        template is chosen again — through this agent's `SpacePreference` where one is written,
        because a named choice or `AGENT_DEFAULT` outranks the record. `setSpaceDefaultTemplate`
        paints only through this path now, so a double that could not follow would hide the
        publish-to-repaint contract from every test below.
      */
      let spaceLookup: () => { uuid?: string; url?: string; defaultTemplateId?: string }[] = () => [];
      let followed: { id: string; named: string | undefined } | null = null;
      // The real choose sequences overlapping follows, through the same per-space tracker, and
      // re-reads the record after the preference read — a stale choose must not paint an older
      // record over a newer follow's answer.
      const chooseLatestFor = latestPerSpace();
      const namedNow = (ds: { id: string; sharedId?: string | null }) =>
        spaceLookup().find((s) => (ds.sharedId ? s.url === ds.sharedId : s.uuid === ds.id))?.defaultTemplateId;
      createEffect(() => {
        const ds = datasets.currentDataset() as { id: string; sharedId?: string | null } | undefined;
        const named = ds ? namedNow(ds) : undefined;
        const previous = followed;
        followed = ds ? { id: ds.id, named } : null;
        if (!ds || previous?.id !== ds.id || previous.named === named) return;
        void (async () => {
          const still = chooseLatestFor(ds.id).begin();
          const root = datasets.rootDataset()?.handle;
          const [preference] = (
            root ? await SpacePreference.findAll(root, { where: { spaceUuid: ds.id } }).catch(() => []) : []
          ) as { templateId?: string }[];
          if (!still()) return;
          const override = preference?.templateId;
          // `AGENT_DEFAULT` leaves the agent's own choice on screen, as the real choose does; a
          // named override paints it, and with no override the space's default does — re-read off
          // the record after the await, the way the real choose does.
          const wants =
            override === AGENT_DEFAULT ? undefined : override && override !== FOLLOW_SPACE ? override : namedNow(ds);
          const template = wants ? app.templates.list.find((t) => t.id === wants) : undefined;
          // Still the space on screen — the real store guards the same way before replacing.
          if (template && datasets.currentDataset()?.id === ds.id) setCurrent(template as never);
        })();
      });

      return {
        appTemplate: inUse,
        provideSpaceLookup: (lookup: never) => {
          spaceLookup = lookup;
        },
        preloadSpaceTemplates: async () => {},
        allTemplates: () => app.templates.list,
        get currentTemplate() {
          return current();
        },
        defaultTemplateId: () => 'default',
        replaceTemplate: (t: never) => setCurrent(t),
      };
    },
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
import { withInterpretationDefaults } from '@we/entities';

import { credential } from '../src/frameworks/solid/credential';
import { BootController } from '../src/frameworks/solid/providers/BootController';
import { AccountStoreProvider } from '../src/frameworks/solid/stores/AccountStore';
import { AppStoreProvider } from '../src/frameworks/solid/stores/AppStore';
import { ChatStoreProvider } from '../src/frameworks/solid/stores/ChatStore';
import { type DatasetStore, DatasetStoreProvider, useDatasetStore } from '../src/frameworks/solid/stores/DatasetStore';
import { type ProfileStore, ProfileStoreProvider, useProfileStore } from '../src/frameworks/solid/stores/ProfileStore';
import { type RecordStore, RecordStoreProvider, useRecordStore } from '../src/frameworks/solid/stores/RecordStore';
import { type RuntimeStore, RuntimeStoreProvider, useRuntimeStore } from '../src/frameworks/solid/stores/RuntimeStore';
import { type SessionStore, SessionStoreProvider, useSessionStore } from '../src/frameworks/solid/stores/SessionStore';
import { type ShapeStore, ShapeStoreProvider, useShapeStore } from '../src/frameworks/solid/stores/ShapeStore';
import { ShellStoreProvider } from '../src/frameworks/solid/stores/ShellStore';
import { type SpaceStore, SpaceStoreProvider, useSpaceStore } from '../src/frameworks/solid/stores/SpaceStore';
import { agentDataKernel } from '../src/shared/agentData';
import { NO_STARTER } from '../src/shared/bundles/bundleStarter';
import { createModuleStoreDeps, provideModuleHostServices } from '../src/shared/registries/moduleHostServices';
import { moduleRegistry, moduleStores } from '../src/shared/registries/moduleRegistry';
import { provideSeed } from '../src/shared/seedRegistry';
import { writeSpaceLandmark } from '../src/shared/spaceLandmarks';
import { COMMUNITY_POLICY } from '../src/shared/spacePolicy';

provideSeed({ name: 'test', modules: [] } as never);

interface Stores {
  session: SessionStore;
  datasets: DatasetStore;
  spaces: SpaceStore;
  records: RecordStore;
  shapes: ShapeStore;
  profiles: ProfileStore;
  runtime: RuntimeStore;
}

function mountShell(): Stores {
  const out = {} as Stores;
  function Capture() {
    out.profiles = useProfileStore();
    out.runtime = useRuntimeStore();
    out.session = useSessionStore();
    out.datasets = useDatasetStore();
    out.spaces = useSpaceStore();
    out.records = useRecordStore();
    out.shapes = useShapeStore();
    return null;
  }
  render(() => (
    <ShellStoreProvider>
      {/* Session hands the signed-in DID down to Chat as well as Shell — the same wiring the real
          StoreProvider makes, so the chat store mounts where it mounts there. */}
      <ChatStoreProvider>
        {/* The mocked platform supplies no `accounts`, so this mounts in its web-degraded form —
          which is what the profile write-through has to tolerate. */}
        <AccountStoreProvider>
          <SessionStoreProvider>
            {/* Setting up an account asks it whether there is an AI question, as the real order has it. */}
            <RuntimeStoreProvider>
              <DatasetStoreProvider>
                {/* SpaceStore reads the interpretation candidates off ShapeStore and hands the wizard back
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
            </RuntimeStoreProvider>
          </SessionStoreProvider>
        </AccountStoreProvider>
      </ChatStoreProvider>
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
  keepBackend = false;
  keptPorts = undefined;
  gate.holds = false;
  gate.reset();
  navigate.mockClear();
  app.templates.list = [];
  app.templates.repaints = [];
  route.go('/');
});

/**
 * An agent who already has these spaces: boot, make them, and take the shell down, leaving the
 * backend as a reload finds it. Answers each space's dataset id by its name.
 */
async function agentWithSpaces(names: string[]): Promise<Record<string, string>> {
  keepBackend = true;
  const stores = mountShell();
  await ready(stores);
  for (const name of names) await stores.spaces.createSpace(name, 'x', 'personal', 'hidden');
  const made = (await lifecycle.list()).filter((d) => names.includes(d.name));
  cleanup();
  navigate.mockClear();
  return Object.fromEntries(made.map((d) => [d.name, d.id]));
}

type SpaceFindOne = (handle: unknown, options?: { where?: { uuid?: string; url?: string } }) => Promise<unknown>;

/**
 * Hand every read of a space record whose dataset is in `others` to `answer` instead; the rest read
 * as they do. Spied when boot lists the datasets — see the root's settings test for why then.
 */
function divertSpaceReads(
  others: () => string[],
  answer: (read: () => Promise<unknown>) => Promise<unknown>,
): { spy?: ReturnType<typeof vi.spyOn>; asked: string[] } {
  const out: { spy?: ReturnType<typeof vi.spyOn>; asked: string[] } = { asked: [] };
  onPorts = (ports) => {
    const list = ports.lifecycle.list.bind(ports.lifecycle);
    ports.lifecycle.list = async (options) => {
      if (!out.spy) {
        const Entity = getEntity('Space') as unknown as { findOne: SpaceFindOne };
        const findOne = Entity.findOne.bind(Entity);
        out.spy = vi.spyOn(Entity, 'findOne').mockImplementation((handle, options) => {
          const which = options?.where?.uuid ?? options?.where?.url;
          if (which) out.asked.push(which);
          return which && others().includes(which)
            ? (answer(() => findOne(handle, options)) as never)
            : (findOne(handle, options) as never);
        });
      }
      return list(options);
    };
  };
  return out;
}

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
    The personal space's schema is several round trips to a remote backend, and the space on screen
    reads nothing from it. It used to be on the way to ready; now the app is ready without it, and
    the personal space comes up after — made on a first run before ready, so it is in the list.
  */
  it('is ready before the personal space’s schema is up, and brings it up after', async () => {
    let releasePersonal!: () => void;
    const personalHeld = new Promise<void>((resolve) => (releasePersonal = resolve));
    onPorts = (ports) => {
      const { installSpace } = ports.schemas;
      ports.schemas.installSpace = async (dataset, modules) => {
        if ((dataset as { name?: string }).name === 'we-personal') await personalHeld;
        return installSpace(dataset, modules);
      };
    };
    const stores = mountShell();
    await ready(stores);

    expect(stores.datasets.personalDataset()).toBeNull();
    expect(stores.datasets.datasets().map((d) => d.name)).toContain('we-personal');

    releasePersonal();
    await vi.waitFor(() => expect(stores.datasets.personalDataset()?.name).toBe('we-personal'));
  });

  it('is ready, and logs, when the personal space’s schema fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    onPorts = (ports) => {
      const { installSpace } = ports.schemas;
      ports.schemas.installSpace = async (dataset, modules) => {
        if ((dataset as { name?: string }).name === 'we-personal') throw new Error('schema refused');
        return installSpace(dataset, modules);
      };
    };
    try {
      const stores = mountShell();
      await ready(stores);

      await vi.waitFor(() =>
        expect(error).toHaveBeenCalledWith('DatasetStore: personal dataset error', expect.any(Error)),
      );
      expect(stores.datasets.personalDataset()).toBeNull();
      expect(stores.datasets.rootDataset()?.name).toBe('we-root');
    } finally {
      error.mockRestore();
    }
  });

  /*
    The app is ready before the personal space's schema is in, so a gather or a note can be asked for
    in between. The kernel said it was not ready and every write returned nothing: a drag into the
    Pocket in the first seconds did nothing, with no error. A write in that window waits for the
    schema and lands; if the schema fails, the write says so.
  */
  describe('a write to the personal space before its schema is up', () => {
    const host = { backend: 'inmemory', framework: 'solid' };
    type Model = {
      create(d: unknown, f: Record<string, unknown>, o?: Record<string, unknown>): Promise<{ id?: string }>;
      findAll(d: unknown, q?: unknown): Promise<Record<string, unknown>[]>;
      update(d: unknown, id: string, f: Record<string, unknown>): Promise<unknown>;
      delete(d: unknown, id: string): Promise<void>;
    };
    const model = (entity: string) => getEntity(entity) as unknown as Model;
    let unbind: (() => void) | undefined;

    /** The personal space's schema install, held until `release`, and refused with `fail`. */
    function holdPersonalSchema(options: { fail?: boolean } = {}): () => void {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      onPorts = (ports) => {
        const { installSpace } = ports.schemas;
        ports.schemas.installSpace = async (dataset, modules) => {
          if ((dataset as { name?: string }).name === 'we-personal') {
            await held;
            if (options.fail) throw new Error('schema refused');
          }
          return installSpace(dataset, modules);
        };
      };
      return release;
    }

    /** The module stores, over the agent-data kernel the host builds from the dataset store. */
    function modulesOver(stores: Stores) {
      unbind = provideModuleHostServices({
        agentData: agentDataKernel(stores.datasets, {
          create: (handle, entity, fields, options) =>
            model(entity).create(handle, fields, Object.keys(options).length ? options : undefined),
          find: (handle, entity, query) => model(entity).findAll(handle, query),
          update: (handle, entity, id, fields) => model(entity).update(handle, id, fields),
          remove: (handle, entity, id) => model(entity).delete(handle, id),
        }),
      });
      return {
        pocket: moduleStores.pocket as unknown as {
          gather: (input: { entity: string; id: string; ref: string; label: string }) => Promise<void>;
          lastError: () => string;
        },
        notes: moduleStores.notes as unknown as {
          create: (document: unknown) => Promise<string>;
          lastError: () => string;
        },
      };
    }

    const gathered = { entity: 'Post', id: 'p1', ref: 'we:n:somewhere/Post/p1', label: 'A post' };

    beforeEach(() => {
      const deps = createModuleStoreDeps({ signal: createSignal, effect: createEffect });
      moduleRegistry.register(pocketModule, host, deps);
      moduleRegistry.register(notesModule, host, deps);
      registerCoreBlocks();
    });

    afterEach(() => {
      unbind?.();
      unbind = undefined;
      moduleRegistry.unregister('pocket');
      moduleRegistry.unregister('notes');
    });

    it('holds a gather and a note until the schema is in, then writes both', async () => {
      const release = holdPersonalSchema();
      const stores = mountShell();
      await ready(stores);
      const { pocket, notes } = modulesOver(stores);
      expect(stores.datasets.personalDataset()).toBeNull();

      const gathering = pocket.gather(gathered);
      const noting = notes.create({ _type: 'document', blocks: [{ _type: 'block', text: 'kept early' }] });
      release();
      await gathering;
      const noteId = await noting;

      await vi.waitFor(() => expect(stores.datasets.personalDataset()?.name).toBe('we-personal'));
      const personal = stores.datasets.personalDataset()!;
      const items = await model('PocketItem').findAll(personal.handle);
      expect(items.map((item) => item.ref)).toEqual([gathered.ref]);
      expect(noteId).not.toBe('');
      const kept = await CollectionBlock.findAll(personal.handle as never, { where: { kind: 'post' } });
      expect(kept.map((note) => note.id)).toEqual([noteId]);
      expect(pocket.lastError()).toBe('');
      expect(notes.lastError()).toBe('');
    }, 15000);

    it('reports a gather, rather than dropping it, when the schema fails', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const release = holdPersonalSchema({ fail: true });
        const stores = mountShell();
        await ready(stores);
        const { pocket } = modulesOver(stores);

        const gathering = pocket.gather(gathered);
        release();
        await gathering;

        expect(pocket.lastError()).toMatch(/personal space/i);
      } finally {
        error.mockRestore();
      }
    }, 15000);
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
    read its templates, then its schema, one after another. Its templates and its own record now
    start as soon as the list names it, beside the root.
  */
  it('starts the addressed space, and reads its record, while the system datasets come up', async () => {
    const ids = await agentWithSpaces(['Garden']);
    window.history.replaceState({}, '', `/space/${ids.Garden}/canvas`);
    let releaseRoot!: () => void;
    const rootHeld = new Promise<void>((resolve) => (releaseRoot = resolve));
    const reads = divertSpaceReads(
      () => [],
      (read) => read(),
    );
    const wrap = onPorts!;
    onPorts = (ports) => {
      wrap(ports);
      const { installRoot } = ports.schemas;
      ports.schemas.installRoot = async (dataset) => {
        await rootHeld;
        return installRoot(dataset);
      };
    };
    try {
      const stores = mountShell();

      await vi.waitFor(() => expect(reads.asked).toContain(ids.Garden));
      expect(stores.session.bootState()).not.toBe('ready');

      releaseRoot();
      await ready(stores);
      expect(stores.spaces.mySpaces().map((s) => s.name)).toContain('Garden');
    } finally {
      reads.spy?.mockRestore();
      window.history.replaceState({}, '', '/');
    }
  });

  /*
    The longest step of a reload was the agent's other spaces: one record read per space, each going
    to the same backend as the Feed's first page, all of them before the app was ready. The space on
    screen needs none of them. It is ready, and its collection known, with those reads still out; the
    rows they are for show the dataset's name and say they are loading until they land.
  */
  describe('the space on screen, before the agent’s other spaces', () => {
    it('is ready, with its own record and collection, while the other spaces are still being read', async () => {
      const ids = await agentWithSpaces(['Garden', 'Kitchen', 'Library']);
      const others = [ids.Kitchen, ids.Library];
      window.history.replaceState({}, '', `/space/${ids.Garden}`);
      route.go(`/space/${ids.Garden}`);
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const reads = divertSpaceReads(
        () => others,
        async (read) => {
          await held;
          return read();
        },
      );
      try {
        const stores = mountShell();
        await ready(stores);

        expect(stores.spaces.mySpaces().map((s) => s.name)).toEqual(['Garden']);
        // What the Feed reads first: the space's collection.
        await vi.waitFor(() => expect(stores.spaces.root()).not.toBe(''));
        await vi.waitFor(() => expect(reads.asked).toEqual(expect.arrayContaining(others)));
        const row = (name: string) => stores.spaces.spaceList().find((r) => r.name === name);
        expect(row('Kitchen')).toMatchObject({ loading: true });
        expect(row('Garden')).toMatchObject({ loading: false, isWeSpace: true });

        release();
        await vi.waitFor(() =>
          expect(
            stores.spaces
              .mySpaces()
              .map((s) => s.name)
              .sort(),
          ).toEqual(['Garden', 'Kitchen', 'Library']),
        );
        expect(row('Kitchen')).toMatchObject({ loading: false, isWeSpace: true });
        // The open space is not read a second time.
        expect(reads.asked.filter((id) => id === ids.Garden)).toHaveLength(1);
      } finally {
        reads.spy?.mockRestore();
        window.history.replaceState({}, '', '/');
      }
    }, 15000);

    it('reads the other spaces, and the personal space’s schema, only once the first screen is up', async () => {
      const ids = await agentWithSpaces(['Garden', 'Kitchen']);
      window.history.replaceState({}, '', `/space/${ids.Garden}`);
      route.go(`/space/${ids.Garden}`);
      gate.holds = true;
      gate.reset();
      const reads = divertSpaceReads(
        () => [ids.Kitchen],
        (read) => read(),
      );
      try {
        const stores = mountShell();
        await ready(stores);
        await vi.waitFor(() => expect(stores.spaces.root()).not.toBe(''));

        expect(reads.asked).not.toContain(ids.Kitchen);
        expect(stores.datasets.personalDataset()).toBeNull();
        expect(stores.spaces.mySpaces().map((s) => s.name)).toEqual(['Garden']);

        // The Feed's first page has landed.
        gate.current.answered();
        await vi.waitFor(() =>
          expect(
            stores.spaces
              .mySpaces()
              .map((s) => s.name)
              .sort(),
          ).toEqual(['Garden', 'Kitchen']),
        );
        await vi.waitFor(() => expect(stores.datasets.personalDataset()?.name).toBe('we-personal'));
      } finally {
        reads.spy?.mockRestore();
        window.history.replaceState({}, '', '/');
      }
    }, 15000);

    it('is ready, and stays up, when the other spaces cannot be read', async () => {
      const ids = await agentWithSpaces(['Garden', 'Kitchen']);
      window.history.replaceState({}, '', `/space/${ids.Garden}`);
      route.go(`/space/${ids.Garden}`);
      const reads = divertSpaceReads(
        () => [ids.Kitchen],
        () => Promise.reject(new Error('backend gone')),
      );
      try {
        const stores = mountShell();
        await ready(stores);
        await vi.waitFor(() => expect(reads.asked).toContain(ids.Kitchen));

        const row = (name: string) => stores.spaces.spaceList().find((r) => r.name === name);
        // Not loading for ever: the read is over, and the row says what it knows.
        await vi.waitFor(() => expect(row('Kitchen')).toMatchObject({ loading: false }));
        expect(stores.spaces.mySpaces().map((s) => s.name)).toEqual(['Garden']);
        expect(stores.session.bootState()).toBe('ready');
      } finally {
        reads.spy?.mockRestore();
        window.history.replaceState({}, '', '/');
      }
    }, 15000);

    it('opens home without reading any space before ready, then lists them all', async () => {
      const ids = await agentWithSpaces(['Garden', 'Kitchen']);
      const reads = divertSpaceReads(
        () => [],
        (read) => read(),
      );
      let readyAfter = -1;
      try {
        const stores = mountShell();
        createRoot(() =>
          createEffect(() => {
            if (stores.session.bootState() === 'ready' && readyAfter < 0) readyAfter = reads.asked.length;
          }),
        );
        await ready(stores);

        expect(readyAfter).toBe(0);
        expect(navigate).toHaveBeenCalledWith('/');
        await vi.waitFor(() =>
          expect(
            stores.spaces
              .mySpaces()
              .map((s) => s.name)
              .sort(),
          ).toEqual(['Garden', 'Kitchen']),
        );
        expect(reads.asked.sort()).toEqual([ids.Garden, ids.Kitchen].sort());
      } finally {
        reads.spy?.mockRestore();
      }
    }, 15000);

    /*
      The other spaces are read once the first screen is up, which can be seconds after the list was
      read. A space that arrived in between is in the list then, and is read with the rest.
    */
    it('reads a space that arrived before the first screen was up', async () => {
      const ids = await agentWithSpaces(['Garden']);
      gate.holds = true;
      gate.reset();
      const reads = divertSpaceReads(
        () => [],
        (read) => read(),
      );
      try {
        const stores = mountShell();
        await ready(stores);

        const orchard = await lifecycle.create('Orchard');
        await Space.create(orchard.handle as never, { name: 'Orchard', uuid: orchard.id } as never);
        await vi.waitFor(() => expect(stores.datasets.datasets().map((d) => d.name)).toContain('Orchard'));

        gate.current.answered();
        await vi.waitFor(() =>
          expect(
            stores.spaces
              .mySpaces()
              .map((s) => s.name)
              .sort(),
          ).toEqual(['Garden', 'Orchard']),
        );
        expect(reads.asked.filter((id) => id === ids.Garden)).toHaveLength(1);
      } finally {
        reads.spy?.mockRestore();
      }
    }, 15000);

    /*
      A read that throws before it answers is not caught per space, so the whole list read fails.
      The rows must still stop saying they are loading.
    */
    it('stops loading the rows when the list read throws', async () => {
      const ids = await agentWithSpaces(['Garden', 'Kitchen']);
      window.history.replaceState({}, '', `/space/${ids.Garden}`);
      route.go(`/space/${ids.Garden}`);
      const reads = divertSpaceReads(
        () => [ids.Kitchen],
        () => {
          throw new Error('backend gone');
        },
      );
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const stores = mountShell();
        await ready(stores);
        await vi.waitFor(() => expect(reads.asked).toContain(ids.Kitchen));

        const row = (name: string) => stores.spaces.spaceList().find((r) => r.name === name);
        await vi.waitFor(() => expect(row('Kitchen')).toMatchObject({ loading: false }));
        expect(error).toHaveBeenCalledWith('SpaceStore: loadSpaces error', expect.any(Error));
      } finally {
        error.mockRestore();
        reads.spy?.mockRestore();
        window.history.replaceState({}, '', '/');
      }
    }, 15000);

    /*
      The share picker's options are one backend call, and nothing about them depends on the spaces.
      They are asked for beside the space reads, not after the slowest one.
    */
    it('reads the sharing options while the other spaces are still being read', async () => {
      const ids = await agentWithSpaces(['Garden', 'Kitchen']);
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const reads = divertSpaceReads(
        () => [ids.Kitchen],
        async (read) => {
          await held;
          return read();
        },
      );
      const divert = onPorts!;
      onPorts = (ports) => {
        divert(ports);
        ports.lifecycle.sharingOptions = async () => [{ id: 'p2p', name: 'p2p', kind: 'peer-to-peer' }];
      };
      try {
        const stores = mountShell();
        await ready(stores);
        await vi.waitFor(() => expect(reads.asked).toContain(ids.Kitchen));

        await vi.waitFor(() => expect(stores.spaces.sharingOptions().map((o) => o.value)).toEqual(['p2p']));
        expect(stores.spaces.mySpaces().map((s) => s.name)).not.toContain('Kitchen');
        release();
      } finally {
        release();
        reads.spy?.mockRestore();
      }
    }, 15000);

    /*
      A guest's invite names a space the agent has not joined, so there is no record to read first.
      The join happens after ready, and the other spaces' read — landing after it — must not take the
      joined space away again.
    */
    it('joins a guest’s space after ready, and keeps it when the other spaces land', async () => {
      const ids = await agentWithSpaces(['Garden']);
      const { writeGuestBootTarget } = await import('../src/shared/guestLink');
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const reads = divertSpaceReads(
        () => [ids.Garden],
        async (read) => {
          await held;
          return read();
        },
      );
      const divert = onPorts!;
      onPorts = (ports) => {
        divert(ports);
        ports.lifecycle.seedShared({ id: 'peer-ds', name: 'Peer Space', sharedUri: 'inmemory://peer-ds' });
      };
      writeGuestBootTarget({ spaceId: 'inmemory://peer-ds', autoJoin: true });
      try {
        const stores = mountShell();
        await ready(stores);

        await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/space/inmemory://peer-ds', { replace: true }));
        expect((await lifecycle.list()).some((d) => d.id === 'peer-ds')).toBe(true);
        await vi.waitFor(() => expect(stores.datasets.currentDataset()?.name).toBe('Peer Space'));

        release();
        await vi.waitFor(() => expect(stores.spaces.mySpaces().map((s) => s.name)).toContain('Garden'));
        expect(stores.datasets.datasets().some((d) => d.id === 'peer-ds')).toBe(true);
      } finally {
        reads.spy?.mockRestore();
      }
    }, 15000);
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

  /*
    The other spaces and the personal space's schema are read after the app appears, so either can
    still be out when the agent locks and signs in again. What a read started by the session before
    finds must not land in the session after.
  */
  describe('a read still out when the agent locks and signs in again', () => {
    async function signedIn(): Promise<Stores> {
      agentOptions = { unlocked: false, password: 'secret' };
      const stores = mountShell();
      await vi.waitFor(() => expect(stores.session.bootState()).toBe('login'));
      await stores.session.login('secret');
      await ready(stores);
      return stores;
    }

    async function signInAgain(stores: Stores): Promise<void> {
      await stores.session.logout();
      expect(stores.session.bootState()).toBe('login');
      await stores.session.login('secret');
      await ready(stores);
    }

    it('drops the spaces the last session read', async () => {
      let kitchen = '';
      let answered = 0;
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const reads = divertSpaceReads(
        () => [kitchen],
        async (read) => {
          // The first session's read waits; the next session's fails, so only the first can find it.
          if (answered++ === 0) {
            await held;
            return read();
          }
          throw new Error('backend gone');
        },
      );
      try {
        const stores = await signedIn();
        await stores.spaces.createSpace('Kitchen', 'x', 'personal', 'hidden');
        kitchen = stores.datasets.datasets().find((d) => d.name === 'Kitchen')!.id;

        await signInAgain(stores);
        await vi.waitFor(() => expect(answered).toBe(1));
        await signInAgain(stores);
        await vi.waitFor(() => expect(answered).toBe(2));
        const row = () => stores.spaces.spaceList().find((r) => r.name === 'Kitchen');
        await vi.waitFor(() => expect(row()).toMatchObject({ loading: false, isWeSpace: false }));

        release();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(stores.spaces.mySpaces().map((s) => s.name)).not.toContain('Kitchen');
      } finally {
        release();
        reads.spy?.mockRestore();
      }
    }, 15000);

    it('drops the personal space the last session brought up', async () => {
      let installs = 0;
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const stores = await signedIn();
      // Its schema is in from the first sign-in, so each later one brings its modules up to date.
      const { installModules } = keptPorts!.schemas;
      keptPorts!.schemas.installModules = async (dataset, modules) => {
        // The first session's install lands after the next session's.
        if ((dataset as { name?: string }).name === 'we-personal' && installs++ === 0) await held;
        return installModules(dataset, modules);
      };

      await signInAgain(stores);
      await vi.waitFor(() => expect(installs).toBe(1));
      await signInAgain(stores);
      await vi.waitFor(() => expect(installs).toBe(2));
      await vi.waitFor(() => expect(stores.datasets.personalDataset()?.name).toBe('we-personal'));
      const current = stores.datasets.datasets().find((d) => d.name === 'we-personal');
      expect(stores.datasets.personalDataset()).toBe(current);

      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(stores.datasets.personalDataset()).toBe(current);
      expect(await stores.datasets.whenPersonalDataset()).toBe(current);
    }, 15000);
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

  it('holds a first run on the AI step until it is left, and only on a first run', async () => {
    const stores = mountShell();
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('createAgent'));
    stores.session.holdForAiSetup();
    expect(stores.session.signInStep()).toBe('create');

    await stores.session.createAgent('a-strong-passphrase');
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('finishing'));
    stores.session.holdForAiSetup();
    expect(stores.session.signInStep()).toBe('setUpAi');

    stores.session.finishSetup();
    expect(stores.session.signInStep()).toBe('ready');
  }, 10000);

  it('sets up an account to the app where the backend has no AI to ask about', async () => {
    const stores = mountShell();
    await vi.waitFor(() => expect(stores.session.bootState()).toBe('createAgent'));
    expect(stores.runtime.aiSetupOptions()).toEqual(['skip']);

    credential.set('a-strong-passphrase');
    credential.setConfirmation('a-strong-passphrase');
    await stores.profiles.completeAccountSetup('Test Person');
    expect(stores.session.bootState()).toBe('ready');
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
      expect(kit.includes).toBe(
        '1 reaction · 3 task states · 5 ways to be involved · a canvas · a board · 4 record types · 1 workflow',
      );
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

  it('shows a space default set here before it is stored, read off the space on screen', async () => {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Default Space', '', 'personal', 'hidden');
    const uuid = (await lifecycle.list()).find((d) => d.name === 'Default Space')!.id;
    await stores.datasets.switchDataset(uuid);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.uuid).toBe(uuid));

    const writing = stores.spaces.setSpaceDefaultTheme('retro', uuid);
    // Before the write has been stored: what is on screen already says so.
    expect(stores.spaces.spaceDefaultThemeId()).toBe('retro');
    expect(stores.spaces.currentSpace()?.defaultThemeId).toBe('retro');
    await writing;

    const templating = stores.spaces.setSpaceDefaultTemplate('some-template', uuid);
    expect(stores.spaces.spaceDefaultTemplateId()).toBe('some-template');
    await templating;
    expect(stores.spaces.mySpaces().find((s) => s.uuid === uuid)?.defaultTemplateId).toBe('some-template');
  }, 10000);

  it('stores a space default for a space whose row is not held yet', async () => {
    const stores = mountShell();
    await ready(stores);
    // A space whose record is stored but was never read into the list, as one that synced in after boot.
    const ref = await lifecycle.create('Unheld Space');
    await Space.create(ref.handle as never, { name: 'Unheld Space', uuid: ref.id } as never);
    await vi.waitFor(() => expect(stores.datasets.datasets().map((d) => d.id)).toContain(ref.id));
    expect(stores.spaces.mySpaces().some((s) => s.uuid === ref.id)).toBe(false);

    await stores.spaces.setSpaceDefaultTheme('retro', ref.id);
    await stores.spaces.setSpaceDefaultTemplate('some-template', ref.id);

    const [stored] = await Space.findAll(ref.handle as never);
    expect(stored?.defaultThemeId).toBe('retro');
    expect(stored?.defaultTemplateId).toBe('some-template');
  }, 10000);

  /*
    A space whose record is not held is read before it is written. Two saves each starting that read
    would write in the order the reads happened to answer, so the older choice could be stored last.
  */
  it('stores the newer of two default saves last when the older one’s record read answers last', async () => {
    const stores = mountShell();
    await ready(stores);
    const ref = await lifecycle.create('Unheld Order');
    await Space.create(ref.handle as never, { name: 'Unheld Order', uuid: ref.id } as never);
    await vi.waitFor(() => expect(stores.datasets.datasets().map((d) => d.id)).toContain(ref.id));
    expect(stores.spaces.mySpaces().some((s) => s.uuid === ref.id)).toBe(false);

    const Entity = getEntity('Space') as unknown as { findAll: (...a: unknown[]) => Promise<unknown> };
    const findAll = Entity.findAll.bind(Entity);
    const reads: (() => void)[] = [];
    const spy = vi.spyOn(Entity, 'findAll').mockImplementation(async (...args: unknown[]) => {
      await new Promise<void>((resolve) => reads.push(resolve));
      return findAll(...args);
    });
    let outcome: { error?: unknown } | undefined;
    const saving = Promise.all([
      stores.spaces.setSpaceDefaultTheme('neon', ref.id),
      stores.spaces.setSpaceDefaultTheme('moss', ref.id),
    ]).then(
      () => ({}),
      (error: unknown) => ({ error }),
    );
    void saving.then((result) => (outcome = result));
    try {
      // Reads are answered newest first: whatever is out is let finish in reverse order of asking.
      for (let attempt = 0; attempt < 200 && !outcome; attempt++) {
        reads
          .splice(0)
          .reverse()
          .forEach((release) => release());
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      reads.splice(0).forEach((release) => release());
      spy.mockRestore();
    }
    expect(outcome).toEqual({});
    const [stored] = await Space.findAll(ref.handle as never);
    expect(stored?.defaultThemeId).toBe('moss');
  }, 10000);

  /*
    A publish for the space on screen keys on the dataset, but the record on screen lags the
    switch: for a moment the dataset is already the new space's while the record is still the old
    one's. A default set for the space being switched to must wait for its own record — written
    onto the one still there, it repaints the old space with the new space's choice.
  */
  it('does not land a default for the space being switched to on the record still on screen', async () => {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('From', '', 'personal', 'hidden');
    await stores.spaces.createSpace('To', '', 'personal', 'hidden');
    const refs = await lifecycle.list();
    const from = refs.find((d) => d.name === 'From')!.id;
    const to = refs.find((d) => d.name === 'To')!.id;
    await stores.datasets.switchDataset(from);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.uuid).toBe(from));
    await vi.waitFor(() => expect(stores.spaces.mySpaces().map((s) => s.uuid)).toContain(to));

    // Hold To's record read — the live query that sets `currentSpace`, not the findOne
    // `divertSpaceReads` wraps — so the dataset moves while the record on screen stays From's.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let toRead = false;
    const Entity = getEntity('Space') as unknown as {
      query: (
        handle: unknown,
        q?: { where?: { uuid?: string; url?: string } },
      ) => {
        subscribe: (cb: (rows: unknown[]) => void) => Promise<unknown[]>;
        dispose: () => void;
      };
    };
    const query = Entity.query.bind(Entity);
    const spy = vi.spyOn(Entity, 'query').mockImplementation((handle, q) => {
      const which = q?.where?.uuid ?? q?.where?.url;
      const builder = query(handle, q);
      if (which !== to) return builder;
      return {
        subscribe: async (cb) => {
          toRead = true;
          await held;
          return builder.subscribe(cb);
        },
        dispose: () => builder.dispose(),
      };
    });
    try {
      await stores.datasets.switchDataset(to);
      expect(stores.datasets.currentDataset()?.id).toBe(to);
      await vi.waitFor(() => expect(toRead).toBe(true));
      expect(stores.spaces.currentSpace()?.uuid).toBe(from);

      await stores.spaces.setSpaceDefaultTheme('retro', to);

      // To's own row carries it; the record still on screen — From's — must not.
      expect(stores.spaces.mySpaces().find((s) => s.uuid === to)?.defaultThemeId).toBe('retro');
      expect(stores.spaces.currentSpace()?.defaultThemeId).not.toBe('retro');
      expect(stores.spaces.spaceDefaultThemeId()).not.toBe('retro');

      release();
      await vi.waitFor(() => expect(stores.spaces.currentSpace()?.uuid).toBe(to));
      expect(stores.spaces.currentSpace()?.defaultThemeId).toBe('retro');
      expect(stores.spaces.spaceDefaultThemeId()).toBe('retro');
    } finally {
      spy.mockRestore();
    }
  }, 10000);

  /*
    The template on screen belongs to the record on screen, so a default-template save touches no
    template itself: it publishes the id, and the space-template follow repaints from the record.
    A rollback is the same shape — the record's last confirmed id is published back — which is the
    safety: a template the record itself brought in mid-save is never rolled back over, where a
    snapshot taken while the other space's record was still up would have replayed *that* into the
    new space. The pre-load reads the fresh id off the cache, so a template can land before the
    record does: the record read stays held below, which is exactly the window.
  */
  it('does not roll the space still on screen’s template into the space switched to', async () => {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('From', '', 'personal', 'hidden');
    await stores.spaces.createSpace('To', '', 'personal', 'hidden');
    const refs = await lifecycle.list();
    const from = refs.find((d) => d.name === 'From')!.id;
    const to = refs.find((d) => d.name === 'To')!.id;
    await stores.datasets.switchDataset(from);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.uuid).toBe(from));
    await vi.waitFor(() => expect(stores.spaces.mySpaces().map((s) => s.uuid)).toContain(to));

    // From's template is up; the registry knows the template the save for To will name. To's own
    // default is stored first, so the rollback has an exact value to go back to.
    app.templates.list = [{ id: 'from-tpl' }, { id: 'to-default' }, { id: 'to-new' }];
    await stores.spaces.setSpaceDefaultTemplate('to-default', to);
    app.templates.put({ id: 'from-tpl' });

    // Hold To's record read, as the theme case above does — the dataset moves while the record
    // and template on screen stay From's.
    let release!: () => void;
    const heldRead = new Promise<void>((resolve) => (release = resolve));
    let toRead = false;
    const Entity = getEntity('Space') as unknown as {
      query: (
        handle: unknown,
        q?: { where?: { uuid?: string; url?: string } },
      ) => {
        subscribe: (cb: (rows: unknown[]) => void) => Promise<unknown[]>;
        dispose: () => void;
      };
      update: (...a: unknown[]) => Promise<unknown>;
    };
    const query = Entity.query.bind(Entity);
    const querySpy = vi.spyOn(Entity, 'query').mockImplementation((handle, q) => {
      const which = q?.where?.uuid ?? q?.where?.url;
      const builder = query(handle, q);
      if (which !== to) return builder;
      return {
        subscribe: async (cb) => {
          toRead = true;
          await heldRead;
          return builder.subscribe(cb);
        },
        dispose: () => builder.dispose(),
      };
    });
    // The save is held at the store write, so it is still out when To's own template arrives.
    let fail!: () => void;
    const heldWrite = new Promise<void>((_resolve, reject) => (fail = () => reject(new Error('disk full'))));
    const updateSpy = vi.spyOn(Entity, 'update').mockImplementationOnce(() => heldWrite);
    try {
      await stores.datasets.switchDataset(to);
      await vi.waitFor(() => expect(toRead).toBe(true));
      expect(stores.spaces.currentSpace()?.uuid).toBe(from);

      const saving = stores.spaces.setSpaceDefaultTemplate('to-new', to);
      await vi.waitFor(() =>
        expect(stores.spaces.mySpaces().find((s) => s.uuid === to)?.defaultTemplateId).toBe('to-new'),
      );
      // The publish alone put the named template up — the save paints nothing directly.
      await vi.waitFor(() => expect(app.templates.shown().id).toBe('to-new'));
      // To's own template lands in the window — the record read is still held, and the pre-load
      // had the fresh id off the cache. Then the save fails.
      app.templates.put({ id: 'to-default' });
      fail();
      await expect(saving).rejects.toThrow('disk full');

      // To's own template stayed up — From's was not replayed into it — and To's cached row is
      // back to what it stored, not the choice that failed to save.
      expect(app.templates.shown().id).toBe('to-default');
      expect(stores.spaces.mySpaces().find((s) => s.uuid === to)?.defaultTemplateId).toBe('to-default');
    } finally {
      release();
      querySpy.mockRestore();
      updateSpy.mockRestore();
    }

    const [stored] = await Space.findAll(refs.find((d) => d.name === 'To')!.handle as never);
    expect(stored?.defaultTemplateId).toBe('to-default');
  }, 10000);

  it('stores a space setting, and shows it on the cached space and the space on screen', async () => {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Setting Space', '', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Setting Space')!;
    const uuid = ref.id;
    await stores.datasets.switchDataset(uuid);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.uuid).toBe(uuid));
    const shownBefore = stores.spaces.currentSpace();

    await stores.spaces.setThreadMode('flat', uuid);

    const held = stores.spaces.mySpaces().find((s) => s.uuid === uuid);
    expect(held?.threadMode).toBe('flat');
    // A new object, so everything reading the space on screen hears the change.
    expect(stores.spaces.currentSpace()).not.toBe(shownBefore);
    expect(stores.spaces.currentSpace()?.threadMode).toBe('flat');
    const [stored] = await Space.findAll(ref.handle as never);
    expect(stored?.threadMode).toBe('flat');
  }, 10000);

  it('says so, and changes nothing on screen, when a space setting cannot be stored', async () => {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Failing Space', '', 'personal', 'hidden');
    const uuid = (await lifecycle.list()).find((d) => d.name === 'Failing Space')!.id;
    await vi.waitFor(() => expect(stores.spaces.mySpaces().some((s) => s.uuid === uuid)).toBe(true));
    const refused = vi.spyOn(toastService, 'error');
    const update = vi
      .spyOn(getEntity('Space') as unknown as { update: (...a: unknown[]) => Promise<unknown> }, 'update')
      .mockRejectedValueOnce(new Error('disk full'));
    try {
      await expect(stores.spaces.setThreadMode('flat', uuid)).rejects.toThrow('disk full');
      expect(refused).toHaveBeenCalledWith('Could not save this change for the space.');
      expect(stores.spaces.mySpaces().find((s) => s.uuid === uuid)?.threadMode).not.toBe('flat');
    } finally {
      update.mockRestore();
      refused.mockRestore();
    }
  }, 10000);

  /*
    The default setters show the choice before it is stored. A write that fails has to take its own
    optimism back — a default that reads as saved while the record kept the old one is the setting
    that lies until the next visit.
  */
  it('restores the previous space default, and says so, when its save fails', async () => {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Defaults', '', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Defaults')!;
    const uuid = ref.id;
    await stores.datasets.switchDataset(uuid);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.uuid).toBe(uuid));
    await stores.spaces.setSpaceDefaultTheme('retro', uuid);
    await stores.spaces.setSpaceDefaultTemplate('first', uuid);

    const refused = vi.spyOn(toastService, 'error');
    const update = vi
      .spyOn(getEntity('Space') as unknown as { update: (...a: unknown[]) => Promise<unknown> }, 'update')
      .mockRejectedValue(new Error('disk full'));
    try {
      await expect(stores.spaces.setSpaceDefaultTheme('neon', uuid)).rejects.toThrow('disk full');
      await expect(stores.spaces.setSpaceDefaultTemplate('second', uuid)).rejects.toThrow('disk full');
      // Reported the way every other field's failed write is.
      expect(refused).toHaveBeenCalledWith('Could not save this change for the space.');
    } finally {
      update.mockRestore();
      refused.mockRestore();
    }

    // The shown default is what stands, on the record and in the row the picker reads.
    expect(stores.spaces.spaceDefaultThemeId()).toBe('retro');
    expect(stores.spaces.spaceDefaultTemplateId()).toBe('first');
    expect(stores.spaces.mySpaces().find((s) => s.uuid === uuid)?.defaultThemeId).toBe('retro');
    const [stored] = await Space.findAll(ref.handle as never);
    expect(stored?.defaultThemeId).toBe('retro');
    expect(stored?.defaultTemplateId).toBe('first');
  }, 10000);

  /*
    A personal template choice is not a default save's to take back. Chosen while the save is
    still out, it is written as this agent's `SpacePreference` — and when the save fails and
    publishes the record's confirmed default back, the follow chooses through that preference:
    the override stays up, where a rollback that restored what the save had painted would put
    the record's template back over a choice that was never the save's.
  */
  it('keeps a personal template override chosen while its space default’s save fails', async () => {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Defaults', '', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Defaults')!;
    const uuid = ref.id;
    await stores.datasets.switchDataset(uuid);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.uuid).toBe(uuid));
    app.templates.list = [{ id: 'first' }, { id: 'second' }, { id: 'mine' }];
    await stores.spaces.setSpaceDefaultTemplate('first', uuid);
    await vi.waitFor(() => expect(app.templates.shown().id).toBe('first'));

    // The second save is held at the store write, so the choice below lands while it is out.
    let fail!: () => void;
    const held = new Promise<void>((_resolve, reject) => (fail = () => reject(new Error('disk full'))));
    const update = vi
      .spyOn(getEntity('Space') as unknown as { update: (...a: unknown[]) => Promise<unknown> }, 'update')
      .mockImplementationOnce(() => held);
    try {
      const saving = stores.spaces.setSpaceDefaultTemplate('second', uuid);
      await vi.waitFor(() => expect(app.templates.shown().id).toBe('second'));

      await stores.spaces.setSpaceTemplateOverride('mine', uuid);
      expect(app.templates.shown().id).toBe('mine');
      const repaints = app.templates.repaints.length;

      fail();
      await expect(saving).rejects.toThrow('disk full');
      // The republish re-chooses through the preference — 'mine' again — rather than the record's
      // 'first' or the save's 'second'.
      await vi.waitFor(() => expect(app.templates.repaints.length).toBeGreaterThan(repaints));
      expect(app.templates.repaints.at(-1)).toBe('mine');
      expect(app.templates.shown().id).toBe('mine');
    } finally {
      update.mockRestore();
    }

    const [stored] = await Space.findAll(ref.handle as never);
    expect(stored?.defaultTemplateId).toBe('first');
  }, 10000);

  /*
    A save's publish starts the space-template follow, and its rollback's republish starts
    another. The first can still be inside its preference read when the second paints the stored
    default — and its record was read before the rollback landed, so left to run it would paint
    the failed save's template back over what the record last took. The choose is sequenced so
    only the newest paints, and the record is re-read after the wait.
  */
  it('does not let a follow still reading paint the failed save’s template over the rollback', async () => {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Defaults', '', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Defaults')!;
    const uuid = ref.id;
    await stores.datasets.switchDataset(uuid);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.uuid).toBe(uuid));
    app.templates.list = [{ id: 'first' }, { id: 'second' }];
    await stores.spaces.setSpaceDefaultTemplate('first', uuid);
    await vi.waitFor(() => expect(app.templates.shown().id).toBe('first'));

    // The first follow's preference read is held — the follow the save's publish started.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let holding = true;
    const Preference = getEntity('SpacePreference') as unknown as {
      findAll: (...a: unknown[]) => Promise<unknown[]>;
    };
    const findAll = Preference.findAll.bind(Preference);
    const preference = vi.spyOn(Preference, 'findAll').mockImplementation(async (...args: unknown[]) => {
      if (holding) {
        holding = false;
        await held;
      }
      return findAll(...args);
    });
    // And the save is failed at the store write.
    const update = vi
      .spyOn(getEntity('Space') as unknown as { update: (...a: unknown[]) => Promise<unknown> }, 'update')
      .mockImplementationOnce(() => Promise.reject(new Error('disk full')));
    const paintsBefore = app.templates.repaints.length;
    try {
      const saving = stores.spaces.setSpaceDefaultTemplate('second', uuid);
      // The publish named 'second' — the held follow is carrying it.
      await vi.waitFor(() =>
        expect(stores.spaces.mySpaces().find((s) => s.uuid === uuid)?.defaultTemplateId).toBe('second'),
      );
      await vi.waitFor(() => expect(preference).toHaveBeenCalled());
      await expect(saving).rejects.toThrow('disk full');
      // The rollback republished 'first', and its follow is free to paint it.
      await vi.waitFor(() =>
        expect(stores.spaces.mySpaces().find((s) => s.uuid === uuid)?.defaultTemplateId).toBe('first'),
      );
      // The rollback's own repaint has happened before the older read is let go.
      await vi.waitFor(() => expect(app.templates.repaints.length).toBeGreaterThan(paintsBefore));
      expect(app.templates.repaints.at(-1)).toBe('first');

      release();
      // The held follow's answer must not land: the screen keeps the stored default.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(app.templates.shown().id).toBe('first');
      expect(app.templates.repaints.at(-1)).toBe('first');
    } finally {
      preference.mockRestore();
      update.mockRestore();
    }
  }, 10000);

  /*
    Two default saves for one field are one choice, the newer. The older landing while the newer is
    still out must not show its value, and the store must take the newer write last whatever order
    the backend would have finished them in.
  */
  describe('two default saves for one field', () => {
    async function twoSaves(store = true) {
      const stores = mountShell();
      await ready(stores);
      await stores.spaces.createSpace('Defaults', '', 'personal', 'hidden');
      const ref = (await lifecycle.list()).find((d) => d.name === 'Defaults')!;
      const uuid = ref.id;
      await stores.datasets.switchDataset(uuid);
      await vi.waitFor(() => expect(stores.spaces.currentSpace()?.uuid).toBe(uuid));
      await stores.spaces.setSpaceDefaultTheme('retro', uuid);
      // Each store write is held until released, so the test decides how they finish.
      const writes: { value: unknown; released: boolean; release: () => void }[] = [];
      const Entity = getEntity('Space') as unknown as { update: (...a: unknown[]) => Promise<unknown> };
      const update = Entity.update.bind(Entity);
      const spy = vi.spyOn(Entity, 'update').mockImplementation(async (...args: unknown[]) => {
        await new Promise<void>((resolve) => {
          const write = {
            value: args[2],
            released: false,
            release: () => {
              write.released = true;
              resolve();
            },
          };
          writes.push(write);
        });
        // Not stored where only the screen is under test: the live record would show a landed write too.
        return store ? update(...args) : undefined;
      });
      return { stores, ref, uuid, writes, spy };
    }

    it('does not show the older save’s value while the newer is pending', async () => {
      const { stores, uuid, writes, spy } = await twoSaves(false);
      try {
        const first = stores.spaces.setSpaceDefaultTheme('neon', uuid);
        const second = stores.spaces.setSpaceDefaultTheme('moss', uuid);
        await vi.waitFor(() => expect(writes.length).toBeGreaterThan(0));
        writes[0].release();
        await first;
        expect(stores.spaces.mySpaces().find((s) => s.uuid === uuid)?.defaultThemeId).toBe('moss');
        expect(stores.spaces.spaceDefaultThemeId()).toBe('moss');
        await vi.waitFor(() => expect(writes).toHaveLength(2));
        writes[1].release();
        await second;
        expect(stores.spaces.spaceDefaultThemeId()).toBe('moss');
      } finally {
        writes.forEach((w) => w.release());
        spy.mockRestore();
      }
    }, 10000);

    it('keeps the newer pending choice shown when the live record delivers the older one that landed', async () => {
      const { stores, ref, uuid, writes, spy } = await twoSaves();
      try {
        const first = stores.spaces.setSpaceDefaultTheme('neon', uuid);
        const second = stores.spaces.setSpaceDefaultTheme('moss', uuid);
        await vi.waitFor(() => expect(writes).toHaveLength(1));
        writes[0].release();
        await first;
        // The older choice is really stored now, and the live read is free to deliver it.
        await vi.waitFor(async () =>
          expect((await Space.findAll(ref.handle as never))[0]?.defaultThemeId).toBe('neon'),
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(stores.spaces.currentSpace()?.defaultThemeId).toBe('moss');
        expect(stores.spaces.mySpaces().find((s) => s.uuid === uuid)?.defaultThemeId).toBe('moss');
        await vi.waitFor(() => expect(writes).toHaveLength(2));
        writes[1].release();
        await second;
        await vi.waitFor(() => expect(stores.spaces.currentSpace()?.defaultThemeId).toBe('moss'));
      } finally {
        writes.forEach((w) => w.release());
        spy.mockRestore();
      }
    }, 10000);

    it('stores the newer choice last even when the backend would finish the older one last', async () => {
      const { stores, ref, uuid, writes, spy } = await twoSaves();
      // Fulfilment and rejection are both watched from here, so a failed write is reported as that.
      let outcome: { error?: unknown } | undefined;
      try {
        const saving = Promise.all([
          stores.spaces.setSpaceDefaultTheme('neon', uuid),
          stores.spaces.setSpaceDefaultTheme('moss', uuid),
        ]).then(
          () => ({}),
          (error: unknown) => ({ error }),
        );
        void saving.then((result) => (outcome = result));
        // Released newest first: whatever is out is let finish in reverse order of asking.
        await vi.waitFor(() => expect(writes.length).toBeGreaterThan(0));
        for (let attempt = 0; attempt < 200 && !outcome; attempt++) {
          writes
            .filter((w) => !w.released)
            .at(-1)
            ?.release();
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        writes.forEach((w) => w.release());
        spy.mockRestore();
      }
      expect(outcome).toEqual({});
      const [stored] = await Space.findAll(ref.handle as never);
      expect(stored?.defaultThemeId).toBe('moss');
    }, 10000);
  });

  it('does not take back a later choice that landed when an earlier save fails', async () => {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Defaults', '', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Defaults')!;
    const uuid = ref.id;
    await stores.datasets.switchDataset(uuid);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.uuid).toBe(uuid));
    await stores.spaces.setSpaceDefaultTheme('retro', uuid);

    // The first save is held at the store write; the second's write goes out after it and lands.
    let fail!: () => void;
    const held = new Promise<void>((_resolve, reject) => (fail = () => reject(new Error('disk full'))));
    const Entity = getEntity('Space') as unknown as {
      update: (handle: unknown, id: string, fields: unknown) => Promise<unknown>;
    };
    const update = vi.spyOn(Entity, 'update').mockImplementationOnce(async () => {
      await held;
    });
    try {
      const earlier = stores.spaces.setSpaceDefaultTheme('neon', uuid);
      await vi.waitFor(() => expect(stores.spaces.spaceDefaultThemeId()).toBe('neon'));
      const later = stores.spaces.setSpaceDefaultTheme('jade', uuid);
      fail();
      await expect(earlier).rejects.toThrow('disk full');
      await later;
    } finally {
      update.mockRestore();
    }

    // 'neon' never persisted: what stands is the choice that did — not 'retro', and not 'neon'.
    expect(stores.spaces.spaceDefaultThemeId()).toBe('jade');
    expect(stores.spaces.mySpaces().find((s) => s.uuid === uuid)?.defaultThemeId).toBe('jade');
    const [stored] = await Space.findAll(ref.handle as never);
    expect(stored?.defaultThemeId).toBe('jade');
  }, 10000);

  /*
    What a failed save puts back is what the record last took, not what the screen happened to
    show: two saves out at once paint two optimistic values, and the earlier one's "previous" is
    the later one's paint — a value nothing ever stored.
  */
  it('restores the last stored default, not an earlier save’s paint, when overlapping saves fail', async () => {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Overlapping', '', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Overlapping')!;
    const uuid = ref.id;
    await stores.datasets.switchDataset(uuid);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.uuid).toBe(uuid));
    await stores.spaces.setSpaceDefaultTheme('retro', uuid);

    // Saves held at the store write, one at a time: 'neon' first, then 'jade' over it.
    const releases: { resolve: () => void; reject: (e: Error) => void }[] = [];
    const update = vi
      .spyOn(getEntity('Space') as unknown as { update: (...a: unknown[]) => Promise<unknown> }, 'update')
      .mockImplementation(() => new Promise<void>((resolve, reject) => releases.push({ resolve, reject })));
    try {
      const neon = stores.spaces.setSpaceDefaultTheme('neon', uuid);
      const jade = stores.spaces.setSpaceDefaultTheme('jade', uuid);
      await vi.waitFor(() => expect(releases).toHaveLength(1));

      // The older save failing while the newer is out leaves the newer's choice alone.
      releases[0].reject(new Error('disk full'));
      await expect(neon).rejects.toThrow('disk full');
      expect(stores.spaces.spaceDefaultThemeId()).toBe('jade');

      // The newer one failing — its write goes out once the older has finished — puts back what
      // the record last took: 'retro' — never 'neon'.
      await vi.waitFor(() => expect(releases).toHaveLength(2));
      releases[1].reject(new Error('disk full'));
      await expect(jade).rejects.toThrow('disk full');
    } finally {
      update.mockRestore();
    }

    expect(stores.spaces.spaceDefaultThemeId()).toBe('retro');
    expect(stores.spaces.mySpaces().find((s) => s.uuid === uuid)?.defaultThemeId).toBe('retro');
    const [stored] = await Space.findAll(ref.handle as never);
    expect(stored?.defaultThemeId).toBe('retro');
  }, 10000);

  /*
    Two saves of the same value cannot be told apart by what the screen shows — an earlier one
    failing must not take back the later one that stored it.
  */
  it('leaves the same value standing when an earlier save of it fails after a later one landed', async () => {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Same Value', '', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Same Value')!;
    const uuid = ref.id;
    await stores.datasets.switchDataset(uuid);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.uuid).toBe(uuid));
    await stores.spaces.setSpaceDefaultTheme('retro', uuid);

    let fail!: () => void;
    const held = new Promise<void>((_resolve, reject) => (fail = () => reject(new Error('disk full'))));
    const update = vi
      .spyOn(getEntity('Space') as unknown as { update: (...a: unknown[]) => Promise<unknown> }, 'update')
      .mockImplementationOnce(async () => {
        await held;
      });
    try {
      const earlier = stores.spaces.setSpaceDefaultTheme('neon', uuid);
      await vi.waitFor(() => expect(stores.spaces.spaceDefaultThemeId()).toBe('neon'));
      // The same choice, saved again — its write goes out once the first has finished.
      const later = stores.spaces.setSpaceDefaultTheme('neon', uuid);
      fail();
      await expect(earlier).rejects.toThrow('disk full');
      await later;
    } finally {
      update.mockRestore();
    }

    expect(stores.spaces.spaceDefaultThemeId()).toBe('neon');
    const [stored] = await Space.findAll(ref.handle as never);
    expect(stored?.defaultThemeId).toBe('neon');
  }, 10000);

  it('does not touch the screen when a save fails while a newer save of the same value is out', async () => {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Still Out', '', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === 'Still Out')!;
    const uuid = ref.id;
    await stores.datasets.switchDataset(uuid);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.uuid).toBe(uuid));
    await stores.spaces.setSpaceDefaultTheme('retro', uuid);

    const releases: { resolve: () => void; reject: (e: Error) => void }[] = [];
    const Entity = getEntity('Space') as unknown as { update: (...a: unknown[]) => Promise<unknown> };
    const realUpdate = Entity.update.bind(Entity);
    const update = vi.spyOn(Entity, 'update').mockImplementation(
      (...args) =>
        new Promise<void>((resolve, reject) =>
          // Resolving writes for real — what a save that lands does — so the end state is the
          // stored value too, not only the paint.
          releases.push({ resolve: () => void realUpdate(...args).then(() => resolve(), reject), reject }),
        ),
    );
    try {
      const earlier = stores.spaces.setSpaceDefaultTheme('neon', uuid);
      const later = stores.spaces.setSpaceDefaultTheme('neon', uuid);
      await vi.waitFor(() => expect(releases).toHaveLength(1));

      // 'neon' is what the screen was asked for and what the pending save will store: the earlier
      // save's failure has nothing to take back. The pending save's write goes out after it.
      releases[0].reject(new Error('disk full'));
      await expect(earlier).rejects.toThrow('disk full');
      expect(stores.spaces.spaceDefaultThemeId()).toBe('neon');

      await vi.waitFor(() => expect(releases).toHaveLength(2));
      releases[1].resolve();
      await later;
    } finally {
      update.mockRestore();
    }

    expect(stores.spaces.spaceDefaultThemeId()).toBe('neon');
    const [stored] = await Space.findAll(ref.handle as never);
    expect(stored?.defaultThemeId).toBe('neon');
  }, 10000);

  /*
    The write is not the only thing that can fail after the publish: the row read before it can
    reject, and there can be no row at all. Both were silent successes — the painted choice simply
    stayed, with nothing said.
  */
  it('says so, and takes the publish back, when the record for a default save cannot be read', async () => {
    const stores = mountShell();
    await ready(stores);
    // An unheld space, as one that synced in after boot: the save's row read goes to the store.
    const ref = await lifecycle.create('Unread Space');
    await Space.create(ref.handle as never, { name: 'Unread Space', uuid: ref.id, defaultThemeId: 'retro' } as never);
    await vi.waitFor(() => expect(stores.datasets.datasets().map((d) => d.id)).toContain(ref.id));
    expect(stores.spaces.mySpaces().some((s) => s.uuid === ref.id)).toBe(false);

    const refused = vi.spyOn(toastService, 'error');
    const read = vi
      .spyOn(getEntity('Space') as unknown as { findAll: (...a: unknown[]) => Promise<unknown[]> }, 'findAll')
      .mockRejectedValue(new Error('read gone'));
    try {
      await expect(stores.spaces.setSpaceDefaultTheme('neon', ref.id)).rejects.toThrow('read gone');
      // Reported the way a failed write is — the publish had already painted the choice.
      expect(refused).toHaveBeenCalledWith('Could not save this change for the space.');
    } finally {
      read.mockRestore();
      refused.mockRestore();
    }

    const [stored] = await Space.findAll(ref.handle as never);
    expect(stored?.defaultThemeId).toBe('retro');
  }, 10000);

  it('rejects rather than reporting a save on a space that has no record', async () => {
    const stores = mountShell();
    await ready(stores);
    const ref = await lifecycle.create('No Record');
    await vi.waitFor(() => expect(stores.datasets.datasets().map((d) => d.id)).toContain(ref.id));

    const refused = vi.spyOn(toastService, 'error');
    try {
      await expect(stores.spaces.setSpaceDefaultTheme('neon', ref.id)).rejects.toThrow('no space record');
      expect(refused).toHaveBeenCalledWith('Could not save this change for the space.');
    } finally {
      refused.mockRestore();
    }
  }, 10000);

  /*
    The same for a module's setting rows, which are rebuilt on every write: pressing one switch on a
    settings screen redrew every row under it and threw the page's scroll.
  */
  it('keeps a module setting’s row the same object when it changes', async () => {
    moduleRegistry.register(
      {
        manifest: { id: 'rowtest', name: 'Row test' },
        contributes: { settings: [{ key: 'loud', label: 'Loud', type: 'boolean', default: true, levels: ['agent'] }] },
      },
      { backend: 'ad4m', framework: 'solid' },
    );
    try {
      const stores = mountShell();
      await ready(stores);
      const rowOf = () => stores.spaces.agentModuleSettings().find((r) => r.id === 'rowtest.loud');
      const before = rowOf();
      expect(before?.value).toBe(true);

      await stores.spaces.setAgentModuleSetting('rowtest', 'loud', false);

      await vi.waitFor(() => expect(rowOf()?.value).toBe(false));
      expect(rowOf()).toBe(before);
    } finally {
      moduleRegistry.unregister('rowtest');
    }
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

describe('following a space from the rows its live queries push', () => {
  /*
    A live query delivers the records it watches every time they change. Each of these used to treat
    the push only as "something changed" and read the same records again with `findAll` — a second
    round trip to the executor for an answer already in hand, on every write anybody made. The store
    must update from the pushed rows, so a peer's write costs nothing beyond the push.
  */
  type FindAllSpy = ReturnType<typeof vi.spyOn>;
  const spyFindAll = (entity: string): FindAllSpy =>
    vi.spyOn(getEntity(entity) as unknown as { findAll: (...a: unknown[]) => Promise<unknown[]> }, 'findAll');

  /** Opens a new space. `beforeEntering` runs once the backend's entities exist, before the space opens. */
  async function openSpace(name: string, beforeEntering?: () => void) {
    const stores = mountShell();
    await ready(stores);
    beforeEntering?.();
    await stores.spaces.createSpace(name, 'x', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === name)!;
    await stores.datasets.switchDataset(ref.id);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.name).toBe(name));
    await vi.waitFor(() => expect(stores.spaces.root()).not.toBe(''));
    await vi.waitFor(() => expect(stores.spaces.taskStatesLoaded()).toBe(true));
    await vi.waitFor(() => expect(stores.spaces.policy().loaded).toBe(true));
    return { stores, handle: ref.handle as never, spaceId: stores.spaces.currentSpace()!.id };
  }

  it('hears a new landmark without reading the landmarks again', async () => {
    const { stores, handle, spaceId } = await openSpace('Pushed Landmarks');
    const reads = spyFindAll('SpaceLandmark');
    const board = await CollectionBlock.create(handle, { kind: 'board', title: 'Board' } as never);
    await writeSpaceLandmark(handle, spaceId, 'board', board.id);
    await vi.waitFor(() => expect(stores.spaces.landmarks().board).toBe(board.id));
    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();
  }, 10000);

  it('hears a new task state without reading the states again', async () => {
    const { stores, handle } = await openSpace('Pushed States');
    const reads = spyFindAll('TaskState');
    await getEntity('TaskState').create(handle, { name: 'Blocked', slug: 'blocked', semantic: 'blocked' } as never);
    await vi.waitFor(() => expect(stores.spaces.taskStates().map((s) => s.slug)).toContain('blocked'));
    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();
  }, 10000);

  it('takes the task-state order from the space record it follows, reading the space no more for it', async () => {
    /*
      A recorded cold open read the open space's record a fourth time, `include: { taskStates }`, for
      the order of its states — a record the live query had just delivered. The live query carries
      the order now, so neither opening the space nor a reorder reads the record for it.
    */
    let spaceReads: ReturnType<typeof vi.spyOn> | undefined;
    const { stores, handle } = await openSpace('Pushed Order', () => {
      spaceReads = vi.spyOn(getEntity('Space') as unknown as { findOne: (...a: unknown[]) => unknown }, 'findOne');
    });
    for (const slug of ['todo', 'doing', 'done'])
      await getEntity('TaskState').create(handle, { name: slug, slug, semantic: slug } as never);
    await vi.waitFor(() => expect(stores.spaces.taskStates().length).toBeGreaterThanOrEqual(3));
    const orderReads = () =>
      spaceReads!.mock.calls.filter((call: unknown[]) =>
        Boolean((call[1] as { include?: { taskStates?: unknown } } | undefined)?.include?.taskStates),
      );
    const slugs = stores.spaces.taskStates().map((s) => s.slug);
    expect(slugs.length).toBeGreaterThan(1);
    expect(orderReads()).toEqual([]);

    const reversed = [...slugs].reverse();
    await stores.spaces.reorderTaskStates(reversed);
    await vi.waitFor(() => expect(stores.spaces.taskStates().map((s) => s.slug)).toEqual(reversed));
    expect(orderReads()).toEqual([]);
    spaceReads!.mockRestore();
  }, 10000);

  it('hears a new role and a new grant without reading either again', async () => {
    const { stores, handle } = await openSpace('Pushed Roles');
    await vi.waitFor(() => expect(stores.spaces.roles().length).toBeGreaterThan(0));
    const roleReads = spyFindAll('Role');
    const grantReads = spyFindAll('RoleGrant');
    await getEntity('Role').create(handle, { slug: 'steward', name: 'Steward' } as never);
    await getEntity('RoleGrant').create(handle, { role: 'steward', agent: 'did:key:steward' } as never);
    await vi.waitFor(() =>
      expect(stores.spaces.roles().find((r) => r.slug === 'steward')?.holders).toEqual(['did:key:steward']),
    );
    expect(roleReads).not.toHaveBeenCalled();
    expect(grantReads).not.toHaveBeenCalled();
    roleReads.mockRestore();
    grantReads.mockRestore();
  }, 10000);

  it('hears a new version of the policy without reading the versions again', async () => {
    const { stores, handle } = await openSpace('Pushed Policy');
    expect(stores.spaces.policy().preset).not.toBe('community');
    const reads = spyFindAll('Policy');
    await Policy.create(handle, { document: JSON.stringify(COMMUNITY_POLICY) } as never);
    await vi.waitFor(() => expect(stores.spaces.policy().preset).toBe('community'));
    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();
  }, 10000);

  it('hears a collection switched off without reading it again, and never hydrates its contents', async () => {
    // The space's own collection is asked about on entering, so watch from before that.
    let asked!: ReturnType<typeof vi.spyOn>;
    let reads!: FindAllSpy;
    const isSettingsRead = (call: unknown[]) =>
      Array.isArray((call[1] as { where?: { id?: unknown } } | undefined)?.where?.id);
    const { stores, handle } = await openSpace('Pushed Interpretation', () => {
      asked = vi.spyOn(getEntity('CollectionBlock') as unknown as { query: (...a: unknown[]) => unknown }, 'query');
      reads = spyFindAll('CollectionBlock');
    });
    const root = stores.spaces.root();
    // Ask, and wait for the first answer and the watch behind it.
    stores.spaces.autoInterpretFor(root);
    await vi.waitFor(() => expect(asked.mock.calls.some(isSettingsRead)).toBe(true));
    const before = stores.spaces.autoInterpretFor(root);
    // Only the two fields the settings are made of: a collection's children are the whole space.
    for (const call of [...reads.mock.calls, ...asked.mock.calls].filter(isSettingsRead)) {
      expect((call[1] as { properties?: string[] }).properties).toEqual(['autoExtract', 'extractionTargets']);
    }
    const settingsReads = () => reads.mock.calls.filter(isSettingsRead).length;
    const readsBefore = settingsReads();

    await CollectionBlock.update(handle, root, { autoExtract: !before } as never);
    await vi.waitFor(() => expect(stores.spaces.autoInterpretFor(root)).toBe(!before));
    expect(settingsReads()).toBe(readsBefore);
    reads.mockRestore();
    asked.mockRestore();
  }, 10000);

  it('hears the space’s presentation of a type without reading the space or its types again', async () => {
    const { stores, handle, spaceId } = await openSpace('Pushed Presentation');
    const summary = () => stores.records.displays().TaskBlock?.fields.find((f) => f.role === 'summary')?.name;
    expect(summary()).toBe('description');
    const styleReads = spyFindAll('TypeStyle');
    const spaceReads = vi.spyOn(getEntity('Space') as unknown as { findOne: (...a: unknown[]) => unknown }, 'findOne');
    await getEntity('TypeStyle').create(
      handle,
      { nodeType: 'TaskBlock', display: JSON.stringify({ summary: 'assignee' }) } as never,
      { parent: { id: spaceId, relation: 'typeStyles', entity: 'Space' } } as never,
    );
    await vi.waitFor(() => expect(summary()).toBe('assignee'));
    expect(styleReads).not.toHaveBeenCalled();
    // The presentation's own read of the space asks for it bare; other stores ask for it by a `where`.
    expect(spaceReads.mock.calls.filter((call) => call[1] === undefined)).toEqual([]);
    styleReads.mockRestore();
    spaceReads.mockRestore();
  }, 10000);
});

describe('entering a space: its collection and its landmarks', () => {
  /*
    The Feed waits for `root`: until it is known the template cannot tell that `?channel=<root>` is
    the Feed. Entering a space read the Space record again to learn its collection — though the space
    list had read that record already, and a row read without an include carries the collection's id
    — and only then read the landmarks, one after the other. On a busy executor that was 1.9 s and
    then 0.85 s, end to end before the Feed could start.
  */
  type Held<T> = { release: () => void; promise: Promise<T> };
  /** Holds every call to `entity.method` until released, passing it on to the real one then. */
  function hold(entity: string, method: 'findAll' | 'findOne') {
    const target = getEntity(entity) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const real = target[method].bind(target);
    const held: Held<unknown>[] = [];
    let open = false;
    const spy = vi.spyOn(target, method).mockImplementation((...args: unknown[]) => {
      if (open) return real(...args);
      let release!: () => void;
      const promise = new Promise<void>((resolve) => (release = resolve)).then(() => real(...args));
      held.push({ release, promise });
      return promise;
    });
    return {
      spy,
      release: () => {
        open = true;
        for (const h of held.splice(0)) h.release();
      },
    };
  }
  const isRootRead = (call: unknown[]) =>
    Boolean((call[1] as { include?: { root?: unknown } } | undefined)?.include?.root);

  /** A space made and listed, not yet entered — the shape a boot is in when it navigates. */
  async function listedSpace(name: string) {
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace(name, 'x', 'personal', 'hidden');
    const ref = (await lifecycle.list()).find((d) => d.name === name)!;
    return { stores, ref };
  }

  it('takes the collection from the space row it already has, reading no Space for it', async () => {
    const { stores, ref } = await listedSpace('Row Root');
    // What the list holds for this space carries its collection.
    const row = stores.spaces.mySpaces().find((s) => s.name === 'Row Root') as unknown as { root?: unknown };
    expect(row?.root).toBeTruthy();
    const spaceReads = vi.spyOn(getEntity('Space') as unknown as { findOne: (...a: unknown[]) => unknown }, 'findOne');

    await stores.datasets.switchDataset(ref.id);
    await vi.waitFor(() => expect(stores.spaces.root()).not.toBe(''));

    expect(spaceReads.mock.calls.filter(isRootRead)).toEqual([]);
    spaceReads.mockRestore();
  }, 10000);

  it('sets the collection without waiting for the landmarks, which say for themselves when they have answered', async () => {
    const { stores, ref } = await listedSpace('Parallel Structure');
    const [space] = await Space.findAll(ref.handle as never);
    const board = await CollectionBlock.create(ref.handle as never, { kind: 'board', title: 'Board' } as never);
    await writeSpaceLandmark(ref.handle as never, space.id, 'board', board.id);
    const landmarks = hold('SpaceLandmark', 'findAll');

    await stores.datasets.switchDataset(ref.id);
    await vi.waitFor(() => expect(landmarks.spy).toHaveBeenCalled());
    // The landmarks are still out, and the collection is known regardless.
    await vi.waitFor(() => expect(stores.spaces.root()).not.toBe(''));
    expect(stores.spaces.landmarksLoaded()).toBe(false);

    landmarks.release();
    await vi.waitFor(() => expect(stores.spaces.landmarksLoaded()).toBe(true));
    expect(stores.spaces.landmarks().board).toBe(board.id);
    landmarks.spy.mockRestore();
  }, 10000);

  it('says the collection is not known yet until it has answered, so a template does not guess', async () => {
    // A template compares the address with `root`; an empty `root` it cannot tell from "not read yet".
    const { stores, ref } = await listedSpace('Root Gate');
    const spaceRow = stores.spaces.mySpaces().find((s) => s.name === 'Root Gate') as unknown as { root?: unknown };
    const carried = spaceRow.root;
    spaceRow.root = undefined;
    const spaceReads = hold('Space', 'findOne');

    await stores.datasets.switchDataset(ref.id);
    await vi.waitFor(() => expect(spaceReads.spy.mock.calls.some(isRootRead)).toBe(true));
    expect(stores.spaces.root()).toBe('');
    expect(stores.spaces.rootLoaded()).toBe(false);

    spaceReads.release();
    await vi.waitFor(() => expect(stores.spaces.rootLoaded()).toBe(true));
    expect(stores.spaces.root()).not.toBe('');
    spaceRow.root = carried;
    spaceReads.spy.mockRestore();
  }, 10000);

  it('asks for the collection and the landmarks at once when it has to read the collection', async () => {
    // A space whose row did not carry its collection — read in the moment before it was written.
    const { stores, ref } = await listedSpace('Both At Once');
    const spaceRow = stores.spaces.mySpaces().find((s) => s.name === 'Both At Once') as unknown as {
      root?: unknown;
    };
    const carried = spaceRow.root;
    spaceRow.root = undefined;
    const spaceReads = hold('Space', 'findOne');
    const landmarks = hold('SpaceLandmark', 'findAll');

    await stores.datasets.switchDataset(ref.id);
    // Both issued while neither has answered.
    await vi.waitFor(() => expect(spaceReads.spy.mock.calls.some(isRootRead)).toBe(true));
    await vi.waitFor(() => expect(landmarks.spy).toHaveBeenCalled());

    spaceReads.release();
    landmarks.release();
    await vi.waitFor(() => expect(stores.spaces.root()).not.toBe(''));
    await vi.waitFor(() => expect(stores.spaces.landmarksLoaded()).toBe(true));
    spaceRow.root = carried;
    spaceReads.spy.mockRestore();
    landmarks.spy.mockRestore();
  }, 10000);

  it('never says "no board" before the landmarks have answered', async () => {
    /*
      A template asks "is there a board?" by `landmarksLoaded && !landmarks.board`. Root used to be
      that signal, set after the landmarks; now it arrives first, so the frames are watched for a
      moment that says loaded without the board.
    */
    const { stores, ref } = await listedSpace('Board Gate');
    const [space] = await Space.findAll(ref.handle as never);
    const board = await CollectionBlock.create(ref.handle as never, { kind: 'board', title: 'Board' } as never);
    await writeSpaceLandmark(ref.handle as never, space.id, 'board', board.id);
    const frames: { loaded: boolean; board: string | undefined }[] = [];
    const stop = createRoot((dispose) => {
      createEffect(() =>
        frames.push({ loaded: stores.spaces.landmarksLoaded(), board: stores.spaces.landmarks().board }),
      );
      return dispose;
    });

    await stores.datasets.switchDataset(ref.id);
    await vi.waitFor(() => expect(stores.spaces.landmarks().board).toBe(board.id));
    stop();

    expect(frames.some((f) => f.loaded)).toBe(true);
    expect(frames.filter((f) => f.loaded && f.board !== board.id)).toEqual([]);
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

// ── Interpretation settings, on the collection ───────────────────────────────

describe('what a collection interprets', () => {
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
    const registrations: { dataset: unknown; watchId: string; classes: string[] }[] = [];

    onPorts = (ports) => {
      (ports as unknown as { interpretation: unknown }).interpretation = {
        watch: async (dataset: unknown, args: { watchId: string; classes: string[] }) => {
          watched.push(args.watchId);
          registrations.push({ dataset, watchId: args.watchId, classes: [...args.classes] });
        },
        unwatch: async (_dataset: unknown, watchId: string) => {
          removed.push(watchId);
        },
      };
    };
    return { watched, removed, registrations };
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
    await stores.spaces.setAutoInterpretFor(root, false);
    expect((await stored(handle, root)).autoExtract).toBe(false);
    await vi.waitFor(() => expect(port.removed).toContain(watchId(root)));
    expect(stores.spaces.autoInterpretFor(root)).toBe(false);
    // The space's default — what the next collection starts with — is untouched.
    expect(stores.spaces.autoInterpret()).toBe(true);

    // And back on.
    port.watched.length = 0;
    await stores.spaces.setAutoInterpretFor(root, true);
    await vi.waitFor(() => expect(port.watched).toContain(watchId(root)));
  }, 15000);

  it('registers the space collection’s watch once, with the whole list, when the space’s classes arrive late', async () => {
    // The trace this pins: the watch registered from the list as it stood a moment after the switch —
    // without the classes the space already had — and then again when they arrived. Each time the
    // stored registration differed from a partial list, so the host removed it and added it back.
    const registrations: { watchId: string; classes: string[] }[] = [];
    const removed: string[] = [];
    let release: (() => void) | undefined;
    let hold = false;
    onPorts = (ports) => {
      const read = ports.schemas.foreignSchemas.bind(ports.schemas);
      ports.schemas.foreignSchemas = async (dataset) => {
        if (!hold) return read(dataset);
        await new Promise<void>((resolve) => (release = resolve));
        return [
          {
            name: 'Sighting',
            targetClass: 'test://Sighting',
            properties: [],
            interpretationHint: 'something somebody saw',
          },
        ];
      };
      (ports as unknown as { interpretation: unknown }).interpretation = {
        watch: async (_dataset: unknown, args: { watchId: string; classes: string[] }) => {
          registrations.push({ watchId: args.watchId, classes: [...args.classes] });
        },
        unwatch: async (_dataset: unknown, id: string) => {
          removed.push(id);
        },
      };
    };
    const stores = mountShell();
    await ready(stores);
    hold = true;
    await enterSpace(stores, 'Late');
    const root = stores.spaces.root();
    const mine = () => registrations.filter((r) => r.watchId === watchId(root));

    // Wanted, and not registered: what the space can extract is still being read.
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(stores.spaces.autoInterpretFor(root)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mine()).toEqual([]);
    expect(stores.shapes.interpretationCandidatesLoaded()).toBe(false);

    release!();
    await vi.waitFor(() => expect(mine()).toHaveLength(1));
    // The list as decided once everything was read — the space's class is now a candidate, and this
    // collection's own list (copied from the defaults when it was made) chooses from that.
    expect(stores.shapes.interpretationCandidates()).toContain('Sighting');
    const decided = kernel()
      .targets(root)
      .filter((t) => t.selected)
      .map((t) => t.entity);
    expect([...mine()[0].classes].sort()).toEqual([...decided].sort());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mine()).toHaveLength(1);
    expect(removed).not.toContain(watchId(root));

    // Off still stops it.
    await stores.spaces.setAutoInterpretFor(root, false);
    await vi.waitFor(() => expect(removed).toContain(watchId(root)));
  }, 15000);

  it('shows a call’s picker the core classes while the space’s own are read, and says the list is not whole yet', async () => {
    // The reader side of the wait above. Only the registrars wait for the whole list: the picker,
    // its chips and the Interpret button read the list as it arrives, so the panel never says there is
    // nothing to extract for the few round trips before the space's own classes come.
    let release: (() => void) | undefined;
    let hold = false;
    onPorts = (ports) => {
      const read = ports.schemas.foreignSchemas.bind(ports.schemas);
      ports.schemas.foreignSchemas = async (dataset) => {
        if (!hold) return read(dataset);
        await new Promise<void>((resolve) => (release = resolve));
        return [
          { name: 'Sighting', targetClass: 'test://Sighting', properties: [], interpretationHint: 'something seen' },
        ];
      };
    };
    const stores = mountShell();
    await ready(stores);
    hold = true;
    await enterSpace(stores, 'Partial');
    const root = stores.spaces.root();
    const interpretation = kernel();
    await vi.waitFor(() => expect(release).toBeDefined());

    // Still loading: the core classes, already, and not yet whole.
    const partial = interpretation.targets(root).map((t) => t.entity);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial).not.toContain('Sighting');
    expect(interpretation.targetsLoaded?.()).toBe(false);

    release!();
    await vi.waitFor(() => expect(interpretation.targetsLoaded?.()).toBe(true));
    const whole = interpretation.targets(root).map((t) => t.entity);
    expect(whole).toContain('Sighting');
    for (const entity of partial) expect(whole).toContain(entity);
  }, 15000);

  /*
    What a list of the space's DNA reads to list another app's classes, as a template expression: the
    classes by name, so a flat list of them is in order, and WE's plumbing, the one thing a template
    cannot name for itself. Each of those classes is drawn by the generic display; the plumbing is not.
  */
  it("publishes another app's classes by name, and WE's plumbing for a list of the space's DNA to leave out", async () => {
    onPorts = (ports) => {
      ports.schemas.foreignSchemas = async () => [
        { name: 'Question', targetClass: 'conv://Question', properties: [] },
        { name: 'Space', targetClass: 'old://Space', properties: [] },
        { name: 'Channel', targetClass: 'flux://Channel', properties: [] },
      ];
    };
    const stores = mountShell();
    await ready(stores);
    await enterSpace(stores, 'Classes');
    await vi.waitFor(() => expect(stores.datasets.currentDatasetEntitiesLoaded()).toBe(true));

    expect(stores.datasets.currentDatasetEntities().map((e) => e.name)).toEqual(['Channel', 'Question', 'Space']);
    expect(stores.records.plumbingClasses()).toEqual(expect.arrayContaining(['Space', 'SignalType', 'Placement']));
    expect(stores.records.displays().Question).toMatchObject({ label: 'Question', icon: 'cube' });
    expect(stores.records.displays().Space).toBeUndefined();
  }, 15000);

  it('removes the space collection’s watch when extraction is switched off before this visit registers it', async () => {
    // The watch is one row in the shared graph, so it can be there from an earlier visit while this
    // visit waits for the class list. Switched off in that wait, it must still be removed.
    const registered: string[] = [];
    const removed: string[] = [];
    let release: (() => void) | undefined;
    let hold = false;
    onPorts = (ports) => {
      const read = ports.schemas.foreignSchemas.bind(ports.schemas);
      ports.schemas.foreignSchemas = async (dataset) => {
        if (hold) await new Promise<void>((resolve) => (release = resolve));
        return read(dataset);
      };
      (ports as unknown as { interpretation: unknown }).interpretation = {
        watch: async (_dataset: unknown, args: { watchId: string }) => {
          registered.push(args.watchId);
        },
        unwatch: async (_dataset: unknown, id: string) => {
          removed.push(id);
        },
      };
    };
    const stores = mountShell();
    await ready(stores);
    hold = true;
    await enterSpace(stores, 'Earlier');
    const root = stores.spaces.root();
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(stores.spaces.autoInterpretFor(root)).toBe(true);
    expect(stores.shapes.interpretationCandidatesLoaded()).toBe(false);

    await stores.spaces.setAutoInterpretFor(root, false);
    await vi.waitFor(() => expect(removed).toContain(watchId(root)));

    // And the list arriving afterwards registers nothing: it is off.
    release!();
    await vi.waitFor(() => expect(stores.shapes.interpretationCandidatesLoaded()).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(registered).not.toContain(watchId(root));
  }, 15000);

  /** Two spaces, and the foreign-schema reads of every later switch held until a test lets them go. */
  async function twoSpacesWithHeldReads() {
    const pending: (() => void)[] = [];
    let hold = false;
    onPorts = (ports) => {
      const read = ports.schemas.foreignSchemas.bind(ports.schemas);
      ports.schemas.foreignSchemas = async (dataset) => {
        if (hold) await new Promise<void>((resolve) => pending.push(resolve));
        return read(dataset);
      };
    };
    const stores = mountShell();
    await ready(stores);
    await stores.spaces.createSpace('Space A', 'x', 'personal', 'hidden');
    await stores.spaces.createSpace('Space B', 'x', 'personal', 'hidden');
    const refs = await lifecycle.list();
    const a = refs.find((d) => d.name === 'Space A')!.id;
    const b = refs.find((d) => d.name === 'Space B')!.id;
    const open = async (id: string) => {
      await stores.spaces.navigateToSpace(id);
      await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(id));
    };
    await open(b);
    await vi.waitFor(() => expect(stores.datasets.currentDatasetEntitiesLoaded()).toBe(true));
    hold = true;
    return { stores, a, b, open, pending };
  }

  it('says a space’s classes are not read when it is opened again before the read for it ends', async () => {
    const { stores, a, b, open, pending } = await twoSpacesWithHeldReads();
    await open(a);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0](); // A, read whole.
    await vi.waitFor(() => expect(stores.datasets.currentDatasetEntitiesLoaded()).toBe(true));

    await open(b);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    await open(a);
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    // A's earlier read finished, but this visit's has not.
    expect(stores.datasets.currentDatasetEntitiesLoaded()).toBe(false);

    pending[2]();
    await vi.waitFor(() => expect(stores.datasets.currentDatasetEntitiesLoaded()).toBe(true));
    pending[1]();
  }, 15000);

  it('does not let an older read of the same space finish the newer one', async () => {
    const { stores, a, b, open, pending } = await twoSpacesWithHeldReads();
    await open(a); // read 0 — A
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await open(b); // read 1 — B
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    await open(a); // read 2 — A again
    await vi.waitFor(() => expect(pending).toHaveLength(3));

    pending[0]();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stores.datasets.currentDatasetEntitiesLoaded()).toBe(false);

    pending[2]();
    await vi.waitFor(() => expect(stores.datasets.currentDatasetEntitiesLoaded()).toBe(true));
    pending[1]();
  }, 15000);

  it('is not ready while a newer read of the space’s models is still out', async () => {
    // Saving a model reloads the list while an earlier load can still be adopting; the earlier one
    // finishing must not say the list is whole while the newer one is out.
    const pending: (() => void)[] = [];
    let hold = false;
    onPorts = (ports) => {
      const shapes = ports.schemas.shapes!;
      const list = shapes.list.bind(shapes);
      shapes.list = async (dataset) => {
        if (hold) await new Promise<void>((resolve) => pending.push(resolve));
        return list(dataset);
      };
    };
    const stores = mountShell();
    await ready(stores);
    await enterSpace(stores, 'Reloading');
    await vi.waitFor(() => expect(stores.shapes.shapesLoaded()).toBe(true));

    hold = true;
    const first = stores.shapes.addRecordTypes('nothing', []);
    const second = stores.shapes.addRecordTypes('nothing', []);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(stores.shapes.shapesLoaded()).toBe(false);

    pending[0]();
    await first;
    expect(stores.shapes.shapesLoaded()).toBe(false);
    expect(stores.shapes.interpretationCandidatesLoaded()).toBe(false);

    pending[1]();
    await second;
    expect(stores.shapes.shapesLoaded()).toBe(true);
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

    expect(stores.spaces.canSetInterpretationFor(root)).toBe(false);
    expect(stores.spaces.canSetInterpretationFor(call.id)).toBe(true);

    const refused = vi.spyOn(toastService, 'error');
    await stores.spaces.setAutoInterpretFor(root, false);
    expect(refused).toHaveBeenCalled();
    // Refused before anything was written.
    expect((await stored(handle, root)).autoExtract).toBe(true);

    // A call is its participants' to decide.
    await stores.spaces.setAutoInterpretFor(call.id, false);
    expect((await stored(handle, call.id)).autoExtract).toBe(false);
    refused.mockRestore();
  }, 15000);

  /*
    Two switches each write the whole list, read from the copy the store is holding. Nightly V5
    turned Decision on, saw that write stored, then turned Task on and read back a list that had
    Task and not Decision: the second write had taken the list from before the first one was
    published. The executor shows a write to the test before this app has published it, and a live
    row from before the write can replace the copy, so both writes are held here and the older one
    is finished last.
  */
  it('keeps every class two overlapping extraction switches turned on, even when the older write finishes last', async () => {
    const stores = mountShell();
    await ready(stores);
    const handle = await enterSpace(stores, 'Overlapping');
    const rawBefore = (await Space.findAll(handle))[0]?.extractionTargets ?? '';
    const before = (rawBefore ? (JSON.parse(rawBefore) as string[]) : ['TaskBlock', 'EventBlock']).slice();

    const writes: { released: boolean; release: () => void }[] = [];
    const Entity = getEntity('Space') as unknown as { update: (...a: unknown[]) => Promise<unknown> };
    const update = Entity.update.bind(Entity);
    const spy = vi.spyOn(Entity, 'update').mockImplementation(async (...args: unknown[]) => {
      const fields = args[2] as { extractionTargets?: string } | undefined;
      if (!fields || !('extractionTargets' in fields)) return update(...args);
      await new Promise<void>((resolve) => {
        const write = {
          released: false,
          release: () => {
            write.released = true;
            resolve();
          },
        };
        writes.push(write);
      });
      return update(...args);
    });

    const saving = Promise.all([
      stores.spaces.setInterpretationTarget('Decision', true),
      stores.spaces.setInterpretationTarget('Task', true),
    ]).then(
      () => ({}),
      (error: unknown) => ({ error }),
    );
    try {
      await vi.waitFor(() => expect(writes.length).toBeGreaterThan(0));
      for (
        let attempt = 0;
        attempt < 200 && (await Promise.race([saving, Promise.resolve()])) === undefined;
        attempt++
      ) {
        writes
          .filter((write) => !write.released)
          .at(-1)
          ?.release();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      for (const write of writes) write.release();
      spy.mockRestore();
    }

    expect(await saving).toEqual({});
    const stored = JSON.parse((await Space.findAll(handle))[0]?.extractionTargets || '[]') as string[];
    const wanted = [...new Set([...before, 'Decision', 'Task'])];
    expect(stored).toEqual(expect.arrayContaining(wanted));
    expect(stored).toHaveLength(wanted.length);
    const shown = JSON.parse(stores.spaces.currentSpace()?.extractionTargets || '[]') as string[];
    expect(shown).toEqual(expect.arrayContaining(['Decision', 'Task']));
  }, 15000);

  it('gives a new call the defaults as they stand, and leaves a call already made with its own', async () => {
    const stores = mountShell();
    await ready(stores);
    const handle = await enterSpace(stores, 'Defaults');
    const k = kernel();

    // Made the way the host makes a new feed: the space's defaults as they stand, copied in.
    const before = await CollectionBlock.create(
      handle,
      withInterpretationDefaults(
        'CollectionBlock',
        { kind: 'call', mode: 'feed' },
        stores.spaces.currentSpace(),
      ) as never,
    );
    await vi.waitFor(() => expect(looksFor(k, before.id, 'TaskBlock')).toBe(true));

    // The community changes its defaults.
    await stores.spaces.setAutoInterpret(false);
    await stores.spaces.setInterpretationTarget('TaskBlock', false);
    await vi.waitFor(() => expect(stores.spaces.currentSpace()?.autoInterpret).toBe(false));

    const after = await CollectionBlock.create(
      handle,
      withInterpretationDefaults(
        'CollectionBlock',
        { kind: 'call', mode: 'feed' },
        stores.spaces.currentSpace(),
      ) as never,
    );

    await vi.waitFor(() => expect(stores.spaces.autoInterpretFor(before.id)).toBe(true));
    await vi.waitFor(() => expect(stores.spaces.autoInterpretFor(after.id)).toBe(false));
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
        withInterpretationDefaults(
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
    expect(stores.spaces.interpretationTargets()).toContain('TaskBlock');

    // The switch: call A off. Its watch is refused from then on; call B's is still registered.
    await interpretation.setAuto(a.id, false);
    await vi.waitFor(() => expect(stores.spaces.autoInterpretFor(a.id)).toBe(false));
    await expect(interpretation.watchCollection(a.id)).rejects.toThrow('automatic interpretation is off');
    await interpretation.watchCollection(b.id);
    expect(port.watched).toContain(watchId(b.id));
    expect(port.watched).not.toContain(watchId(a.id));
    expect(stores.spaces.autoInterpretFor(b.id)).toBe(true);
  }, 15000);

  /*
    A watch for a call in a space nobody is looking at is decided by that call's own collection —
    its switch and its class list live in its own dataset. The live reads answer for the space on
    screen: left to them, a call in another space is either refused on a switch that is not its
    own, or registered carrying the other space's classes.
  */
  it('registers a call in another space on that call’s own switch and class list', async () => {
    const port = watchPort();
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    const a = stores.datasets.currentDataset()!.id;
    // The call's own answers: watched as it grows, looking for tasks only.
    const call = await CollectionBlock.create(handleA, {
      kind: 'call',
      mode: 'feed',
      autoExtract: true,
      extractionTargets: '["TaskBlock"]',
    } as never);

    // Elsewhere's answers differ on both counts — off for the space, events for the list.
    await enterSpace(stores, 'Elsewhere');
    await stores.spaces.setAutoInterpret(false);
    await stores.spaces.setInterpretationTarget('TaskBlock', false);
    provideModuleHostServices({
      datasetByUri: (uri) => stores.datasets.datasets().find((d) => d.id === uri || d.sharedUri === uri)?.handle,
    });

    await kernel().watchCollection(call.id, { dataset: a });

    // Registered on Here's dataset, with Here's call's own list — not Elsewhere's.
    const registered = port.registrations.find((r) => r.watchId === watchId(call.id));
    expect(registered?.dataset).toBe(handleA);
    expect(registered?.classes).toEqual(['TaskBlock']);
  }, 15000);

  it('refuses a call whose own switch is off, though the space on screen’s is on', async () => {
    const port = watchPort();
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    const a = stores.datasets.currentDataset()!.id;
    const call = await CollectionBlock.create(handleA, {
      kind: 'call',
      mode: 'feed',
      autoExtract: false,
      extractionTargets: '["TaskBlock"]',
    } as never);

    await enterSpace(stores, 'Elsewhere');
    provideModuleHostServices({
      datasetByUri: (uri) => stores.datasets.datasets().find((d) => d.id === uri || d.sharedUri === uri)?.handle,
    });
    /*
      Waited on so the ask about this collection has been read — against the space on screen, which
      is the bug. From then on the live gate answers for Elsewhere: on, where Here's call is off.
      A gate that reads the live answers registers this watch instead of refusing it.
    */
    await vi.waitFor(() => expect(stores.spaces.autoInterpretFor(call.id)).toBe(true));

    await expect(kernel().watchCollection(call.id, { dataset: a })).rejects.toThrow('automatic interpretation is off');
    expect(port.registrations.some((r) => r.watchId === watchId(call.id))).toBe(false);
  }, 15000);

  /*
    A call whose record cannot be read has said nothing about automatic interpretation, which is not the
    same as saying nothing *yet to override*: the space's default must not start a watch the call's
    own stored switch may turn out to forbid, and nothing re-registers it when the record arrives.
  */
  it('refuses a call whose record cannot be read, though the space default is on', async () => {
    const port = watchPort();
    const stores = mountShell();
    await ready(stores);
    await enterSpace(stores, 'Here');
    const a = stores.datasets.currentDataset()!.id;
    await stores.spaces.setAutoInterpret(true);

    await enterSpace(stores, 'Elsewhere');
    provideModuleHostServices({
      datasetByUri: (uri) => stores.datasets.datasets().find((d) => d.id === uri || d.sharedUri === uri)?.handle,
    });

    await expect(kernel().watchCollection('call-not-yet-synced', { dataset: a })).rejects.toThrow(
      'automatic interpretation is off',
    );
    expect(port.registrations.some((r) => r.watchId === watchId('call-not-yet-synced'))).toBe(false);
  }, 15000);

  /*
    Leaving a call does not wait on the reads a start makes first, so a stop can land while its
    start is still resolving. Serialised per (dataset, watch id), the stop runs *after* the start
    it supersedes: the start registers and the stop removes it, where a stop that raced past left
    a processor registered with nothing ever coming back for it.
  */
  it('leaves nothing registered when a call’s watch is stopped while its start is still resolving', async () => {
    const events: string[] = [];
    onPorts = (ports) => {
      (ports as unknown as { interpretation: unknown }).interpretation = {
        watch: async (_dataset: unknown, args: { watchId: string }) => {
          events.push(`watch:${args.watchId}`);
        },
        unwatch: async (_dataset: unknown, id: string) => {
          events.push(`unwatch:${id}`);
        },
      };
    };
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    const a = stores.datasets.currentDataset()!.id;
    const call = await CollectionBlock.create(handleA, {
      kind: 'call',
      mode: 'feed',
      autoExtract: true,
      extractionTargets: '["TaskBlock"]',
    } as never);
    const other = await CollectionBlock.create(handleA, {
      kind: 'call',
      mode: 'feed',
      autoExtract: true,
      extractionTargets: '["TaskBlock"]',
    } as never);

    await enterSpace(stores, 'Elsewhere');
    provideModuleHostServices({
      datasetByUri: (uri) => stores.datasets.datasets().find((d) => d.id === uri || d.sharedUri === uri)?.handle,
    });

    // Hold the read a start makes of the call's own settings — the await a stop lands inside.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let holding = false;
    let answersHeld = false;
    const Collection = getEntity('CollectionBlock') as unknown as {
      findAll: (
        handle: unknown,
        q?: { where?: { id?: string[] }; properties?: readonly string[] },
      ) => Promise<unknown[]>;
    };
    const findAll = Collection.findAll.bind(Collection);
    const spy = vi.spyOn(Collection, 'findAll').mockImplementation(async (handle, q) => {
      if (holding && handle === handleA && q?.properties && q.where?.id?.includes(call.id)) {
        answersHeld = true;
        await held;
      }
      return findAll(handle, q as never);
    });
    const interpretation = kernel();
    try {
      holding = true;
      const starting = interpretation.watchCollection(call.id, { dataset: a });
      await vi.waitFor(() => expect(answersHeld).toBe(true));
      // Another collection's start is a different key: it registers without waiting on this one's.
      await interpretation.watchCollection(other.id, { dataset: a });

      // The stop, issued while the start is still resolving — what leaving the call does.
      const stopping = interpretation.unwatchCollection(call.id, { dataset: a });
      release();
      await starting;
      await stopping;
    } finally {
      spy.mockRestore();
    }

    // Started, then removed — in that order, which is the whole point: the reverse is the leak.
    // Each entered space's own loose-message watch registers on the same port, so only the events
    // naming one of these two calls are the trace.
    const these = events.filter((e) => e.endsWith(watchId(call.id)) || e.endsWith(watchId(other.id)));
    expect(these).toEqual([`watch:${watchId(other.id)}`, `watch:${watchId(call.id)}`, `unwatch:${watchId(call.id)}`]);
  }, 15000);

  /*
    A refused start is still an op on the watch's key, and its entry must not outlive it: the
    queue forgets a failed op the way it forgets a finished one, or a call whose start was once
    refused would carry a dead chain head for the rest of the session. What shows is that the key
    still works — the stop and the retry behind it run, in order.
  */
  it('runs a call’s stop and retry in order after its start was refused', async () => {
    const events: string[] = [];
    let callId = '';
    let refusing = true;
    onPorts = (ports) => {
      (ports as unknown as { interpretation: unknown }).interpretation = {
        watch: async (_dataset: unknown, args: { watchId: string }) => {
          if (refusing && args.watchId === watchId(callId)) throw new Error('the processor refused');
          events.push(`watch:${args.watchId}`);
        },
        unwatch: async (_dataset: unknown, id: string) => {
          events.push(`unwatch:${id}`);
        },
      };
    };
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    const call = await CollectionBlock.create(handleA, {
      kind: 'call',
      mode: 'feed',
      autoExtract: true,
      extractionTargets: '["TaskBlock"]',
    } as never);
    callId = call.id;
    const interpretation = kernel();

    await expect(interpretation.watchCollection(call.id)).rejects.toThrow('the processor refused');
    refusing = false;
    await interpretation.unwatchCollection(call.id);
    await interpretation.watchCollection(call.id);

    const these = events.filter((e) => e.endsWith(watchId(call.id)));
    expect(these).toEqual([`unwatch:${watchId(call.id)}`, `watch:${watchId(call.id)}`]);
  }, 15000);

  /*
    The sidebar cache follows the space on screen: for a dataset nobody is looking at it says what
    the record said when this client last visited. A peer switching automatic extraction off after
    that leaves the cache saying on while the stored record says off — and a watch decided by the
    cache registers on a community that already turned it off. The space's answer is read off its
    own record through the call's dataset, not the cache.
  */
  it('does not register an off-screen call when the stored record says extraction is off but the cache says on', async () => {
    const port = watchPort();
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    const a = stores.datasets.currentDataset()!.id;
    // No switch of its own — made before the convention of copying the space's answers in, so the
    // call defers to the space's record.
    const call = await CollectionBlock.create(handleA, {
      kind: 'call',
      mode: 'feed',
      extractionTargets: '["TaskBlock"]',
    } as never);

    await enterSpace(stores, 'Elsewhere');
    // A peer's write lands on the stored record while nobody here is looking: the cache keeps
    // what it said when this client left.
    const [record] = await Space.findAll(handleA, { where: { uuid: a } });
    await Space.update(handleA, record.id, { autoInterpret: false });
    // The stored record says off; the sidebar cache still says what it said when this client left.
    expect(stores.spaces.mySpaces().find((s) => s.uuid === a)?.autoInterpret).toBe(true);
    provideModuleHostServices({
      datasetByUri: (uri) => stores.datasets.datasets().find((d) => d.id === uri || d.sharedUri === uri)?.handle,
    });

    await expect(kernel().watchCollection(call.id, { dataset: a })).rejects.toThrow('automatic interpretation is off');
    expect(port.registrations.some((r) => r.watchId === watchId(call.id))).toBe(false);
  }, 15000);

  /*
    The live list stands in for a collection whose settings have not been read yet — answering
    with the space's default, not the call's own — so a pass that asked it would extract the wrong
    classes into a call whose own list was already stored. `interpretCollection` reads the classes
    off the call's own row, before the gather.
  */
  it('runs a pass on the call’s own stored classes while its settings are not yet loaded live', async () => {
    const requests: { classes: string[] }[] = [];
    onPorts = (ports) => {
      (ports as unknown as { interpretation: unknown }).interpretation = {
        interpret: async (_dataset: unknown, _turns: unknown, request: { classes: string[] }) => {
          requests.push({ classes: [...request.classes] });
          return { turns: 0, ids: [], proposed: [] };
        },
      };
    };
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    // Events only, where the space's default is the wider list — and nobody has asked about this
    // call live, so the live list would answer with the space's.
    const call = await CollectionBlock.create(handleA, {
      kind: 'call',
      mode: 'feed',
      autoExtract: true,
      extractionTargets: '["EventBlock"]',
    } as never);

    await kernel().runOnCollection(call.id);

    expect(requests).toHaveLength(1);
    expect(requests[0].classes).toEqual(['EventBlock']);
  }, 15000);

  /*
    A pass that cannot read its settings never reaches the model, and is still an attempt: without
    a failed run on the call, the log cannot tell it from a call nobody processed. No classes are
    guessed for it — it names none.
  */
  it('records a manual pass whose settings cannot be read as a failed run', async () => {
    const requests: unknown[] = [];
    onPorts = (ports) => {
      (ports as unknown as { interpretation: unknown }).interpretation = {
        interpret: async (...args: unknown[]) => {
          requests.push(args);
          return { turns: 0, ids: [], proposed: [] };
        },
      };
    };
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    const call = await CollectionBlock.create(handleA, {
      kind: 'call',
      mode: 'feed',
      autoExtract: true,
      extractionTargets: '["EventBlock"]',
    } as never);
    const Entity = getEntity('CollectionBlock') as unknown as {
      findAll: (handle: unknown, q?: { properties?: readonly string[] }) => Promise<unknown[]>;
    };
    const findAll = Entity.findAll.bind(Entity);
    const spy = vi.spyOn(Entity, 'findAll').mockImplementation(async (handle, q) => {
      if (q?.properties) throw new Error('settings unreadable');
      return findAll(handle, q as never);
    });
    try {
      await expect(kernel().runOnCollection(call.id)).rejects.toThrow('settings unreadable');
    } finally {
      spy.mockRestore();
    }
    expect(requests).toHaveLength(0);
    const [row] = (await CollectionBlock.findAll(handleA, {
      where: { id: [call.id] },
      include: { runs: { where: { kind: 'extraction' } } },
    } as never)) as unknown as { runs?: { outcome?: string; error?: string; detail?: string }[] }[];
    expect(row.runs).toHaveLength(1);
    expect(row.runs![0]).toMatchObject({ outcome: 'failed', error: 'settings unreadable' });
    expect(JSON.parse(row.runs![0].detail ?? '{}').targets).toEqual([]);
  }, 15000);

  it('asks for the call’s own classes when the space moves on mid-gather', async () => {
    const requests: { dataset: unknown; classes: string[] }[] = [];
    onPorts = (ports) => {
      (ports as unknown as { interpretation: unknown }).interpretation = {
        interpret: async (dataset: unknown, _turns: unknown, request: { classes: string[] }) => {
          requests.push({ dataset, classes: [...request.classes] });
          return { turns: 0, ids: [], proposed: [] };
        },
      };
    };
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    const a = stores.datasets.currentDataset()!.id;
    const call = await CollectionBlock.create(handleA, {
      kind: 'call',
      mode: 'feed',
      autoExtract: true,
      extractionTargets: '["TaskBlock"]',
    } as never);
    // The call's own list — tasks only — is what a caller's open picker would already have read.
    const interpretation = kernel();
    await vi.waitFor(() => expect(looksFor(interpretation, call.id, 'EventBlock')).toBe(false));
    expect(looksFor(interpretation, call.id, 'TaskBlock')).toBe(true);

    // Elsewhere starts calls on events; the pass that follows must still ask for Here's tasks.
    await enterSpace(stores, 'Elsewhere');
    await stores.spaces.setInterpretationTarget('TaskBlock', false);
    const b = stores.datasets.currentDataset()!.id;
    await stores.spaces.navigateToSpace(a);
    await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(a));
    // The switch reset what is loaded: the call's own list again, as the picker shows it.
    await vi.waitFor(() => expect(looksFor(interpretation, call.id, 'EventBlock')).toBe(false));

    // The gather is held while the screen moves to Elsewhere — the window the class list raced.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const Text = getEntity('TextBlock') as unknown as {
      findAll: (handle: unknown, options?: unknown) => Promise<unknown[]>;
    };
    const findAll = Text.findAll.bind(Text);
    const spy = vi.spyOn(Text, 'findAll').mockImplementation(async (handle, options) => {
      await held;
      return findAll(handle, options);
    });
    try {
      const pass = interpretation.runOnCollection(call.id);
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());
      await stores.spaces.navigateToSpace(b);
      await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(b));
      release();
      await pass;
    } finally {
      spy.mockRestore();
    }

    expect(requests).toHaveLength(1);
    expect(requests[0].dataset).toBe(handleA);
    expect(requests[0].classes).toEqual(['TaskBlock']);
  }, 15000);

  /*
    An export laid out after the save can outlast the space it was started in: what names the file —
    the space's name, what the call looks for, the space's defaults — is the exporting space's, read
    for the call's own dataset rather than whatever is on screen when the content lands.
  */
  it('labels an export with the space it was started in, not the space on screen when it lands', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let proposalsAsked = false;
    onPorts = (ports) => {
      (ports as unknown as { interpretation: unknown }).interpretation = {
        proposals: async () => {
          proposalsAsked = true;
          await held;
          return [];
        },
      };
    };
    const saved: { name: string; text: string }[] = [];
    const unbindSaver = provideFileSaver(async ({ name, bytes }) => {
      saved.push({ name, text: new TextDecoder().decode(bytes) });
      return true;
    });
    try {
      const stores = mountShell();
      await ready(stores);
      const handleA = await enterSpace(stores, 'Made in');
      const a = stores.datasets.currentDataset()!.id;
      const call = await CollectionBlock.create(handleA, {
        kind: 'call',
        mode: 'feed',
        title: 'the call',
        autoExtract: true,
        extractionTargets: '["TaskBlock"]',
      } as never);
      // A pass, or the log is empty and nothing is written.
      await ModelRun.create(
        handleA,
        {
          kind: 'extraction',
          outcome: 'done',
          recordCount: 0,
          detail: '{"targets":["TaskBlock"]}',
          error: '',
          trigger: 'auto',
          prompt: 'p',
          output: 'o',
        } as never,
        { parent: { id: call.id, relation: 'runs', entity: 'CollectionBlock' } } as never,
      );

      // Elsewhere answers every one of the exported fields differently.
      await enterSpace(stores, 'Moved to');
      await stores.spaces.setAutoInterpret(false);
      await stores.spaces.setInterpretationTarget('TaskBlock', false);
      const b = stores.datasets.currentDataset()!.id;
      await stores.spaces.navigateToSpace(a);
      await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(a));

      // Started in Here; held in the gather while the screen moves to Elsewhere.
      const exporting = stores.spaces.exportInterpretationLog(call.id);
      await vi.waitFor(() => expect(proposalsAsked).toBe(true));
      await stores.spaces.navigateToSpace(b);
      await vi.waitFor(() => expect(stores.spaces.currentSpace()?.uuid).toBe(b));
      release();
      await exporting;
    } finally {
      unbindSaver();
    }

    expect(saved).toHaveLength(1);
    const log = saved[0].text;
    expect(log).toContain('- Space: Made in');
    expect(log).toContain('- Looking for, on this call: TaskBlock\n');
    // Candidate order, the way the picker's list reads — the export resolves by the same rule.
    expect(log).toContain('- Space default: EventBlock, TaskBlock');
    expect(log).toContain('- Interprets automatically as the call happens: yes');
  }, 15000);

  /*
    A browser opens the save dialog only while it is still handling the click that asked for it, so
    the picker cannot wait on the export's settings read — only on the title that names the file.
    The settings are read inside the content callback instead, still through the call's own
    dataset: the picker is already open, the space can change underneath, and the log is still
    labelled by the space it was started in.
  */
  it('opens the save picker before the export’s settings resolve, still naming the space it started in', async () => {
    // Held at the collection-settings read the export's settings start with — opened below, moved,
    // released. The collection's own row is the one read it always makes: the space record and the
    // candidates come from the live signals while its space is on screen.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let holding = false;
    let metaRead = false;
    let heldHandle: unknown;
    let heldCall = '';
    let settingsReads: ReturnType<typeof vi.spyOn> | undefined;
    const pickerCalls: string[] = [];
    let written = '';
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = async (options: {
      suggestedName?: string;
    }) => {
      pickerCalls.push(options.suggestedName ?? '');
      return {
        createWritable: async () => ({
          write: async (data: Blob) => {
            written = await data.text();
          },
          close: async () => {},
        }),
      };
    };
    try {
      const stores = mountShell();
      await ready(stores);
      const handleA = await enterSpace(stores, 'Made in');
      heldHandle = handleA;
      const a = stores.datasets.currentDataset()!.id;
      const call = await CollectionBlock.create(handleA, {
        kind: 'call',
        mode: 'feed',
        title: 'the call',
        autoExtract: true,
        extractionTargets: '["TaskBlock"]',
      } as never);
      heldCall = call.id;
      const Entity = getEntity('CollectionBlock') as unknown as {
        findAll: (
          handle: unknown,
          q?: { where?: { id?: string[] }; properties?: readonly string[] },
        ) => Promise<unknown[]>;
      };
      const findAll = Entity.findAll.bind(Entity);
      settingsReads = vi.spyOn(Entity, 'findAll').mockImplementation(async (handle, q) => {
        if (holding && handle === heldHandle && q?.properties && q.where?.id?.includes(heldCall)) {
          metaRead = true;
          await held;
        }
        return findAll(handle, q as never);
      });
      await ModelRun.create(
        handleA,
        {
          kind: 'extraction',
          outcome: 'done',
          recordCount: 0,
          detail: '{"targets":["TaskBlock"]}',
          error: '',
          trigger: 'auto',
          prompt: 'p',
          output: 'o',
        } as never,
        { parent: { id: call.id, relation: 'runs', entity: 'CollectionBlock' } } as never,
      );

      await enterSpace(stores, 'Moved to');
      const b = stores.datasets.currentDataset()!.id;
      await stores.spaces.navigateToSpace(a);
      await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(a));

      holding = true;
      const exporting = stores.spaces.exportInterpretationLog(call.id);
      // The settings read is still out — and the picker is already open, inside the click's window.
      await vi.waitFor(() => expect(metaRead).toBe(true));
      expect(pickerCalls).toHaveLength(1);
      expect(pickerCalls[0]).toContain('the-call');

      await stores.spaces.navigateToSpace(b);
      await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(b));
      release();
      await exporting;
    } finally {
      holding = false;
      settingsReads?.mockRestore();
      delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    }

    expect(written).toContain('- Space: Made in');
  }, 15000);

  /*
    The settings head the log and are not its substance, so a call with no passes says so without
    waiting on them.
  */
  it('says no extraction has run without waiting on the export’s settings', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let metaRead = false;
    let spy: ReturnType<typeof vi.spyOn> | undefined;
    const warned = vi.spyOn(toastService, 'warning');
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = async () => ({
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    });
    try {
      const stores = mountShell();
      await ready(stores);
      const handleA = await enterSpace(stores, 'Quiet');
      const call = await CollectionBlock.create(handleA, { kind: 'call', mode: 'feed', title: 'quiet' } as never);
      const Entity = getEntity('CollectionBlock') as unknown as {
        findAll: (handle: unknown, q?: { properties?: readonly string[] }) => Promise<unknown[]>;
      };
      const findAll = Entity.findAll.bind(Entity);
      spy = vi.spyOn(Entity, 'findAll').mockImplementation(async (handle, q) => {
        if (q?.properties) {
          metaRead = true;
          await held;
        }
        return findAll(handle, q as never);
      });

      await stores.spaces.exportInterpretationLog(call.id);
      // The settings read is still out, and the answer is already given.
      expect(metaRead).toBe(true);
      expect(warned).toHaveBeenCalledWith('No interpretation has run on this call yet.');
      release();
    } finally {
      release();
      spy?.mockRestore();
      warned.mockRestore();
      delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    }
  }, 15000);

  /*
    Back on a space, the shape list still held is the one for the space just left until this
    space's own load publishes. A call asked about in that window narrows by this space's own
    candidates, not the stale list — which lacks the models only this space adopted.
  */
  it('narrows an on-screen call by its own space’s candidates while that space’s shapes still load', async () => {
    const port = watchPort();
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    const a = stores.datasets.currentDataset()!.id;
    const manifest: EntityManifest = {
      version: '1',
      entities: {
        Sighting: { extractable: true, properties: { note: { type: 'string' } }, relations: {} },
      },
    };
    expect(await stores.shapes.addRecordTypes('test', [{ name: 'Sighting', manifest }])).toEqual([]);
    await vi.waitFor(() => expect(stores.shapes.interpretationCandidates()).toContain('Sighting'));
    const call = await CollectionBlock.create(handleA, {
      kind: 'call',
      mode: 'feed',
      autoExtract: true,
      extractionTargets: '["Sighting"]',
    } as never);
    await enterSpace(stores, 'Elsewhere');
    expect(stores.shapes.interpretationCandidates()).not.toContain('Sighting');
    provideModuleHostServices({
      datasetByUri: (uri) => stores.datasets.datasets().find((d) => d.id === uri || d.sharedUri === uri)?.handle,
    });

    // Here's own shape load is held, so what is published is still Elsewhere's list.
    const shapes = stores.session.backendPorts()!.schemas.shapes!;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let holdNext = true;
    const list = shapes.list.bind(shapes);
    const spy = vi.spyOn(shapes, 'list').mockImplementation(async (handle) => {
      if (holdNext && handle === handleA) {
        holdNext = false;
        await held;
      }
      return list(handle);
    });
    try {
      await stores.spaces.navigateToSpace(a);
      await vi.waitFor(() => expect(stores.datasets.currentDataset()?.id).toBe(a));
      await vi.waitFor(() => expect(holdNext).toBe(false));
      expect(stores.shapes.interpretationCandidatesLoaded()).toBe(false);

      await kernel().watchCollection(call.id, { dataset: a });
      expect(port.registrations.find((r) => r.watchId === watchId(call.id))?.classes).toEqual(['Sighting']);
    } finally {
      release();
      spy.mockRestore();
    }
  }, 15000);

  /*
    A class the dataset already had is installed whether or not this session has registered it —
    only the switch registers, and an off-screen ask must not. A call extracting into one is
    resolved by the executor from the class's own shape, so the read must keep it.
  */
  it('keeps an installed foreign class a call interprets into when its space is off screen', async () => {
    const port = watchPort();
    const withWatch = onPorts!;
    onPorts = (ports) => {
      withWatch(ports);
      ports.schemas.foreignEntries = async () => [
        { name: 'Heron', targetClass: 'test://Heron', properties: [], interpretationHint: 'something seen' },
      ];
    };
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    const a = stores.datasets.currentDataset()!.id;
    expect(getEntityForDataset('Heron', handleA)).toBeUndefined();
    const call = await CollectionBlock.create(handleA, {
      kind: 'call',
      mode: 'feed',
      autoExtract: true,
      extractionTargets: '["Heron"]',
    } as never);
    await enterSpace(stores, 'Elsewhere');
    provideModuleHostServices({
      datasetByUri: (uri) => stores.datasets.datasets().find((d) => d.id === uri || d.sharedUri === uri)?.handle,
    });

    await kernel().watchCollection(call.id, { dataset: a });
    expect(port.registrations.find((r) => r.watchId === watchId(call.id))?.classes).toEqual(['Heron']);
  }, 15000);

  /*
    The settings are a header on the log, not its substance: a read of them that fails must not
    take the history with it when the passes themselves are readable.
  */
  it('still exports the extraction history when the settings cannot be read', async () => {
    let written = '';
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (data: Blob) => {
          written = await data.text();
        },
        close: async () => {},
      }),
    });
    let settingsReads: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const stores = mountShell();
      await ready(stores);
      const handleA = await enterSpace(stores, 'Made in');
      const call = await CollectionBlock.create(handleA, {
        kind: 'call',
        mode: 'feed',
        title: 'the call',
        autoExtract: true,
        extractionTargets: '["TaskBlock"]',
      } as never);
      await ModelRun.create(
        handleA,
        {
          kind: 'extraction',
          outcome: 'done',
          recordCount: 0,
          detail: '{"targets":["TaskBlock"]}',
          error: '',
          trigger: 'auto',
          prompt: 'the prompt',
          output: 'o',
        } as never,
        { parent: { id: call.id, relation: 'runs', entity: 'CollectionBlock' } } as never,
      );
      const Entity = getEntity('CollectionBlock') as unknown as {
        findAll: (handle: unknown, q?: { properties?: readonly string[] }) => Promise<unknown[]>;
      };
      const findAll = Entity.findAll.bind(Entity);
      settingsReads = vi.spyOn(Entity, 'findAll').mockImplementation(async (handle, q) => {
        if (q?.properties) throw new Error('settings unreadable');
        return findAll(handle, q as never);
      });
      await stores.spaces.exportInterpretationLog(call.id);
    } finally {
      settingsReads?.mockRestore();
      delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    }
    expect(written).toContain('the prompt');
    expect(written).toContain('Looking for, on this call: (unavailable)');
  }, 15000);

  /*
    Resolvable is not extractable: an adopted model whose manifest does not say it may be extracted
    into still registers a class in the dataset, so a check that only asks "does the name resolve"
    keeps it — where the live list, which intersects the candidates, does not. A call that kept such
    a class in its stored list registers it when its space is off screen, and extracts noise into a
    model its author never offered.
  */
  it('does not register a call’s non-candidate class when the call’s space is off screen', async () => {
    const port = watchPort();
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    const a = stores.datasets.currentDataset()!.id;
    const interpretation = kernel();

    // A model this space carries that nothing may extract into — adopted, so the name resolves.
    const manifest: EntityManifest = {
      version: '1',
      entities: {
        Ledger: {
          properties: { entry: { type: 'string' } },
          relations: {},
        },
      },
    };
    expect(await stores.shapes.addRecordTypes('test', [{ name: 'Ledger', manifest }])).toEqual([]);
    await vi.waitFor(() => expect(stores.shapes.spaceShapes().map((s) => s.name)).toContain('Ledger'));
    // Not a candidate on screen either — the call's stored list is the thing out of step.
    expect(stores.shapes.interpretationCandidates()).not.toContain('Ledger');
    const call = await CollectionBlock.create(handleA, {
      kind: 'call',
      mode: 'feed',
      autoExtract: true,
      extractionTargets: '["Ledger"]',
    } as never);
    await vi.waitFor(() => expect(looksFor(interpretation, call.id, 'Ledger')).not.toBe(true));

    await enterSpace(stores, 'Elsewhere');
    provideModuleHostServices({
      datasetByUri: (uri) => stores.datasets.datasets().find((d) => d.id === uri || d.sharedUri === uri)?.handle,
    });

    // The off-screen read narrows by the same rule the live one does: no candidates left, so the
    // watch is refused rather than registered carrying a name the registry happens to resolve.
    await expect(interpretation.watchCollection(call.id, { dataset: a })).rejects.toThrow(
      'nothing in this space is marked',
    );
    expect(port.registrations.some((r) => r.watchId === watchId(call.id))).toBe(false);
  }, 15000);

  /*
    Asking what an off-screen space can extract is a read, not an adoption: the answer comes off
    the dataset's shape records and a read of the classes it already had — not the registering
    read the switch uses, which on AD4M replaces the dataset's synthesised-class registry
    wholesale, adopted shapes' compiled classes included. A watch or an export asking the question
    would otherwise leave the dataset's own models rebuilt from SHACL, short of the compiled
    behaviour their classes carried.
  */
  it('asks an off-screen space’s classes without re-registering the dataset’s own', async () => {
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    const manifest: EntityManifest = {
      version: '1',
      entities: {
        Sighting: { extractable: true, properties: { note: { type: 'string' } }, relations: {} },
      },
    };
    expect(await stores.shapes.addRecordTypes('test', [{ name: 'Sighting', manifest }])).toEqual([]);
    await vi.waitFor(() => expect(stores.shapes.spaceShapes().map((s) => s.name)).toContain('Sighting'));
    const compiled = getEntityForDataset('Sighting', handleA);
    expect(compiled).toBeDefined();

    await enterSpace(stores, 'Elsewhere');

    const schemas = stores.session.backendPorts()!.schemas;
    const registering = vi.spyOn(schemas, 'foreignSchemas');
    const reading = vi.spyOn(schemas, 'foreignEntries');

    const { candidates } = await stores.shapes.interpretationCandidatesFor(handleA);
    expect(candidates).toContain('Sighting');
    // The read answered, and nothing was registered for it: the dataset's registry still holds
    // the class its shape compiled to.
    expect(reading).toHaveBeenCalledWith(handleA);
    expect(registering).not.toHaveBeenCalled();
    expect(getEntityForDataset('Sighting', handleA)).toBe(compiled);
  }, 15000);

  /*
    The live list publishes no adopted shapes for a dataset that is not a WE space, so the same
    dataset asked about from elsewhere must not offer a stored shape document either.
  */
  it('offers no stored shapes for an off-screen dataset that is not a WE space', async () => {
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    const manifest: EntityManifest = {
      version: '1',
      entities: {
        Sighting: { extractable: true, properties: { note: { type: 'string' } }, relations: {} },
      },
    };
    expect(await stores.shapes.addRecordTypes('test', [{ name: 'Sighting', manifest }])).toEqual([]);
    await vi.waitFor(() => expect(stores.shapes.spaceShapes().map((s) => s.name)).toContain('Sighting'));
    await enterSpace(stores, 'Elsewhere');

    const schemas = stores.session.backendPorts()!.schemas;
    expect((await stores.shapes.interpretationCandidatesFor(handleA)).candidates).toContain('Sighting');
    const core = vi.spyOn(schemas, 'hasCoreSchema').mockResolvedValue(false);
    try {
      expect((await stores.shapes.interpretationCandidatesFor(handleA)).candidates).not.toContain('Sighting');
    } finally {
      core.mockRestore();
    }
  }, 15000);

  /*
    The foreign read answers every SHACL class that is not registered in the session — a WE-authored
    model whose shape document is stored included. Where there is no core schema that class is no
    candidate, though a genuinely foreign one still is.
  */
  it('keeps a stored WE model out of the foreign candidates of a dataset that is not a WE space', async () => {
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    const manifest: EntityManifest = {
      version: '1',
      entities: {
        Sighting: { extractable: true, properties: { note: { type: 'string' } }, relations: {} },
      },
    };
    expect(await stores.shapes.addRecordTypes('test', [{ name: 'Sighting', manifest }])).toEqual([]);
    await vi.waitFor(() => expect(stores.shapes.spaceShapes().map((s) => s.name)).toContain('Sighting'));
    // The class WE registered for it is gone, as it is for a model the session never compiled.
    unregisterEntity('Sighting');
    await enterSpace(stores, 'Elsewhere');

    const schemas = stores.session.backendPorts()!.schemas;
    const core = vi.spyOn(schemas, 'hasCoreSchema').mockResolvedValue(false);
    const reading = vi.spyOn(schemas, 'foreignEntries').mockResolvedValue([
      { name: 'Sighting', manifest },
      { name: 'Heron', manifest },
    ] as never);
    try {
      const { candidates } = await stores.shapes.interpretationCandidatesFor(handleA);
      expect(candidates).not.toContain('Sighting');
      expect(candidates).toContain('Heron');
    } finally {
      reading.mockRestore();
      core.mockRestore();
    }
  }, 15000);

  /*
    An on-screen collection's answers come from the live reads — the freshest — but the space's
    own record is still read through the handle when the record on screen cannot answer for it,
    and that read can outlive the space on screen. A switch landing inside it leaves the live
    signals answering for the space that replaced this one — another space's candidates narrowing
    this one's class list to nothing. The live answers are taken before the read begins, so the
    space being left's own answers survive it.
  */
  it('answers a call in the space just left from that space’s own answers, not the one now showing', async () => {
    const port = watchPort();
    const stores = mountShell();
    await ready(stores);
    const handleA = await enterSpace(stores, 'Here');
    const a = stores.datasets.currentDataset()!.id;
    // Here's own extractable model — a candidate here and in no other space's list.
    const manifest: EntityManifest = {
      version: '1',
      entities: {
        Sighting: { extractable: true, properties: { note: { type: 'string' } }, relations: {} },
      },
    };
    expect(await stores.shapes.addRecordTypes('test', [{ name: 'Sighting', manifest }])).toEqual([]);
    await vi.waitFor(() => expect(stores.shapes.interpretationCandidates()).toContain('Sighting'));
    const call = await CollectionBlock.create(handleA, {
      kind: 'call',
      mode: 'feed',
      autoExtract: true,
      extractionTargets: '["Sighting"]',
    } as never);

    // From is on screen, so switching to Here leaves its record up: Here's own record read is
    // held, and the record on screen stays From's — which is what sends the collection's space
    // question to the stored-record read the watch's answer then outlives.
    await enterSpace(stores, 'From');
    const Entity = getEntity('Space') as unknown as {
      query: (
        handle: unknown,
        q?: { where?: { uuid?: string; url?: string } },
      ) => {
        subscribe: (cb: (rows: unknown[]) => void) => Promise<unknown[]>;
        dispose: () => void;
      };
      findAll: (handle: unknown, q?: { where?: { uuid?: string; url?: string } }) => Promise<Space[]>;
    };
    let releaseRecord!: () => void;
    const heldRecord = new Promise<void>((resolve) => (releaseRecord = resolve));
    const query = Entity.query.bind(Entity);
    const querySpy = vi.spyOn(Entity, 'query').mockImplementation((handle, q) => {
      const which = q?.where?.uuid ?? q?.where?.url;
      const builder = query(handle, q);
      if (which !== a) return builder;
      return {
        subscribe: async (cb) => {
          await heldRecord;
          return builder.subscribe(cb);
        },
        dispose: () => builder.dispose(),
      };
    });
    // The stored space read inside the collection's answers, held so the switch lands inside it.
    let releaseSpace!: () => void;
    const heldSpace = new Promise<void>((resolve) => (releaseSpace = resolve));
    let holding = false;
    let spaceReadHeld = false;
    const findAll = Entity.findAll.bind(Entity);
    const spaceSpy = vi.spyOn(Entity, 'findAll').mockImplementation(async (handle, q) => {
      if (holding && handle === handleA && q?.where?.uuid === a) {
        spaceReadHeld = true;
        await heldSpace;
      }
      return findAll(handle, q);
    });
    try {
      await stores.datasets.switchDataset(a);
      await vi.waitFor(() => expect(stores.shapes.interpretationCandidatesLoaded()).toBe(true));
      expect(stores.spaces.currentSpace()?.uuid).not.toBe(a);
      provideModuleHostServices({
        datasetByUri: (uri) => stores.datasets.datasets().find((d) => d.id === uri || d.sharedUri === uri)?.handle,
      });

      holding = true;
      const starting = kernel().watchCollection(call.id, { dataset: a });
      await vi.waitFor(() => expect(spaceReadHeld).toBe(true));

      // The switch lands inside the space read: From's live answers now, with Here's row and
      // handle still in hand.
      const from = stores.datasets
        .datasets()
        .find((d) => d.id !== a && !stores.datasets.systemDatasetUuids().includes(d.id))!;
      await stores.datasets.switchDataset(from.id);
      await vi.waitFor(() => expect(stores.shapes.interpretationCandidatesLoaded()).toBe(true));
      expect(stores.shapes.interpretationCandidates()).not.toContain('Sighting');

      releaseSpace();
      await starting;
    } finally {
      releaseRecord();
      spaceSpy.mockRestore();
      querySpy.mockRestore();
    }

    const registered = port.registrations.find((r) => r.watchId === watchId(call.id));
    expect(registered?.dataset).toBe(handleA);
    expect(registered?.classes).toEqual(['Sighting']);
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

describe('a schema install the backend refuses', () => {
  /** The class names in an install, as the in-memory backend is handed them. */
  const classNames = (schemas: readonly unknown[]) => schemas.map((cls) => (cls as { name: string }).name);

  it('reports a refused module, and the space still opens', async () => {
    seededDatasets = [{ id: 'garden-1', name: 'Garden' }];
    const refusal = new ModuleSchemasRefused([
      { moduleId: 'clashing', reason: 'Shape garden://ClashShape already belongs to class other-app://Clash' },
    ]);
    onPorts = (ports) => {
      ports.schemas.installModules = async () => {
        throw refusal;
      };
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const toasted = vi.spyOn(toastService, 'error');
    try {
      const stores = mountShell();
      await ready(stores);

      await stores.datasets.switchDataset('garden-1');

      expect(stores.datasets.currentDataset()?.id).toBe('garden-1');
      expect(stores.datasets.isWeSpace()).toBe(true);
      expect(toasted).not.toHaveBeenCalledWith('Could not open that space');
      // Reported where the refresh is, naming the module.
      expect(logged).toHaveBeenCalledWith('DatasetStore: module schema install failed', refusal);
      expect(refusal.message).toContain('clashing');
    } finally {
      logged.mockRestore();
      toasted.mockRestore();
    }
  });

  it('reports a refused refresh, and the switch carries on', async () => {
    seededDatasets = [{ id: 'garden-1', name: 'Garden' }];
    const refusal = new Error('Shape we://SpaceShape already belongs to class other-app://Space');
    let refreshed = 0;
    onPorts = (ports) => {
      ports.schemas.refreshSpace = async () => {
        refreshed++;
        throw refusal;
      };
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const toasted = vi.spyOn(toastService, 'error');
    try {
      const stores = mountShell();
      await ready(stores);
      const before = refreshed;

      await stores.datasets.switchDataset('garden-1');

      expect(refreshed).toBe(before + 1);
      expect(stores.datasets.currentDataset()?.id).toBe('garden-1');
      expect(toasted).not.toHaveBeenCalledWith('Could not open that space');
      expect(logged).toHaveBeenCalledWith('DatasetStore: space schema refresh failed', refusal);
    } finally {
      logged.mockRestore();
      toasted.mockRestore();
    }
  });

  it("shows a refused record type as a problem, and writes none of the app's record types", async () => {
    seededDatasets = [{ id: 'garden-1', name: 'Garden' }];
    let shapes!: NonNullable<ReturnType<typeof createInMemoryBackendPorts>['schemas']['shapes']>;
    onPorts = (ports) => {
      shapes = ports.schemas.shapes!;
      const { installModules } = ports.schemas;
      ports.schemas.installModules = async (dataset, schemas) => {
        if (classNames(schemas).includes('Clash')) {
          throw new ModuleSchemasRefused([
            {
              moduleId: 'shape/bundle/garden-app/Clash',
              reason: 'Shape garden://ClashShape already belongs to class other-app://Clash',
            },
          ]);
        }
        return installModules(dataset, schemas);
      };
    };
    const stores = mountShell();
    await ready(stores);
    await stores.datasets.switchDataset('garden-1');
    const handle = stores.datasets.currentDataset()!.handle;
    const type = (name: string) => ({
      name,
      manifest: { version: '1', entities: { [name]: { properties: { label: { type: 'string' } }, relations: {} } } },
    });

    const problems = await stores.shapes.addRecordTypes('garden-app', [type('Plant'), type('Clash')] as never);

    expect(problems).toEqual([
      '"Clash" could not be added — Shape garden://ClashShape already belongs to class other-app://Clash',
    ]);
    expect(await shapes.list(handle)).toEqual([]);
    expect(stores.shapes.spaceShapes()).toEqual([]);

    // Once nothing refuses, the same call adds both.
    expect(await stores.shapes.addRecordTypes('garden-app', [type('Plant')] as never)).toEqual([]);
    expect((await shapes.list(handle)).map((s) => s.name)).toEqual(['Plant']);
  });

  it('declares a stored model it cannot edit without reinstalling its schema', async () => {
    // `editable: false` means the stored shape says more than the manifest can (another tool wrote
    // to it). Installing the compiled manifest would write the reduced schema back over it.
    seededDatasets = [{ id: 'garden-1', name: 'Garden' }];
    const manifest = {
      version: '1',
      entities: { Sighting: { properties: { label: { type: 'string' } }, relations: {} } },
    };
    const installs: string[][] = [];
    const declared: string[] = [];
    onPorts = (ports) => {
      ports.schemas.shapes = {
        list: async () => [
          {
            id: 'sighting-1',
            name: 'Sighting',
            description: '',
            icon: 'cube',
            shapeId: 'we://shapes/sighting',
            version: 1,
            forkedFrom: '',
            manifest: manifest as never,
            editable: false,
          },
        ],
        save: async () => {
          throw new Error('unreachable');
        },
        remove: async () => {},
      };
      const { installModules, declareInDataset } = ports.schemas;
      ports.schemas.installModules = async (dataset, schemas) => {
        installs.push(classNames(schemas));
        return installModules(dataset, schemas);
      };
      ports.schemas.declareInDataset = (dataset, m, opts) => {
        declared.push(...Object.keys(m.entities));
        return declareInDataset(dataset, m, opts);
      };
    };
    const stores = mountShell();
    await ready(stores);
    await stores.datasets.switchDataset('garden-1');
    await vi.waitFor(() => expect(stores.shapes.shapesLoaded()).toBe(true));

    // Listed, adopted for queries — and never re-registered.
    expect(stores.shapes.spaceShapes()).toEqual([
      expect.objectContaining({ name: 'Sighting', editable: false, problems: [] }),
    ]);
    expect(declared).toContain('Sighting');
    expect(installs.flat()).not.toContain('Sighting');
  });
});
