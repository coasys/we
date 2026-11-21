/**
 * The hosting port reads what the executor's `index.*` calls answer: the listing and its state, the
 * status while the index is down, and what to do with a listing in a state this build does not know
 * or a method an executor lacks.
 */
import type { Ad4mClient, HostingIndexClient } from '@coasys/ad4m';
import { describe, expect, it, vi } from 'vitest';

import { createAd4mHostingPort, readHostingStatus, readListing } from './hostingPort';
import { missingExecutorMethods, resetMissingExecutorMethods } from './missingMethods';

type IndexStatus = Awaited<ReturnType<HostingIndexClient['status']>>;
type OwnListing = Awaited<ReturnType<HostingIndexClient['publish']>>;

const listing: OwnListing = {
  listingId: 'l1',
  name: 'Riverbank',
  description: 'A host for the river towns',
  location: 'Lyon',
  url: 'https://riverbank.example',
  executorDid: 'did:key:z6MkExec',
  operatorDid: 'did:scid:coasys:1:QmScid',
  runByCoasys: false,
  aiModels: [
    { name: 'llama', kind: 'llm' },
    { name: 'unknown-kind', kind: 'video' },
  ],
  rates: [{ description: 'link write', priceInHOT: 0.25, unit: 'credits' }],
  signup: 'by_invite',
  admitsGuests: false,
  freeAccess: true,
  full: false,
  approval: { kind: 'allow-list', since: '2026-10-01' },
  lastSeenAt: '2026-11-01T00:00:00Z',
  version: '0.13.1',
  state: 'delisted',
  reason: 'charging',
};

const off: IndexStatus = {
  config: { url: '', enabled: false },
  scid: null,
  executorDid: null,
  allowed: null,
  listing: null,
  local: null,
  indexError: null,
};

describe('readListing', () => {
  it('reads the text, the state and its reason, and drops a model kind it does not know', () => {
    expect(readListing(listing)).toEqual({
      listingId: 'l1',
      name: 'Riverbank',
      description: 'A host for the river towns',
      location: 'Lyon',
      url: 'https://riverbank.example',
      state: 'delisted',
      reason: 'charging',
      aiModels: [{ name: 'llama', kind: 'llm' }],
      rates: [{ description: 'link write', credits: 0.25 }],
    });
  });

  it('is null for a state this build does not know', () => {
    expect(readListing({ ...listing, state: 'banned' })).toBeNull();
  });

  it('has no reason once the listing is listed', () => {
    expect(readListing({ ...listing, state: 'listed', reason: null })?.reason).toBeNull();
  });
});

describe('readHostingStatus', () => {
  it('shows what the device remembers while the index did not answer', () => {
    const status = readHostingStatus({
      ...off,
      config: { url: 'https://api.example/v1/index', enabled: true },
      scid: 'QmScid',
      executorDid: 'did:key:z6MkExec',
      local: {
        listingId: 'l1',
        draft: { name: 'Riverbank', description: 'd', location: 'Lyon', url: 'https://riverbank.example' },
        state: 'listed',
        reason: null,
        publishedAt: 1,
        ratesHash: 'ab',
      },
      indexError: 'the index did not answer',
    });
    expect(status.config).toEqual({ url: 'https://api.example/v1/index', enabled: true });
    expect(status.hasOperator).toBe(true);
    expect(status.allowed).toBeNull();
    expect(status.listing).toBeNull();
    expect(status.remembered).toMatchObject({ name: 'Riverbank', state: 'listed', url: 'https://riverbank.example' });
    expect(status.indexError).toBe('the index did not answer');
  });

  it('is off, with no operator and no listing, when the index is off', () => {
    expect(readHostingStatus(off)).toEqual({
      config: { url: '', enabled: false },
      hasOperator: false,
      allowed: null,
      listing: null,
      remembered: null,
      indexError: null,
    });
  });
});

describe('createAd4mHostingPort', () => {
  function client() {
    const handlers: ((value: OwnListing) => void)[] = [];
    const hostingIndex = {
      configure: vi.fn(async (c: IndexStatus['config']) => c),
      status: vi.fn(async (): Promise<IndexStatus> => off),
      publish: vi.fn(async (_text: unknown): Promise<OwnListing> => listing),
      withdraw: vi.fn(async () => true),
      onListingChanged: vi.fn((handler: (value: OwnListing) => void) => {
        handlers.push(handler);
        return () => handlers.splice(handlers.indexOf(handler), 1);
      }),
    };
    return { handlers, hostingIndex, ad4m: { hostingIndex } as unknown as Ad4mClient };
  }

  it("sends the operator's text as typed and returns the listing as read", async () => {
    const c = client();
    const port = createAd4mHostingPort(c.ad4m);
    const text = { name: 'Riverbank', description: 'd', location: 'Lyon', url: 'https://riverbank.example' };
    const published = await port.publish(text);
    expect(c.hostingIndex.publish).toHaveBeenCalledWith(text);
    expect(published.state).toBe('delisted');
    await port.withdraw();
    expect(c.hostingIndex.withdraw).toHaveBeenCalledOnce();
    expect(await port.configure({ url: 'https://api.example/v1/index', enabled: true })).toEqual({
      url: 'https://api.example/v1/index',
      enabled: true,
    });
  });

  it('refuses a published answer in a state it does not know', async () => {
    const c = client();
    c.hostingIndex.publish = vi.fn(async (_text: unknown): Promise<OwnListing> => ({ ...listing, state: 'banned' }));
    await expect(
      createAd4mHostingPort(c.ad4m).publish({ name: 'a', description: '', location: '', url: 'https://a.example' }),
    ).rejects.toThrow(/cannot read/);
  });

  it('passes on a listing change, and not one in a state it does not know', () => {
    const c = client();
    const seen: string[] = [];
    const stop = createAd4mHostingPort(c.ad4m).onListingChanged((l) => seen.push(l.state));
    c.handlers[0](listing);
    c.handlers[0]({ ...listing, state: 'banned' });
    expect(seen).toEqual(['delisted']);
    stop();
    expect(c.handlers).toHaveLength(0);
  });

  it('records an executor that predates the calls and throws the refusal as it came', async () => {
    resetMissingExecutorMethods();
    const c = client();
    c.hostingIndex.status = vi.fn(async (): Promise<IndexStatus> => {
      throw new Error('Unknown type: index.status');
    });
    await expect(createAd4mHostingPort(c.ad4m).status()).rejects.toThrow(/Unknown type/);
    expect(missingExecutorMethods().map((m) => m.method)).toContain('index.status');
  });
});
