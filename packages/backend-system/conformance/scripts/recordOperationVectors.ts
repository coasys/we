/**
 * Record the declared-operation vectors: run every case on the in-memory backend — the reference —
 * and write what each produced to `vectors/operations/operations.json`.
 *
 * Run after changing a case or the runner: `pnpm --filter @we/backend-conformance record:operations`.
 * Every backend's conformance suite then runs the same cases and compares with this file, so a
 * re-record is a change to the contract and its diff is what a reviewer reads.
 *
 * The in-memory backend is imported by path: it depends on this package for its own suite, so this
 * package depending back on it would make the two a cycle.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInMemoryBackendPorts } from '../../inmemory/src/lifecycle';
import { OPERATION_CASES, OPERATION_VECTORS_FILE, runOperationCase, vectorOf } from '../src/operations';

const AGENT = 'did:example:recorder';

const cases = [];
for (const [index, c] of OPERATION_CASES.entries()) {
  const id = `ds-record-${index}`;
  const ports = createInMemoryBackendPorts(
    { selfId: () => AGENT },
    { agent: { id: AGENT, unlocked: true }, datasets: [{ id, name: id }] },
  );
  const dataset = (await ports.lifecycle.get(id))!.handle;
  cases.push(vectorOf(c, await runOperationCase({ ports, dataset, agent: AGENT }, c)));
}

const file = fileURLToPath(OPERATION_VECTORS_FILE);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify({ version: 1, cases }, null, 2)}\n`);
console.log(`Recorded ${cases.length} operation vectors to ${file}`);
