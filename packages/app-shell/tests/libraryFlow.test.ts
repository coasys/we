/**
 * The publish, share and install flow templates and themes share, against a record type the test
 * holds in memory — run once under each reactivity port.
 *
 * What is pinned is the flow itself: who may update a listing, that pictures are uploaded before the
 * old ones go, what a person is asked before an install and what they are told when one fails, and
 * that every step says what it is doing through the one loading signal.
 */
import type { ReactivityPort } from '@we/reactivity';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestPlatform } from '../src/shared/platform/testPlatform';
import {
  createLibraryFlow,
  type InstallDestination,
  type LibraryEntity,
  type LibraryFlow,
  type LibraryRecord,
} from '../src/shared/stores/libraryFlow';
import { reactivityPorts } from './support/engines';

const ME = 'did:test:me';

interface Held extends LibraryRecord {
  dataset: string;
  origin?: string;
  content?: string;
  saved: number;
  screenshots: unknown[];
}

/** One record type, held per dataset; every record knows the dataset it lives in. */
function heldEntity() {
  const rows: Held[] = [];
  let next = 0;
  const entity: LibraryEntity<Held> = {
    async findOne(dataset, { where }) {
      return rows.find(
        (row) =>
          row.dataset === dataset && Object.entries(where).every(([key, value]) => row[key as keyof Held] === value),
      );
    },
    async create(dataset, data) {
      const row: Held = {
        id: `rec-${++next}`,
        name: '',
        author: ME,
        saved: 0,
        screenshots: [],
        ...(data as Partial<Held>),
        dataset: dataset as string,
        async save() {
          row.saved++;
        },
        async delete() {
          rows.splice(rows.indexOf(row), 1);
        },
        async setScreenshots(images) {
          row.screenshots = images;
        },
      };
      rows.push(row);
      return row;
    },
  };
  return { rows, entity };
}

type Judged = { listingId: string; content?: string; destination: InstallDestination };

