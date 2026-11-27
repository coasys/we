/**
 * The operation vectors run from the file alone, the way an implementation that has never seen WE's
 * TypeScript would run them.
 *
 * Both files: the format's, over its neutral entities, and WE's core operations', over WE's. The
 * shared suite runs them on a backend that already holds WE's whole core manifest and its own
 * operations, so a vector that leaned on either would still pass there. Here the backend is built
 * from nothing but the file's `entities`, and each vector's `calls` are the only operations the
 * `core` namespace holds while it runs, so a schema or a callee the file leaves out fails a case.
 */
import { OPERATION_VECTOR_SUITES, readOperationVectors, runVector } from '@we/backend-conformance';
import type { EntitySchema } from '@we/backend-shared';
import { registerOperations } from '@we/entities';
import { CORE_OPERATIONS } from '@we/entities/manifest';
import { afterAll, describe, expect, it } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const AGENT = 'did:test:somebody';

for (const suite of OPERATION_VECTOR_SUITES) {
  const file = readOperationVectors(suite);

  describe(`operation vectors (${suite.profile}), from the file alone`, () => {
    // Put back the namespace the vectors replaced, for whatever else runs in this worker.
    afterAll(() => registerOperations('core', CORE_OPERATIONS));

    it('lists every protected entity among its entities', () => {
      for (const name of file.protectedEntities) expect(file.entities[name], name).toBeDefined();
    });

    for (const vector of file.cases) {
      it(vector.note, async () => {
        const ports = createInMemoryBackendPorts(
          { selfId: () => AGENT },
          {
            agent: { id: AGENT, unlocked: true },
            datasets: [{ id: 'ds-vectors', name: 'Vectors' }],
            entities: { version: '1', entities: file.entities as Record<string, EntitySchema> },
          },
        );
        const dataset = (await ports.lifecycle.get('ds-vectors'))!.handle;
        registerOperations('core', {});
        const produced = await runVector({ ports, dataset, agent: AGENT }, file, vector, { registerCalls: true });
        expect(produced).toEqual({ outcome: vector.outcome, records: vector.records });
      });
    }
  });
}
