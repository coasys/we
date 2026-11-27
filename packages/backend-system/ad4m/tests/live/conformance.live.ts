/**
 * The AD4M backend against the shared conformance suite, on a real executor.
 *
 * Run with `pnpm --filter @we/backend-ad4m test:live`; `executor.ts` starts the executor. Each case
 * gets a perspective of its own and loses it afterwards. It holds the space SDNA and the root SDNA
 * both, so every record type WE has is there: the operations suite seeds per-agent records
 * (`core.markRead`'s `ReadMarker`), which only the root holds, and the in-memory backend, having no
 * schemas to install, would never say a case needed them. The format's operation vectors run over
 * neutral entities WE does not have, which the suite installs into each perspective as a module's
 * entities are installed.
 *
 * Writes come back over the executor's subscription socket rather than synchronously, so a case
 * waits seconds for them. The known gaps are the executor's, and each one says what is wrong.
 */
import { Ad4mClient } from '@coasys/ad4m';
import { describeBackendConformance } from '@we/backend-conformance';
import type { BackendPorts } from '@we/backend-shared';
import { afterAll, inject } from 'vitest';

import { createAd4mBackendPorts } from '../../src/backendPortsAdapter';
import { QUERY_VECTOR_GAPS } from './queryVectorGaps';

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
    await ports.schemas.installRoot(ref.handle);
    datasetIds.set(ref.handle as object, ref.id);
    return { ports, dataset: ref.handle, agent };
  },
  async teardown(subject) {
    const id = datasetIds.get(subject.dataset as object);
    if (id) await subject.ports.lifecycle.remove(id);
  },
  timing: { settle: 10_000, quiet: 2_000 },
  knownGaps: {
    ...QUERY_VECTOR_GAPS,
    'queries.reply-total-leaves-calls-out':
      "a count's `where` resolves property names through the relation's target class, and an untyped relation has none, so `kind` is skipped and every response is counted (build_projection_where_patterns; coasys/ad4m#1417)",
    'queries.newest-in-a-channel':
      "a projection's `order` honours only `id`/`base` and drops any other key, so `createdAt` is ignored and the member returned is whichever SPARQL yields first (build_projection_order_clause; coasys/ad4m#1417)",
    'queries.newest-reply-under-a-post':
      "a projection's `order` honours only `id`/`base` and drops any other key, so `createdAt` is ignored and the member returned is whichever SPARQL yields first (build_projection_order_clause; coasys/ad4m#1417)",
    'operations.find-scope-levels':
      'a `levels` walk answers breadth-first, sorting each depth by `order` on its own, so a grandchild comes after every child whatever its title (ad4m-issue:levels-walk-order)',
    // Four links onto `children` in one transaction, written in the reverse of code-point order.
    // `link` writes no order entry, so they read back by link timestamp; links made in one
    // transaction share a millisecond, and a tie falls to the store's order. Not once read back in
    // the order written, over 20 local runs. Delete this once a pin includes coasys/ad4m#1936.
    'operations.relation-order':
      'a link onto an ordered relation writes no order entry, so four children linked in one transaction read back in store order, not the order written (coasys/ad4m#1304, fixed by coasys/ad4m#1936)',
    // The same cause with two links, the done column then the to-do one. Over WE's own entities it
    // read back right about half the time; over the format's neutral `Item` the tie falls to the
    // to-do column's id every time (0 of 20 local runs right). Delete this with the entry above.
    'operations.forEach-keys':
      'a link onto an ordered relation writes no order entry, so two columns linked in one transaction read back in store order, not the order written (coasys/ad4m#1304, fixed by coasys/ad4m#1936)',
  },
  knownIntermittent: {
    // Seen in 3 of 10 runs, only ever on the first post in a fresh perspective: the first two
    // children read back swapped. coasys/ad4m#1936 records a position for every member added; delete
    // this once a pin includes it.
    'relations.ordered-read':
      'the first ordered write after the space SDNA is installed sometimes reads back with its first two members swapped (coasys/ad4m#1304, fixed by coasys/ad4m#1936)',
  },
});
