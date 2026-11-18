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
import { CollectionBlock, registerEntityWriteCheck, Space } from '@we/entities';
import { SPACE_COLLECTION_KIND } from '@we/schema-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACORN_SECTION_IDS } from '../src/shared/acornLifecycle';

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
import { relationId } from '../src/shared/involvements';
import { provideSeed } from '../src/shared/seedRegistry';
import { parseIdList } from '../src/shared/viewResolution';

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

/** The dataset's own Space row, read through the model like the store does. */
const spaceRecordOf = async (handle: unknown, ds: { id: string; sharedId?: string }) => {
  const where = ds.sharedId ? { url: ds.sharedId } : { uuid: ds.id };
  const [space] = await Space.findAll(handle, { where });
  return space ?? null;
};

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
  registerEntityWriteCheck(null);
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

describe('acorn open — the root relation (F2)', () => {
  /*
    `writeSpaceStructure` made the root collection and *then* linked it onto the Space.
    A failure at that boundary commits the collection and loses the link — and a retry
    that reads only "no root relation" mints another: one orphan per failed attempt.
    The retry must find the orphan it made and attach it instead.
  */
  it('attaches the root a failed link left behind rather than minting a second one', async () => {
    seededDatasets = [{ id: 'ds-acorn', name: 'Acorn project' }];
    const acorn = fakeAcorn();
    acorn.mountsOf.set('ds-acorn', [LANG]);
    acornPort = acorn.port;
    const stores = mountShell();
    await ready(stores);
    const ds = stores.datasets.datasets().find((d) => d.id === 'ds-acorn')!;

    // Refuse once at the write boundary — every record write passes `checkEntityWrite`,
    // so the create commits and the relation add is refused, exactly the half-state
    // a dead link write leaves on the real backend.
    let linkRefused = true;
    registerEntityWriteCheck((write) => {
      if (linkRefused && write.entity === 'Space' && write.kind === 'add' && write.relation === 'root')
        throw new Error('root link refused');
    });
    await expect(stores.spaces.openAcornProject('ds-acorn')).rejects.toThrow('root link refused');
    linkRefused = false;
    registerEntityWriteCheck(null);

    // The collection committed before the link was refused: one orphan, no root.
    const orphans = (await CollectionBlock.findAll(ds.handle, { where: { kind: SPACE_COLLECTION_KIND } })).map(
      (c) => c.id,
    );
    expect(orphans).toHaveLength(1);

    // The retry attaches that collection — the channel count does not grow.
    await expect(stores.spaces.openAcornProject('ds-acorn')).resolves.toBe('ds-acorn');
    const channels = await CollectionBlock.findAll(ds.handle, { where: { kind: SPACE_COLLECTION_KIND } });
    expect(channels.map((c) => c.id)).toEqual(orphans);
    const space = await spaceRecordOf(ds.handle, ds);
    expect(relationId(space?.root)).toBe(orphans[0]);
  });
});

describe('acorn open — the section recipe (F3)', () => {
  /*
    "Any Acorn section in the list" reads today's contents, not whether setup ever ran:
    a project whose members removed every Acorn section looks unwritten, and reopening
    rewrote the recipe over their choice. Completion has to be evidence, not membership
    in the recipe — a marker the finished setup writes.
  */
  it('keeps a list that removed every Acorn section — completion is written, not inferred', async () => {
    seededDatasets = [{ id: 'ds-acorn', name: 'Acorn project' }];
    const acorn = fakeAcorn();
    acorn.mountsOf.set('ds-acorn', [LANG]);
    acornPort = acorn.port;
    const stores = mountShell();
    await ready(stores);
    const ds = stores.datasets.datasets().find((d) => d.id === 'ds-acorn')!;

    await expect(stores.spaces.openAcornProject('ds-acorn')).resolves.toBe('ds-acorn');
    // The recipe landed at open…
    let space = await spaceRecordOf(ds.handle, ds);
    expect(parseIdList(space!.enabledViews)).toEqual(ACORN_SECTION_IDS);

    // …then the community decided it wanted none of them.
    await stores.spaces.setSpaceViews(['about'], 'ds-acorn');
    space = await spaceRecordOf(ds.handle, ds);
    expect(parseIdList(space!.enabledViews)).toEqual(['about']);

    // Reopening must not rewrite the recipe over the community's own list.
    await expect(stores.spaces.openAcornProject('ds-acorn')).resolves.toBe('ds-acorn');
    space = await spaceRecordOf(ds.handle, ds);
    expect(parseIdList(space!.enabledViews)).toEqual(['about']);
  });
});

