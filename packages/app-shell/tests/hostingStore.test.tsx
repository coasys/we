/**
 * hostingStore: the host list it reads from the platform API and what it does when the index is down,
 * the choice it records for the join, and the operator's listing — what it sends, how it points the
 * device at the index first, and how the listing follows the backend's own state changes.
 */
import { render } from '@solidjs/testing-library';
import type {
  HostingIndexConfig,
  HostingPort,
  HostingStatusView,
  ListingText,
  OwnListingView,
} from '@we/backend-shared';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { provideSeed } from '../src/shared/seedRegistry';

const [ports, setPorts] = createSignal<{ hosting?: HostingPort } | null>(null);

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({ backendPorts: ports }),
}));

const [canAddCloud, setCanAddCloud] = createSignal(true);
const addCloudDevice = vi.fn(async (_address?: string) => ({ ok: true }));
vi.mock('../src/frameworks/solid/stores/DeviceStore', () => ({
  useDeviceStore: () => ({ canAddCloudDevice: canAddCloud, addCloudDevice }),
}));

import { type HostingStore, HostingStoreProvider, useHostingStore } from '../src/frameworks/solid/stores/HostingStore';

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 5; i++) await flush();
};

const INDEX = 'https://api.example/v1/index';

/** `null` is a deployment that names no platform API (`undefined` would take the default). */
function mount(platformApiUrl: string | null = 'https://api.example'): HostingStore {
  provideSeed({ name: 'test', modules: [], ...(platformApiUrl ? { platformApiUrl } : {}) } as never);
  let store!: HostingStore;
  function Capture() {
    store = useHostingStore();
    return null;
  }
  render(() => (
    <HostingStoreProvider>
      <Capture />
    </HostingStoreProvider>
  ));
  return store;
}

const text: ListingText = {
  name: 'Riverbank',
  description: 'For the river towns',
  location: 'Lyon',
  url: 'https://riverbank.example',
};

const listed = (over: Partial<OwnListingView> = {}): OwnListingView => ({
  ...text,
  listingId: 'l1',
  state: 'listed',
  reason: null,
  aiModels: [{ name: 'llama', kind: 'llm' }],
  rates: [{ description: 'link write', credits: 0.25 }],
  ...over,
});

function fakePort(initial: Partial<HostingStatusView> = {}) {
  let status: HostingStatusView = {
    config: { url: '', enabled: false },
    hasOperator: true,
    allowed: true,
    listing: null,
    remembered: null,
    indexError: null,
    ...initial,
  };
  const calls: string[] = [];
  const published: ListingText[] = [];
  let emit: (l: OwnListingView) => void = () => undefined;
  let stopped = false;
  const port: HostingPort = {
    async status() {
      calls.push('status');
      return status;
    },
    async configure(config: HostingIndexConfig) {
      calls.push('configure');
      status = { ...status, config };
      return config;
    },
    async publish(t) {
      calls.push('publish');
      published.push(t);
      const listing = listed({ ...t });
      status = { ...status, listing };
      return listing;
    },
    async withdraw() {
      calls.push('withdraw');
      status = { ...status, listing: listed({ state: 'withdrawn' }) };
    },
    onListingChanged(handler) {
      emit = handler;
      return () => {
        stopped = true;
      };
    },
  };
  return { port, calls, published, emit: (l: OwnListingView) => emit(l), stopped: () => stopped };
}

const hostBody = [
  {
    listingId: 'zed',
    name: 'Zed',
    description: '',
    location: 'Oslo',
    url: 'https://zed.example',
    runByCoasys: false,
    signup: 'anyone',
    full: false,
    freeAccess: true,
    aiModels: [],
    rates: [],
  },
  {
    listingId: 'cloud',
    name: 'Coasys cloud',
    description: '',
    location: '',
    url: 'https://cloud.example',
    runByCoasys: true,
    signup: 'by_invite',
    full: false,
    freeAccess: true,
    aiModels: [],
    rates: [],
  },
];

beforeEach(() => setPorts(null));
afterEach(() => vi.unstubAllGlobals());

