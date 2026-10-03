/**
 * The AD4M backend against the shared conformance suite, on a real executor.
 *
 * Run with `pnpm --filter @we/backend-ad4m test:live`; `executor.ts` starts the executor. Each case
 * gets a perspective of its own with the space SDNA installed, and loses it afterwards.
 *
 * Writes come back over the executor's subscription socket rather than synchronously, so a case
 * waits seconds for them. The known gaps are the executor's, and each one says what is wrong.
 */
import { Ad4mClient } from '@coasys/ad4m';
import { describeBackendConformance } from '@we/backend-conformance';
import type { BackendPorts } from '@we/backend-shared';
import { afterAll, inject } from 'vitest';

import { createAd4mBackendPorts } from '../../src/backendPortsAdapter';

let backend: Promise<{ client: Ad4mClient; ports: BackendPorts; agent: string }> | undefined;

/** One client and one ports bundle for the whole file, built on first use. */
function connect() {
  backend ??= (async () => {
    const { url, token } = inject('ad4mExecutor');
    const client = new Ad4mClient(url, token);
    const agent = (await client.agent.me()).did;
    return { client, ports: createAd4mBackendPorts(client, { selfId: () => agent }), agent };
  })();
  return backend;
}

// An open socket keeps the run alive after the last test, and then outlives the executor.
afterAll(async () => (await backend)?.client.close());

const datasetIds = new WeakMap<object, string>();

describeBackendConformance('AD4M', {
  async setup() {
    const { ports, agent } = await connect();
    const ref = await ports.lifecycle.create(`conformance-${Date.now()}`);
    await ports.schemas.installSpace(ref.handle, []);
    datasetIds.set(ref.handle as object, ref.id);
    return { ports, dataset: ref.handle, agent };
  },
  async teardown(subject) {
    const id = datasetIds.get(subject.dataset as object);
    if (id) await subject.ports.lifecycle.remove(id);
  },
  timing: { settle: 10_000, quiet: 2_000 },
  knownGaps: {
    'live.included-child-edit':
      "a model subscription re-runs only for its own class's predicates; an included record's are not in its trigger set",
    'live.identical-queries-independent':
      'identical subscriptions share one server-side id with no holder count, so disposing one ends both',
  },
  knownIntermittent: {
    // Seen in 3 of 10 runs, only ever on the first post in a fresh perspective: the first two
    // children read back swapped. The issue names the two likely causes.
    'relations.ordered-read':
      'the first ordered write after the space SDNA is installed sometimes reads back with its first two members swapped (coasys/ad4m#1304)',
  },
});
