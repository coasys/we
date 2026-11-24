/**
 * Record the declared-operation vectors: run every case on the in-memory backend — the reference —
 * and write what each produced to `vectors/operations/operations.json`, beside the entity schemas
 * and the policy the cases run under.
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

import { format, resolveConfig } from 'prettier';

import { createInMemoryBackendPorts } from '../../inmemory/src/lifecycle';
import {
  OPERATION_CASES,
  OPERATION_VECTORS_FILE,
  runVector,
  VECTOR_INVOKER,
  vectorContext,
  vectorInput,
  vectorOf,
} from '../src/operations';

const context = vectorContext();
const cases = [];
for (const [index, c] of OPERATION_CASES.entries()) {
  const id = `ds-record-${index}`;
  const ports = createInMemoryBackendPorts(
    { selfId: () => VECTOR_INVOKER },
    { agent: { id: VECTOR_INVOKER, unlocked: true }, datasets: [{ id, name: id }] },
  );
  const dataset = (await ports.lifecycle.get(id))!.handle;
  const subject = { ports, dataset, agent: VECTOR_INVOKER };
  cases.push(vectorOf(c, await runVector(subject, context, vectorInput(c))));
}

const file = fileURLToPath(OPERATION_VECTORS_FILE);
mkdirSync(dirname(file), { recursive: true });
// Formatted as the repository formats JSON, so a re-record's diff is only what changed.
const text = JSON.stringify({ ...context, cases }, null, 2);
writeFileSync(file, await format(text, { ...(await resolveConfig(file)), filepath: file }));
console.log(`Recorded ${cases.length} operation vectors to ${file}`);
