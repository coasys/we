/**
 * Record the declared-operation vectors: run every case on the in-memory backend — the reference —
 * and write what each produced beside the entity schemas and the policy the cases run under: the
 * format's cases to `vectors/operations/operations.json`, WE's core operations' to
 * `vectors/operations/we-core/operations.json`.
 *
 * Run after changing a case or the runner: `pnpm --filter @we/backend-conformance record:operations`.
 * Every backend's conformance suite then runs the same cases and compares with this file, so a
 * re-record is a change to the contract and its diff is what a reviewer reads.
 *
 * The backend's agent is the file's invoker, so what the recording reads back is what the file says
 * with nothing translated.
 *
 * The in-memory backend is imported by path: it depends on this package for its own suite, so this
 * package depending back on it would make the two a cycle.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EntitySchema } from '@we/backend-shared';
import { format, resolveConfig } from 'prettier';

import { createInMemoryBackendPorts } from '../../inmemory/src/lifecycle';
import {
  FORMAT_VECTOR_SUITE,
  OPERATION_VECTOR_SUITES,
  runVector,
  VECTOR_INVOKER,
  vectorContext,
  vectorInput,
  vectorOf,
} from '../src/operations';

for (const suite of OPERATION_VECTOR_SUITES) {
  const context = vectorContext(suite);
  const cases = [];
  for (const [index, c] of suite.cases.entries()) {
    const id = `ds-record-${index}`;
    // The format's cases are recorded on a backend holding the file's entities and nothing else, so
    // nothing of WE's domain can leak into what they record; WE's own run on its whole manifest.
    const ports = createInMemoryBackendPorts(
      { selfId: () => VECTOR_INVOKER },
      {
        agent: { id: VECTOR_INVOKER, unlocked: true },
        datasets: [{ id, name: id }],
        ...(suite === FORMAT_VECTOR_SUITE
          ? { entities: { version: '1', entities: context.entities as Record<string, EntitySchema> } }
          : {}),
      },
    );
    const dataset = (await ports.lifecycle.get(id))!.handle;
    const subject = { ports, dataset, agent: VECTOR_INVOKER };
    cases.push(vectorOf(c, await runVector(subject, context, vectorInput(c))));
  }

  const file = fileURLToPath(suite.file);
  mkdirSync(dirname(file), { recursive: true });
  // Formatted as the repository formats JSON, so a re-record's diff is only what changed.
  const text = JSON.stringify({ ...context, cases }, null, 2);
  writeFileSync(file, await format(text, { ...(await resolveConfig(file)), filepath: file }));
  console.log(`Recorded ${cases.length} operation vectors to ${file}`);
}