describe('hostingStore: the host list', () => {
  it('reads the index the seed names, Coasys cloud first, and asks for nothing before it is told to', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => hostBody }) as unknown as Response);
    vi.stubGlobal('fetch', fetchFn);
    const store = mount();
    await settle();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(store.hostListState()).toBe('idle');
    await store.loadHosts();
    expect(fetchFn).toHaveBeenCalledWith(`${INDEX}/hosts`, expect.anything());
    expect(store.hostListState()).toBe('ready');
    expect(store.hosts().map((h) => h.name)).toEqual(['Coasys cloud', 'Zed']);
  });

  it('starts Add a cloud device with the host chosen: Coasys cloud with no address, another host by its address', async () => {
    setCanAddCloud(true);
    addCloudDevice.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => hostBody }) as unknown as Response),
    );
    const store = mount();
    await store.loadHosts();
    const ids = store.hosts().map((h) => ({ id: h.id, name: h.name }));
    await store.choose(ids.find((h) => h.name === 'Coasys cloud')!.id);
    expect(addCloudDevice).toHaveBeenLastCalledWith('');
    await store.choose('zed');
    expect(addCloudDevice).toHaveBeenLastCalledWith('https://zed.example');
    store.setAddress('riverbank.example');
    await store.chooseAddress();
    expect(addCloudDevice).toHaveBeenLastCalledWith('https://riverbank.example');
    expect(addCloudDevice).toHaveBeenCalledTimes(3);
  });

  it('only records the choice where this computer cannot add a cloud device', async () => {
    setCanAddCloud(false);
    addCloudDevice.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => hostBody }) as unknown as Response),
    );
    const store = mount();
    await store.loadHosts();
    await store.choose('zed');
    expect(store.chosen()).toMatchObject({ kind: 'listed' });
    expect(addCloudDevice).not.toHaveBeenCalled();
    setCanAddCloud(true);
  });

  it('says the index does not answer, lists no hosts, and still takes an address', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const store = mount();
    await store.loadHosts();
    expect(store.hostListState()).toBe('down');
    expect(store.hostListError()).toMatch(/^The hosting index does not answer/);
    expect(store.hosts()).toEqual([]);
    store.setAddress('riverbank.example');
    store.chooseAddress();
    expect(store.chosen()).toEqual({ kind: 'address', url: 'https://riverbank.example' });
  });

  /** AR-12 CB-08 (6): a host added by its address is never sent to the index. */
  it('sends the index no request that carries the address a person typed', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => hostBody }) as unknown as Response);
    vi.stubGlobal('fetch', fetchFn);
    const store = mount();
    await store.loadHosts();
    store.setAddress('unlisted.example');
    store.chooseAddress();
    await store.loadHosts();
    const sent = fetchFn.mock.calls.map((call) => JSON.stringify(call));
    expect(sent.some((s) => s.includes('unlisted.example'))).toBe(false);
    expect(store.chosen()).toEqual({ kind: 'address', url: 'https://unlisted.example' });
  });

  it('reads nothing where the deployment names no platform API', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const store = mount(null);
    await store.loadHosts();
    expect(store.hostListState()).toBe('unconfigured');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('records the host chosen, and refuses an address that is not https', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => hostBody }) as unknown as Response),
    );
    const store = mount();
    await store.loadHosts();
    store.choose('zed');
    expect(store.chosen()).toMatchObject({ kind: 'listed', host: { id: 'zed', url: 'https://zed.example' } });
    store.clearChoice();
    expect(store.chosen()).toBeNull();
    store.choose('not-there');
    expect(store.chosen()).toBeNull();
    store.setAddress('http://riverbank.example');
    expect(store.addressProblem()).toMatch(/address/);
    store.chooseAddress();
    expect(store.chosen()).toBeNull();
  });
});