describe('acorn open — owed remote setup survives denied storage (F4)', () => {
  /*
    localStorage is the intent's durability, not its existence: an embed that
    refuses every access still owes the meta write for the session. The create
    below fails after its intent is recorded, and the open that follows must
    still find the debt — in the session map the denied set fell back to.
  */
  it('keeps the owed meta write for the session when localStorage refuses every access', async () => {
    const acorn = fakeAcorn();
    acornPort = acorn.port;
    const stores = mountShell();
    await ready(stores);

    const denied = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(denied);

    // The create's own meta write is refused — the open fails with the debt unpaid.
    acorn.interactFails.add('create');
    await expect(stores.spaces.createAcornProject('Stored project', 'pass-phrase')).rejects.toThrow(
      'interact create refused',
    );
    const dsId = acorn.mountsOf.keys().next().value!;

    // Storage stayed denied, yet the next open pays the debt the session held.
    await expect(stores.spaces.openAcornProject(dsId)).resolves.toBe(dsId);
    expect(acorn.calls.filter((c) => c.includes('AcornProjectMeta'))).toHaveLength(2);
  });

  /*
    The intent is re-read when the queued work runs, not captured when it was
    queued: the second open below waits behind the first's meta write, and the
    clear that write performs must be what the second sees — a capture from
    before its wait would replay a debt already paid.
  */
  it('a queued open sees the debt the open ahead of it paid', async () => {
    seededDatasets = [{ id: 'ds-acorn', name: 'Acorn project' }];
    const acorn = fakeAcorn();
    acorn.mountsOf.set('ds-acorn', [LANG]);
    acornPort = acorn.port;
    // What an interrupted create left behind — the meta write is owed.
    localStorage.setItem(
      'we-acorn-setup:ds-acorn',
      JSON.stringify({ name: 'Acorn project', writeMeta: true, announce: false }),
    );
    const stores = mountShell();
    await ready(stores);

    // Hold the first open at the meta write, then queue the second behind it.
    let release!: () => void;
    acorn.interactGates.set('create', new Promise<void>((resolve) => (release = resolve)));
    const first = stores.spaces.openAcornProject('ds-acorn');
    await vi.waitFor(() => expect(acorn.calls.some((c) => c.includes('AcornProjectMeta'))).toBe(true));
    const second = stores.spaces.openAcornProject('ds-acorn');
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();

    // The first open was superseded — its work keeps, but the newer open lands.
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBe('ds-acorn');
    // One meta write total: the second open's read at run time saw the paid debt.
    expect(acorn.calls.filter((c) => c.includes('AcornProjectMeta'))).toHaveLength(1);
  });
});

describe('acorn open — the retried mount lookup (F5)', () => {
  /*
    A retried join finds the dataset its earlier attempt made by asking every
    dataset what it mounts. A mounts read that cannot answer is not "not
    mounted" — treating the error as absence resumes nothing and lets the retry
    mint a second dataset over the mount already there. The lookup has to fail
    so the caller comes back when the executor can answer again.
  */
  it('fails the join on an unreadable mount list instead of minting a second dataset', async () => {
    const acorn = fakeAcorn();
    acornPort = acorn.port;
    const stores = mountShell();
    await ready(stores);

    // A create that committed its mount and dataset before the meta write was
    // refused — the half-finished state a retried join must find, not redo.
    acorn.interactFails.add('create');
    await expect(stores.spaces.createAcornProject('Joined later', 'pass-phrase')).rejects.toThrow(
      'interact create refused',
    );
    const dsId = acorn.mountsOf.keys().next().value!;
    const datasetCount = stores.datasets.datasets().length;

    // Mount discovery cannot answer: the join must fail, not assume absence.
    acorn.mountsFailing.add(dsId);
    await expect(stores.spaces.joinAcornProject(LANG, 'pass-phrase')).rejects.toThrow('mounts unavailable');
    expect(stores.datasets.datasets()).toHaveLength(datasetCount);

    // Healed, the same join resumes the dataset the create made — still no second.
    acorn.mountsFailing.delete(dsId);
    await expect(stores.spaces.joinAcornProject(LANG, 'pass-phrase')).resolves.toBe(dsId);
    expect(stores.datasets.datasets()).toHaveLength(datasetCount);
  });
});