describe.each(reactivityPorts)('the library flow under %s', (_name, makePort) => {
  let reactivity: ReactivityPort;
  let held: ReturnType<typeof heldEntity>;
  let told: string[];
  let applied: { judged: Judged; destination: InstallDestination; loading: string | null }[];
  let marketplace: string | undefined;
  let space: string | undefined;
  let failApply: Error | undefined;
  const disposers: (() => void)[] = [];

  function mount(asks: boolean): LibraryFlow<Judged> {
    let flow!: LibraryFlow<Judged>;
    disposers.push(
      reactivity.root(() => {
        flow = createLibraryFlow<Held, Judged>({
          reactivity,
          images: createTestPlatform().images,
          toasts: {
            info: (m) => told.push(m),
            success: (m) => told.push(m),
            warning: (m) => told.push(`warning: ${m}`),
            error: (m) => told.push(`error: ${m}`),
          },
          entity: held.entity,
          noun: 'widget',
          marketplace: () => marketplace,
          space: () => space,
          datasetOf: (id) => (id === 'joined' ? 'joined' : undefined),
          me: () => ME,
          judge: (listing, destination) =>
            listing.content === 'broken'
              ? { refused: 'That widget is broken' }
              : { listingId: listing.id, content: listing.content, destination },
          asks,
          confirmNote: (judged) => (judged.content === 'partial' ? 'Some of it will not run' : undefined),
          apply: async (judged, destination) => {
            applied.push({ judged, destination, loading: reactivity.untrack(flow.operationLoading) });
            if (failApply) throw failApply;
          },
        });
      }),
    );
    return flow;
  }

  beforeEach(() => {
    reactivity = makePort();
    held = heldEntity();
    told = [];
    applied = [];
    marketplace = 'market';
    space = 'space';
    failApply = undefined;
  });

  afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
  });

  const publishRequest = (content: string, screenshots: File[] = []) => ({
    name: 'Garden',
    description: 'Green',
    icon: 'leaf',
    slug: 'garden',
    content: { content },
    screenshots,
  });

  it('publishes a listing, then updates its own in place', async () => {
    const flow = mount(false);
    const loading: (string | null)[] = [];
    disposers.push(reactivity.root(() => reactivity.effect(() => void loading.push(flow.operationLoading()))));

    expect(await flow.publish(publishRequest('v1'))).toBe(true);
    expect(held.rows).toMatchObject([{ slug: 'garden', origin: 'marketplace', version: 1, content: 'v1' }]);
    expect(loading).toContain('publish-marketplace');
    expect(reactivity.untrack(flow.operationLoading)).toBeNull();

    expect(await flow.publish(publishRequest('v2'))).toBe(true);
    expect(held.rows).toHaveLength(1);
    expect(held.rows[0]).toMatchObject({ version: 2, content: 'v2', saved: 1 });
    expect(told).toEqual(['Widget "Garden" published to marketplace', 'Widget "Garden" updated in marketplace (v2)']);
  });

  it('refuses a slug somebody else published under', async () => {
    const flow = mount(false);
    await held.entity.create('market', { slug: 'garden', author: 'did:test:other', content: 'theirs' });
    expect(await flow.publish(publishRequest('mine'))).toBe(false);
    expect(held.rows[0].content).toBe('theirs');
    expect(told).toEqual([
      'error: A widget with slug "garden" already exists in the marketplace by a different author',
    ]);
  });

  it('keeps a listing as it was when a new picture fails to upload', async () => {
    const flow = mount(false);
    const listing = await held.entity.create('market', { slug: 'garden', content: 'v1', version: 1 });
    listing.screenshots = ['old'];
    // Not an image: compressing it fails before anything is written.
    const notAPicture = new File(['not an image'], 'shot.png', { type: 'image/png' });

    expect(await flow.publish(publishRequest('v2', [notAPicture]))).toBe(false);
    expect(listing).toMatchObject({ content: 'v1', version: 1, saved: 0, screenshots: ['old'] });
    expect(told).toHaveLength(1);
    expect(told[0]).toMatch(/^error: Could not publish that widget to the marketplace/);
    expect(reactivity.untrack(flow.operationLoading)).toBeNull();
  });

  it('says so when there is no marketplace to publish to, read from or take down from', async () => {
    marketplace = undefined;
    const flow = mount(false);
    expect(await flow.publish(publishRequest('v1'))).toBe(false);
    await flow.removeListing('rec-1');
    await flow.install('rec-1', 'personal');
    expect(told).toEqual([
      'error: Marketplace not connected',
      'error: Marketplace not connected',
      'error: Cannot install: marketplace not connected',
    ]);
  });

  it('takes a listing down, and says so when it is already gone', async () => {
    const flow = mount(false);
    const listing = await held.entity.create('market', { slug: 'garden' });
    await flow.removeListing(listing.id);
    expect(held.rows).toEqual([]);
    await flow.removeListing(listing.id);
    expect(told).toEqual(['error: Widget not found in marketplace']);
  });

  it('shares a copy into a joined space once, and refuses a second', async () => {
    const flow = mount(false);
    const request = { datasetId: 'joined', spaceName: 'Allotment', name: 'Garden', slug: 'garden', content: {} };
    expect(await flow.share(request)).toBe(true);
    expect(held.rows).toMatchObject([{ dataset: 'joined', slug: 'garden', origin: 'shared', version: 1 }]);
    expect(await flow.share(request)).toBe(false);
    expect(await flow.share({ ...request, datasetId: 'elsewhere' })).toBe(false);
    expect(told).toEqual([
      'Widget "Garden" shared to space "Allotment"',
      'error: Widget "Garden" is already in "Allotment"',
      'error: Space not found',
    ]);
  });

  it('installs straight away where the kind does not ask, saying what it is doing', async () => {
    const flow = mount(false);
    const listing = await held.entity.create('market', { slug: 'garden', content: 'fine' });
    await flow.install(listing.id, 'personal');
    await flow.install(listing.id, 'space');
    expect(applied.map(({ destination, loading }) => [destination, loading])).toEqual([
      ['personal', `marketplace-install:${listing.id}`],
      ['space', `space-install:${listing.id}`],
    ]);
    expect(reactivity.untrack(flow.pendingInstall)).toBeNull();
  });

  it('holds a judged listing for a person to confirm where the kind asks', async () => {
    const flow = mount(true);
    const shown: (Judged | null)[] = [];
    disposers.push(reactivity.root(() => reactivity.effect(() => void shown.push(flow.pendingInstall()))));
    const listing = await held.entity.create('market', { slug: 'garden', content: 'partial' });

    await flow.install(listing.id, 'space');
    expect(applied).toEqual([]);
    expect(shown.at(-1)).toEqual({ listingId: listing.id, content: 'partial', destination: 'space' });

    await flow.confirmInstall();
    expect(shown.at(-1)).toBeNull();
    expect(applied).toMatchObject([{ destination: 'space', loading: `space-install:${listing.id}` }]);
    expect(told).toEqual(['warning: Some of it will not run']);

    // Cancelling writes nothing, and a confirm with nothing waiting does nothing.
    await flow.install(listing.id, 'personal');
    flow.cancelInstall();
    await flow.confirmInstall();
    expect(applied).toHaveLength(1);
  });

  it('tells a person why a listing was not installed', async () => {
    const flow = mount(true);
    const broken = await held.entity.create('market', { slug: 'broken', content: 'broken' });
    await flow.install(broken.id, 'personal');
    await flow.install('rec-missing', 'personal');
    space = undefined;
    await flow.install(broken.id, 'space');
    expect(told).toEqual([
      'error: That widget is broken',
      'error: Widget not found in marketplace',
      'error: Cannot install: no active space',
    ]);
    expect(reactivity.untrack(flow.pendingInstall)).toBeNull();
    expect(reactivity.untrack(flow.operationLoading)).toBeNull();
  });

  it('reports a write that fails, and stops saying it is busy', async () => {
    const flow = mount(false);
    const listing = await held.entity.create('market', { slug: 'garden', content: 'fine' });
    failApply = new Error('disk full');
    await flow.install(listing.id, 'space');
    expect(told).toEqual(['error: Could not install that widget into this space']);
    expect(reactivity.untrack(flow.operationLoading)).toBeNull();
  });
});