describe('hostingStore: Earn with it', () => {
  it('offers nothing on a backend with no hosting port', async () => {
    const store = mount();
    await settle();
    expect(store.available()).toBe(false);
    expect(store.canOffer()).toBe(false);
    expect(store.listing()).toBeNull();
  });

  it('is unavailable on an executor that predates the index', async () => {
    const fake = fakePort();
    fake.port.status = async () => {
      throw new Error('Unknown type: index.status');
    };
    setPorts({ hosting: fake.port });
    const store = mount();
    await settle();
    expect(store.available()).toBe(false);
    expect(store.error()).toBe('');
  });

  it('says so when the index does not admit this identity, and offers no listing', async () => {
    setPorts({ hosting: fakePort({ allowed: false }).port });
    const store = mount();
    await settle();
    expect(store.notAllowed()).toBe(true);
    expect(store.canOffer()).toBe(false);
  });

  it('says so when the device has no operator', async () => {
    setPorts({ hosting: fakePort({ hasOperator: false, allowed: null }).port });
    const store = mount();
    await settle();
    expect(store.noOperator()).toBe(true);
    expect(store.canOffer()).toBe(false);
  });

  it('points the device at the index, then lists it with the text as typed', async () => {
    const fake = fakePort();
    setPorts({ hosting: fake.port });
    const store = mount();
    await settle();
    expect(store.canOffer()).toBe(true);
    expect(store.problem()).toMatch(/name/);
    expect(await store.publish()).toBe(false);
    expect(fake.calls).toEqual(['status']);

    store.setDraftField('name', ' Riverbank ');
    store.setDraftField('location', 'Lyon');
    store.setDraftField('description', 'For the river towns');
    store.setDraftField('url', 'riverbank.example');
    expect(store.problem()).toBe('');
    expect(await store.publish()).toBe(true);
    expect(fake.calls.slice(0, 3)).toEqual(['status', 'configure', 'publish']);
    expect(fake.published[0]).toEqual({ ...text, name: 'Riverbank', url: 'https://riverbank.example' });
    expect(store.listing()).toMatchObject({
      label: 'Listed',
      tone: 'success',
      confirmed: true,
      rates: ['link write: 0.25 credits'],
    });
    expect(store.isListed()).toBe(true);
  });

  it('does not set the index again when the device already calls it', async () => {
    const fake = fakePort({ config: { url: INDEX, enabled: true } });
    setPorts({ hosting: fake.port });
    const store = mount();
    await settle();
    ['name', 'location'].forEach((f) => store.setDraftField(f as 'name', f === 'name' ? 'Riverbank' : 'Lyon'));
    store.setDraftField('url', 'https://riverbank.example');
    await store.publish();
    expect(fake.calls).not.toContain('configure');
  });

  it('shows what a refused listing says, and keeps the draft', async () => {
    const fake = fakePort();
    fake.port.publish = async () => {
      throw new Error('This device is not a host.');
    };
    setPorts({ hosting: fake.port });
    const store = mount();
    await settle();
    store.setDraftField('name', 'Riverbank');
    store.setDraftField('location', 'Lyon');
    store.setDraftField('url', 'riverbank.example');
    expect(await store.publish()).toBe(false);
    expect(store.error()).toBe('This device is not a host.');
    expect(store.draft().name).toBe('Riverbank');
    expect(store.publishing()).toBe(false);
  });

  it('starts the draft from the listing the device already has, until the operator types', async () => {
    setPorts({ hosting: fakePort({ listing: listed() }).port });
    const store = mount();
    await settle();
    expect(store.draft()).toEqual(text);
  });

  it('withdraws at once, and shows the listing as not listed', async () => {
    const fake = fakePort({ listing: listed() });
    setPorts({ hosting: fake.port });
    const store = mount();
    await settle();
    expect(store.isListed()).toBe(true);
    expect(await store.withdraw()).toBe(true);
    expect(fake.calls).toContain('withdraw');
    expect(store.listing()).toMatchObject({ label: 'Not listed', line: 'Not listed.' });
    expect(store.isListed()).toBe(false);
  });

  it("follows the listing through the backend's own events: unreachable, then delisted with its reason", async () => {
    const fake = fakePort({ listing: listed() });
    setPorts({ hosting: fake.port });
    const store = mount();
    await settle();
    fake.emit(listed({ state: 'unreachable' }));
    expect(store.listing()).toMatchObject({ label: "Can't be reached", tone: 'warning' });
    expect(store.listing()?.line).toContain('https://riverbank.example');
    expect(store.isListed()).toBe(true);
    fake.emit(listed({ state: 'delisted', reason: 'charging' }));
    expect(store.listing()).toMatchObject({ label: 'Removed', tone: 'danger' });
    expect(store.listing()?.line).toMatch(/closed beta is free/);
    expect(store.isListed()).toBe(false);
  });

  it('shows what the device remembers while the index does not answer, and says so', async () => {
    setPorts({
      hosting: fakePort({ listing: null, remembered: listed(), indexError: 'the index did not answer' }).port,
    });
    const store = mount();
    await settle();
    expect(store.indexError()).toBe('the index did not answer');
    expect(store.listing()).toMatchObject({ name: 'Riverbank', confirmed: false });
  });
});
