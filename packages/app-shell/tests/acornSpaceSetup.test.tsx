/**
 * Acorn project setup through the REAL SpaceStore — the in-memory backend doing the
 * record writes, the lifecycle deps wired the way the provider wires them.
 *
 * `acornLifecycle.test.ts` mocks every dep the sequence consults, which is how it
 * says what the sequence *does*; this file is what the sequence *writes*: real
 * `Space`/`CollectionBlock` rows in a real dataset, the real `navigateToSpace` and
 * `switchDataset` between the ownership check and the landing, the real
 * localStorage intent store, and the real mount-discovery walk — the places a
 * mocked-deps suite cannot see.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { createInMemoryBackendPorts, type InMemoryAgentOptions } from '@we/backend-inmemory';
import type { AcornLifecyclePort } from '@we/backend-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────
// Same arrangement as executorFreeBoot.test.tsx: the platform provider supplies the
// in-memory backend plus an injectable Acorn port; template/theme/route stores are
// minimal fakes the test can drive. Nothing about the data layer is mocked.

let agentOptions: InMemoryAgentOptions;
let seededDatasets: { id: string; name: string }[] = [];
/** The Acorn port this test's host mounts — absent is the ordinary in-memory host. */
let acornPort: AcornLifecyclePort | undefined;
/** Datasets whose template preload parks until the test releases it — F1's race window. */
let preloadGates = new Map<string, Promise<void>>();
/** Which datasets the mocked preload was asked for — the race test's "inside the await" marker. */
const preloadAsked: string[] = [];

vi.mock('../src/frameworks/solid/providers/PlatformProvider', () => ({
  usePlatform: () => ({ isDesktop: false, isDevelopment: true, executor: undefined }),
  useBackend: () => ({
    initialize: async (ctx: { selfId(): string | undefined }) => {
      const ports = createInMemoryBackendPorts(ctx, { agent: agentOptions, datasets: seededDatasets });
      if (acornPort) ports.acornLifecycle = acornPort;
      return { client: {}, ports };
    },
  }),
}));

const navigate = vi.fn();
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

vi.mock('../src/frameworks/solid/stores/TemplateStore', () => ({
  useTemplateStore: () => ({
    appTemplate: () => ({ id: 'we-app' }),
    provideSpaceLookup: () => {},
    preloadSpaceTemplates: async (ds: { id: string }) => {
      preloadAsked.push(ds.id);
      await preloadGates.get(ds.id);
    },
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
    useTemplateTheme: () => true,
    replaceTheme: () => {},
    restorePersonalTheme: () => {},
    clearSpaceTheme: () => {},
  }),
}));

vi.mock('../src/frameworks/solid/firstScreen', () => ({
  firstScreen: {
    open: () => {},
    whenOpen: () => Promise.resolve(),
    hold: () => {},
    waiting: () => false,
    answered: () => {},
    drawn: () => {},
  },
}));

// ── Harness ───────────────────────────────────────────────────────────────────
import { BootController } from '../src/frameworks/solid/providers/BootController';
import { AccountStoreProvider } from '../src/frameworks/solid/stores/AccountStore';
import { AppStoreProvider } from '../src/frameworks/solid/stores/AppStore';
import { ChatStoreProvider } from '../src/frameworks/solid/stores/ChatStore';
import { type DatasetStore, DatasetStoreProvider, useDatasetStore } from '../src/frameworks/solid/stores/DatasetStore';
import { ProfileStoreProvider } from '../src/frameworks/solid/stores/ProfileStore';
import { RecordStoreProvider } from '../src/frameworks/solid/stores/RecordStore';
import { RuntimeStoreProvider } from '../src/frameworks/solid/stores/RuntimeStore';
import { type SessionStore, SessionStoreProvider, useSessionStore } from '../src/frameworks/solid/stores/SessionStore';
import { ShapeStoreProvider } from '../src/frameworks/solid/stores/ShapeStore';
import { ShellStoreProvider } from '../src/frameworks/solid/stores/ShellStore';
import { type SpaceStore, SpaceStoreProvider, useSpaceStore } from '../src/frameworks/solid/stores/SpaceStore';
import { provideSeed } from '../src/shared/seedRegistry';

