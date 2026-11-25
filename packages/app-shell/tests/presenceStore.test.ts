/**
 * Live presence for the spaces that need it: the space on screen, and any space this agent is doing
 * something live in — opened once the first screen is up, joined with the profiles the cache holds,
 * and closed again when nothing holds it.
 *
 * A plain store test, run once under each reactivity port, over the in-memory backend's ephemeral
 * bus with a peer seeded into the shared space. The stores presence reads are stand-ins holding
 * signals of the port under test.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import type { AgentProfileSummary, EphemeralPort } from '@we/backend-shared';
import type { DatasetProxy } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFirstScreen, type FirstScreen } from '../src/shared/firstScreen';
import { createPresenceStore, type PresenceStore } from '../src/shared/stores/PresenceStore';

const ports: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

const ME = 'did:test:me';
const ADA = 'did:test:ada';
const GARDEN = 'inmemory://garden';
const PORCH = 'inmemory://porch';

type Dataset = { id: string; sharedUri?: string; handle: DatasetProxy };

describe.each(ports)('presenceStore, under %s', (_name, makePort) => {
  let port: ReactivityPort;
  const disposers: (() => void)[] = [];

  async function setUp(options: { held?: boolean } = {}) {
    const backend = createInMemoryBackendPorts(
      { selfId: () => ME },
      {
        agent: { id: ME, unlocked: true },
        datasets: [
          { id: 'garden', name: 'Garden', sharedUri: GARDEN },
          { id: 'porch', name: 'Porch', sharedUri: PORCH },
          { id: 'notes', name: 'Notes' },
        ],
        presence: [{ did: ADA, availability: 'available', focus: { datasetUri: GARDEN, path: '/space/garden/board' } }],
      },
    );
    const datasets: Dataset[] = [];
    for (const id of ['garden', 'porch', 'notes']) {
      const ref = (await backend.lifecycle.get(id))!;
      datasets.push({ id, sharedUri: ref.sharedUri, handle: ref.handle as DatasetProxy });
    }
    const opened: string[] = [];
    const closed: string[] = [];
    const ephemeralPort: EphemeralPort = (handle) => {
      const scope = backend.ephemeral(handle);
      if (!scope) return scope;
      const id = datasets.find((d) => d.handle === handle)?.id ?? '?';
      opened.push(id);
      return { ...scope, dispose: () => (closed.push(id), scope.dispose()) };
    };

    const [current, setCurrent] = port.signal<Dataset | null>(datasets[0]);
    const [profiles, setProfiles] = port.signal<AgentProfileSummary[]>([]);
    const [page, setPage] = port.signal('/space/garden/board');
    const fetchProfile = vi.fn(() => Promise.resolve());
    const firstScreen: FirstScreen = createFirstScreen({ signal: port.signal });
    if (options.held) firstScreen.hold();

    let store!: PresenceStore;
    disposers.push(
      port.root(() => {
        store = createPresenceStore({
          reactivity: port,
          firstScreen,
          sessionStore: { me: () => ({ did: ME }), ephemeralPort },
          datasetStore: {
            datasets: () => datasets,
            currentDataset: current,
            currentDatasetUri: () => current()?.sharedUri,
          },
          profileStore: { profiles, fetchProfile },
          routeStore: { page },
        });
      }),
    );
    return { store, datasets, setCurrent, setProfiles, setPage, fetchProfile, firstScreen, opened, closed };
  }

  beforeEach(() => {
    port = makePort();
    localStorage.clear();
  });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  const arrived = (store: PresenceStore) =>
    vi.waitFor(() => expect(store.online().map((p) => p.did)).toContain(ADA), { timeout: 3000, interval: 25 });

  it('sees who is in the space on screen, joined with their profile once it is cached', async () => {
    const h = await setUp();
    expect(h.opened).toEqual(['garden']);
    await arrived(h.store);
    expect(h.store.available()).toBe(true);
    // Not cached yet, so asked for — and joined the moment it lands.
    expect(h.fetchProfile).toHaveBeenCalledWith(ADA);
    h.setProfiles([{ did: ADA, handle: 'ada' } as AgentProfileSummary]);
    expect(h.store.online().find((p) => p.did === ADA)).toMatchObject({ handle: 'ada', tone: expect.any(String) });
  });

  it('says who is on this exact page', async () => {
    const h = await setUp();
    await arrived(h.store);
    expect(h.store.onlineHere().map((p) => p.did)).toContain(ADA);
    h.setPage('/space/garden/about');
    expect(h.store.onlineHere().map((p) => p.did)).not.toContain(ADA);
  });

  it('opens nothing until the first screen is up', async () => {
    const h = await setUp({ held: true });
    expect(h.opened).toEqual([]);
    h.firstScreen.answered();
    expect(h.opened).toEqual(['garden']);
  });

  it('has no presence in a space shared with nobody', async () => {
    const h = await setUp();
    h.setCurrent(h.datasets[2]);
    expect(h.closed).toEqual(['garden']);
    expect(h.store.available()).toBe(false);
    expect(h.store.online()).toEqual([]);
  });

  it('keeps a space open while an activity holds it, and lets it go when the activity ends', async () => {
    const h = await setUp();
    h.store.setActivity({ type: 'call', id: 'c1' } as never);
    h.setCurrent(h.datasets[1]);
    // Arriving in the porch opens it beside the garden, which the call still holds.
    expect(h.opened).toEqual(['garden', 'porch']);
    expect(h.closed).toEqual([]);

    h.store.clearActivity('call', 'c1');
    expect(h.closed).toEqual(['garden']);
  });

  it('closes every source when its owner is disposed', async () => {
    const h = await setUp();
    h.store.setActivity({ type: 'call', id: 'c1' } as never);
    h.setCurrent(h.datasets[1]);
    disposers.splice(0).forEach((dispose) => dispose());
    expect(h.closed.sort()).toEqual(['garden', 'porch']);
  });

  it('keeps the focus depth and availability it is given', async () => {
    const h = await setUp();
    h.store.setFocusDepth('space');
    expect(h.store.focusDepth()).toBe('space');
    h.store.setAvailability('away');
    h.store.setAvailability('away');
    expect(h.opened).toEqual(['garden']);
  });
});
