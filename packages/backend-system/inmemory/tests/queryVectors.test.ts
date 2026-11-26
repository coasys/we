/**
 * The query vectors run from the file alone, the way an implementation that has never seen WE's
 * TypeScript would run them.
 *
 * The shared suite runs them on a backend that already holds WE's whole core manifest, with the
 * file's entities declared beside it. Here the backend is built from nothing but the file's
 * `entities`, so a case that leaned on WE's vocabulary would fail.
 */
import {
  type QueryVectorEnv,
  queryVectorTitle,
  readQueryVectors,
  runQueryVector,
  seedQueryDataset,
} from '@we/backend-conformance';
import { describe, expect, it } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const AGENT = 'did:test:somebody';
const file = readQueryVectors();

async function fresh(): Promise<QueryVectorEnv> {
  const ports = createInMemoryBackendPorts(
    { selfId: () => AGENT },
    {
      agent: { id: AGENT, unlocked: true },
      datasets: [{ id: 'ds-query-vectors', name: 'Query vectors' }],
      entities: { version: '1', entities: file.entities },
    },
  );
  const dataset = (await ports.lifecycle.get('ds-query-vectors'))!.handle;
  const bindings = ports.dataBindings({
    currentDataset: () => dataset,
    currentDatasetEntities: () => [],
    profiles: () => [],
    fetchProfile: () => {},
    ephemeral: ports.ephemeral,
  });
  await seedQueryDataset(dataset, file.dataset);
  return { bindings, dataset, agent: AGENT, settle: 200 };
}

describe('query vectors, from the file alone', () => {
  it('gives every case a level, a unique id and an expectation', () => {
    const ids = file.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of file.cases) {
      expect(c.id.startsWith(`query.${c.level}.`), c.id).toBe(true);
      expect(Object.keys(c.expect).length, c.id).toBeGreaterThan(0);
      if (c.level === 'live') expect(c.then, c.id).toBeDefined();
    }
  });

  for (const vector of file.cases) {
    it(queryVectorTitle(vector), async () => runQueryVector(await fresh(), file, vector));
  }
});
