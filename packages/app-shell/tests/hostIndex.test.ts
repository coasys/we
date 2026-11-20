/**
 * The host list's reads and words: what the index sends becomes entries in the order a person should
 * see them, an address typed becomes an `https` origin or nothing, and a listing's state reads as
 * the sentence its operator needs.
 */
import { describe, expect, it, vi } from 'vitest';

import { hostIndexUrl, normaliseHostAddress, orderHosts, readHostEntry, readHostIndex } from '../src/shared/hostIndex';
import {
  canJoin,
  chargeLine,
  hostRow,
  listingLine,
  listingProblem,
  rateLines,
  signupLine,
  trimmedListing,
} from '../src/shared/hostingRows';

const raw = (over: Record<string, unknown> = {}) => ({
  listingId: 'l1',
  name: 'Riverbank',
  description: 'For the river towns',
  location: 'Lyon',
  url: 'https://riverbank.example',
  runByCoasys: false,
  aiModels: [{ name: 'llama', kind: 'llm' }],
  rates: [
    { description: 'link write', priceInHOT: 0.25, unit: 'credits' },
    { description: 'llama', priceInHOT: 1, unit: 'credits' },
  ],
  signup: 'by_invite',
  admitsGuests: false,
  freeAccess: true,
  full: false,
  ...over,
});

describe('hostIndexUrl', () => {
  it('is the index under the platform API, and nothing without one', () => {
    expect(hostIndexUrl('https://api.example')).toBe('https://api.example/v1/index');
    expect(hostIndexUrl('https://api.example/')).toBe('https://api.example/v1/index');
    expect(hostIndexUrl(undefined)).toBeNull();
  });
});

describe('readHostEntry', () => {
  it('reads a listing worded for a row', () => {
    const entry = readHostEntry(raw())!;
    expect(entry).toMatchObject({ id: 'l1', name: 'Riverbank', url: 'https://riverbank.example', signup: 'by_invite' });
    expect(hostRow(entry)).toMatchObject({
      details: 'Lyon · For the river towns',
      signup: 'By invite',
      charge: 'link write: 0.25 credits · llama: 1 credit · Free during the closed beta',
      models: 'llama',
      joinable: true,
    });
  });

  it('skips an entry with no id or no address a person could join', () => {
    expect(readHostEntry(raw({ listingId: '' }))).toBeNull();
    expect(readHostEntry(raw({ url: 'http://riverbank.example' }))).toBeNull();
    expect(readHostEntry(null)).toBeNull();
  });

  it('reads a sign-up setting it does not know as closed', () => {
    const entry = readHostEntry(raw({ signup: 'whoever' }))!;
    expect(entry.signup).toBe('no_one');
    expect(canJoin(entry)).toBe(false);
  });

  it('shows no hourly rate and no "an hour" text', () => {
    const entry = readHostEntry(raw())!;
    expect(hostRow(entry).charge).not.toMatch(/hour/i);
  });
});

describe('who may join', () => {
  it('names the sign-up setting, and a full host before it', () => {
    expect(signupLine({ signup: 'anyone', full: false })).toBe('Anyone can join');
    expect(signupLine({ signup: 'by_invite', full: false })).toBe('By invite');
    expect(signupLine({ signup: 'no_one', full: false })).toBe('Not taking new people');
    expect(signupLine({ signup: 'anyone', full: true })).toBe('Full');
    expect(canJoin({ signup: 'anyone', full: true })).toBe(false);
  });

  it('says nothing about free access when the host charges', () => {
    expect(chargeLine({ rates: [{ description: 'link write', credits: 2 }], freeAccess: false })).toBe(
      'link write: 2 credits',
    );
    expect(rateLines([])).toEqual([]);
  });
});

describe('orderHosts', () => {
  it('puts Coasys cloud first and the rest by name', () => {
    const named = (name: string, runByCoasys = false) => readHostEntry(raw({ name, runByCoasys, listingId: name }))!;
    expect(orderHosts([named('Zed'), named('alder'), named('Coasys cloud', true)]).map((h) => h.name)).toEqual([
      'Coasys cloud',
      'alder',
      'Zed',
    ]);
  });
});