provideSeed({ name: 'test', modules: [] } as never);

/** The mounted language address every fake mount answers — one Acorn project. */
const LANG = 'lang://acorn-project-under-test';

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
      <ChatStoreProvider>
        <AccountStoreProvider>
          <SessionStoreProvider>
            <RuntimeStoreProvider>
              <DatasetStoreProvider>
                <ShapeStoreProvider>
                  <RecordStoreProvider>
                    <ProfileStoreProvider>
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

/**
 * The Acorn port a mount-capable host supplies: mounts recorded per dataset, and the
 * failure knobs the failure-path tests turn — a `mounts` read that cannot answer,
 * an `interact` that throws once, an `interact` held until released.
 */
function fakeAcorn() {
  const calls: string[] = [];
  const mountsOf = new Map<string, string[]>();
  const mountsFailing = new Set<string>();
  const interactFails = new Set<string>();
  const interactGates = new Map<string, Promise<void>>();
  const port: AcornLifecyclePort = {
    async applyTemplateLocal() {
      calls.push('applyTemplateLocal');
      return { address: LANG };
    },
    async mount(datasetId, languageAddress) {
      calls.push(`mount:${datasetId}`);
      mountsOf.set(datasetId, [...(mountsOf.get(datasetId) ?? []), languageAddress]);
      return true;
    },
    async mounts(datasetId) {
      if (mountsFailing.has(datasetId)) throw new Error('mounts unavailable');
      return mountsOf.get(datasetId) ?? [];
    },
    async unmount(datasetId, languageAddress) {
      mountsOf.set(
        datasetId,
        (mountsOf.get(datasetId) ?? []).filter((l) => l !== languageAddress),
      );
      return true;
    },
    async interact(url, call) {
      calls.push(`interact:${call.name}:${url}`);
      await interactGates.get(call.name);
      if (interactFails.delete(call.name)) throw new Error(`interact ${call.name} refused`);
      if (call.name === 'info') return { dnaHash: 'QmAcornDna' };
      if (call.name === 'whoami') return { address: 'profile://member' };
      return null;
    },
  };
  return { port, calls, mountsOf, mountsFailing, interactFails, interactGates };
}

beforeEach(() => {
  agentOptions = { id: 'did:test:james', unlocked: true };
  seededDatasets = [];
  acornPort = undefined;
  preloadGates = new Map();
  preloadAsked.length = 0;
  navigate.mockClear();
  route.go('/');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── The suite ─────────────────────────────────────────────────────────────────

describe('acorn open — the landing (F1)', () => {
  /*
    Passing the generation check is not the last word: `navigateToSpace` then awaits the
    template preload and the dataset switch, and either is long enough for the person to
    have gone somewhere else. An open whose selection moved during those awaits must not
    publish its dataset or write its route — the newest ask owns the landing.
  */
  it('does not reclaim the selection when it moves during the navigation awaits', async () => {
    seededDatasets = [
      { id: 'ds-first', name: 'First' },
      { id: 'ds-acorn', name: 'Acorn project' },
      { id: 'ds-other', name: 'Other' },
    ];
    const acorn = fakeAcorn();
    acorn.mountsOf.set('ds-acorn', [LANG]);
    acornPort = acorn.port;
    const stores = mountShell();
    await ready(stores);
    await stores.datasets.switchDataset('ds-first');

    // Park the open inside navigateToSpace's first await.
    let releasePreload!: () => void;
    preloadGates.set('ds-acorn', new Promise<void>((resolve) => (releasePreload = resolve)));
    const opening = stores.spaces.openAcornProject('ds-acorn');
    await vi.waitFor(() => expect(preloadAsked).toContain('ds-acorn'));

    // The person moves while the open is parked in the navigation's awaits.
    await stores.spaces.navigateToSpace('ds-other');
    expect(stores.datasets.currentDataset()?.id).toBe('ds-other');

    releasePreload();
    await expect(opening).resolves.toBeNull();
    expect(stores.datasets.currentDataset()?.id).toBe('ds-other');
    expect(navigate).not.toHaveBeenCalledWith('/space/ds-acorn');
  });
});
