/**
 * The query vectors' known gaps that need no executor to check: which cases this adapter refuses to
 * send. Every vector is routed through the adapter as the live suite routes it, and the list in
 * `live/queryVectorGaps.ts` must name exactly the ones refused that the file expects answered. A new
 * vector the adapter refuses, or a refusal lifted, fails here before a live run has to find it.
 */
import { queryVectorManifest, readQueryVectors } from '@we/backend-conformance';
import { type FlatQuery, manifestEntries, routeQuery } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { describe, expect, it } from 'vitest';

import { createAd4mQueryAdapter } from '../src/ad4mAdapter';
import { manifestToEntries } from '../src/manifestCompiler';
import type { EntityManifestEntry } from '../src/manifestTypes';
import { EXECUTOR_QUERY_VECTORS, REFUSED_QUERY_VECTORS } from './live/queryVectorGaps';

const file = readQueryVectors();
const entries = [
  ...manifestEntries(CORE_MANIFEST),
  ...manifestToEntries(queryVectorManifest(file), { moduleId: 'query-vectors' }),
] as unknown as EntityManifestEntry[];
const adapter = createAd4mQueryAdapter(() => entries);

/** Whether the adapter refuses any entity of the case's query. */
function refused(query: Record<string, unknown>): boolean {
  const { entity, when: _when, ...rest } = query;
  return (Array.isArray(entity) ? entity : [entity]).some(
    (name) => !routeQuery({ ...rest, entity: name } as FlatQuery, adapter).ok,
  );
}

describe('query vectors this adapter refuses', () => {
  it('are exactly the ones listed as refused', () => {
    const found = file.cases
      .filter((c) => !('refused' in c.expect) && refused(c.query))
      .map((c) => c.id)
      .sort();
    expect(found).toEqual(Object.keys(REFUSED_QUERY_VECTORS).sort());
  });

  it('list only cases the file has, each once', () => {
    const ids = new Set(file.cases.map((c) => c.id));
    for (const id of [...Object.keys(REFUSED_QUERY_VECTORS), ...Object.keys(EXECUTOR_QUERY_VECTORS)]) {
      expect(ids.has(id), id).toBe(true);
    }
    for (const id of Object.keys(EXECUTOR_QUERY_VECTORS)) expect(REFUSED_QUERY_VECTORS[id], id).toBeUndefined();
  });
});