describe('readHostIndex', () => {
  const answer = (body: unknown, ok = true, status = 200) =>
    vi.fn(async () => ({ ok, status, json: async () => body }) as unknown as Response);

  it('asks the index for its hosts and returns them in order', async () => {
    const fetchFn = answer([
      raw({ name: 'Zed', listingId: 'z' }),
      raw({ name: 'Cloud', listingId: 'c', runByCoasys: true }),
    ]);
    const hosts = await readHostIndex('https://api.example/v1/index', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('https://api.example/v1/index/hosts', expect.anything());
    expect(hosts.map((h) => h.name)).toEqual(['Cloud', 'Zed']);
  });

  it('throws when the index does not answer well, or answers something else', async () => {
    await expect(readHostIndex('https://api.example/v1/index', answer({}, false, 503))).rejects.toThrow(/503/);
    await expect(readHostIndex('https://api.example/v1/index', answer({ hosts: [] }))).rejects.toThrow(/not a list/);
    await expect(
      readHostIndex(
        'https://api.example/v1/index',
        vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
      ),
    ).rejects.toThrow(/Failed to fetch/);
  });
});

describe('normaliseHostAddress', () => {
  it('is the https origin of what was typed', () => {
    expect(normaliseHostAddress('riverbank.example')).toBe('https://riverbank.example');
    expect(normaliseHostAddress(' https://riverbank.example/some/page?x=1 ')).toBe('https://riverbank.example');
    expect(normaliseHostAddress('https://riverbank.example:8443')).toBe('https://riverbank.example:8443');
  });

  it('refuses plain http, other schemes, credentials and nothing', () => {
    for (const bad of [
      'http://riverbank.example',
      'ftp://riverbank.example',
      'https://u:p@riverbank.example',
      '',
      '  ',
      'https://',
    ]) {
      expect(normaliseHostAddress(bad)).toBeNull();
    }
  });
});

describe('listing words', () => {
  it('says why the index took a listing down, with the fix', () => {
    expect(listingLine({ state: 'delisted', reason: 'charging', url: 'https://a.example' })).toMatch(
      /closed beta is free/,
    );
    expect(listingLine({ state: 'delisted', reason: 'not-allowed', url: 'https://a.example' })).toMatch(
      /no longer on the hosting index's list/,
    );
    expect(listingLine({ state: 'delisted', reason: 'key-refused', url: 'https://a.example' })).toMatch(
      /key was removed/,
    );
    expect(listingLine({ state: 'delisted', reason: 'a-reason-from-later', url: 'https://a.example' })).toBe(
      'The hosting index removed this listing.',
    );
  });

  it('names the address the index cannot reach', () => {
    expect(listingLine({ state: 'unreachable', reason: null, url: 'https://a.example' })).toContain(
      'https://a.example',
    );
    expect(listingLine({ state: 'listed', reason: null, url: '' })).toMatch(/^Listed/);
    expect(listingLine({ state: 'withdrawn', reason: null, url: '' })).toBe('Not listed.');
  });
});

describe('listingProblem', () => {
  const ok = { name: 'Riverbank', description: '', location: 'Lyon', url: 'riverbank.example' };

  it('is empty for a draft the index could take, and trims it as sent', () => {
    expect(listingProblem(ok)).toBe('');
    expect(trimmedListing({ ...ok, name: '  Riverbank ' })).toEqual({
      name: 'Riverbank',
      description: '',
      location: 'Lyon',
      url: 'https://riverbank.example',
    });
  });

  it('names what is missing or too long, the first one', () => {
    expect(listingProblem({ ...ok, name: ' ' })).toMatch(/name/);
    expect(listingProblem({ ...ok, name: 'x'.repeat(61) })).toMatch(/60/);
    expect(listingProblem({ ...ok, location: '' })).toMatch(/where/);
    expect(listingProblem({ ...ok, description: 'x'.repeat(501) })).toMatch(/500/);
    expect(listingProblem({ ...ok, url: 'http://riverbank.example' })).toMatch(/https/);
  });
});
