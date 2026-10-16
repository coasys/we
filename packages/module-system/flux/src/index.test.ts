/**
 * The Flux module: it says which backend it needs, and its one read answers with nothing rather than
 * throwing wherever it cannot ask.
 */
import { fakeDeps } from '@we/module-testing';
import { describe, expect, it, vi } from 'vitest';

import { createFluxStore, fluxModule } from './index';

describe('the flux module', () => {
  it('declares the backend its query is written for', () => {
    expect(fluxModule.manifest.requires?.backends).toEqual(['ad4m']);
  });

  it('reads a subgroup’s messages from the space on screen, in order', async () => {
    const querySparql = vi.fn(async () => [
      { id: 'm1', author: 'did:a', timestamp: '1', body: 'hello' },
      { id: 'm2', author: 'did:b', timestamp: '2' },
    ]);
    const store = createFluxStore(fakeDeps({ dataset: () => ({ querySparql }) as never }));

    const messages = await store.subgroupMessages('flux://subgroup-1');

    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(messages[0]).toMatchObject({ author: 'did:a', body: 'hello' });
    expect(String((querySparql.mock.calls[0] as unknown[])[0])).toContain('<flux://subgroup-1> <flux://has_item> ?id');
  });

  it('answers with nothing outside a space', async () => {
    const store = createFluxStore(fakeDeps({ dataset: () => null }));
    await expect(store.subgroupMessages('flux://subgroup-1')).resolves.toEqual([]);
  });

  it('answers with nothing when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const querySparql = vi.fn(async () => {
      throw new Error('no such perspective');
    });
    const store = createFluxStore(fakeDeps({ dataset: () => ({ querySparql }) as never }));
    await expect(store.subgroupMessages('flux://subgroup-1')).resolves.toEqual([]);
  });
});
