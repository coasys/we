/**
 * A standing watch, registered against a real executor and then asked for again.
 *
 * `watch` writes nothing when the registered config already says what the watch wants. It decides
 * that by reading the config's links back and comparing each setting, as text, with what it would
 * write — so the decision is only as good as the round trip. If the executor stored one setting in a
 * form that does not decode to the value sent (the scope query is a long multi-line string with
 * quotes and `<<( … )>>` in it), every call would read as "a setting changed" and register again:
 * no deletes, but another copy of every class link and another live-query push each time, which is
 * the churn this was meant to end. The unit tests use a fake that stores values exactly as written,
 * so they cannot see that. This asks the executor.
 *
 * Counted from the client: `addAutoProcessor`, `removeAutoProcessor` and `remove` on the perspective
 * are what `watch` and `unwatch` write through. The class links on the config node are counted too,
 * as what the executor holds.
 *
 * Stopping the watch is one `removeAutoProcessor`, never a `remove` per link: leaving a call used to
 * be a dozen sequential round trips. What it must leave is the processor's runs — they point AT the
 * config node and are the processed-turn cursor. A real run needs a language model, so this stands
 * one in with the link a run carries (`interp/processor`, which `cursor.rs` reads).
 */
import { Ad4mClient, Link, LinkQuery, type PerspectiveProxy } from '@coasys/ad4m';
import type { BackendPorts, WatchRequest } from '@we/backend-shared';
import { CollectionBlock } from '@we/entities';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { createAd4mBackendPorts } from '../../src/backendPortsAdapter';

const WATCH = 'we-live-watch';
const NODE = `ad4m://autoprocessor/${WATCH}`;
const CLASS = 'ad4m://interpretation_class';
const RUN_PROCESSOR = 'ad4m://interp/processor';

let opened: { client: Ad4mClient; ports: BackendPorts; space: string } | undefined;

afterAll(async () => {
  if (!opened) return;
  await opened.ports.lifecycle.remove(opened.space).catch(() => {});
  opened.client.close();
});

/** Counts what `watch` writes through, without changing what it writes. */
function counted(perspective: PerspectiveProxy) {
  const calls = { addAutoProcessor: 0, removeAutoProcessor: 0, remove: 0 };
  for (const method of ['addAutoProcessor', 'removeAutoProcessor', 'remove'] as const) {
    const original = (perspective[method] as (...args: unknown[]) => Promise<unknown>).bind(perspective);
    (perspective as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      calls[method] += 1;
      return original(...args);
    };
  }
  return calls;
}

describe('a standing watch, against a real executor', () => {
  it(
    'writes nothing when called again as registered, and rewrites a changed setting in place',
    { timeout: 300_000 },
    async () => {
      const { url, token } = inject('ad4mExecutor');
      const client = new Ad4mClient(url, token);
      const me = (await client.agent.me()).did;
      const ports = createAd4mBackendPorts(client, { selfId: () => me });
      const ref = await ports.lifecycle.create(`interpretation-watch-${Date.now()}`);
      opened = { client, ports, space: ref.id };
      await ports.schemas.installSpace(ref.handle, []);
      const perspective = ref.handle as PerspectiveProxy;

      const call = (await CollectionBlock.create(
        perspective as never,
        { kind: 'call', title: 'Monday sync' } as never,
      )) as {
        id: string;
      };
      const request = (extra: Partial<WatchRequest> = {}): WatchRequest => ({
        watchId: WATCH,
        classes: ['TaskBlock'],
        parent: { id: call.id, relation: 'children', entity: 'CollectionBlock' },
        provenance: { id: call.id, relation: 'extracted', entity: 'CollectionBlock' },
        ...extra,
      });
      const classLinks = async () => (await perspective.get(new LinkQuery({ source: NODE, predicate: CLASS }))).length;
      const watch = ports.interpretation!.watch!.bind(ports.interpretation);
      const calls = counted(perspective);

      await watch(ref.handle, request());
      expect(calls).toEqual({ addAutoProcessor: 1, removeAutoProcessor: 0, remove: 0 });
      const registered = await classLinks();
      expect(registered).toBeGreaterThan(0);

      // The same request again: every setting reads back as written, so nothing is written.
      await watch(ref.handle, request());
      expect(calls).toEqual({ addAutoProcessor: 1, removeAutoProcessor: 0, remove: 0 });
      expect(await classLinks()).toBe(registered);

      // One setting changed: registered again over the config, never deleted first.
      await watch(ref.handle, request({ batchMax: 40 }));
      expect(calls).toEqual({ addAutoProcessor: 2, removeAutoProcessor: 0, remove: 0 });

      // And the rewritten setting reads back too, so the call after it is a no-op again.
      await watch(ref.handle, request({ batchMax: 40 }));
      expect(calls).toEqual({ addAutoProcessor: 2, removeAutoProcessor: 0, remove: 0 });

      // A run the processor wrote, standing in for one a pass would.
      const run = `ad4m://interp/run-live-${Date.now()}`;
      await perspective.add(new Link({ source: run, predicate: RUN_PROCESSOR, target: NODE }));

      // Stopping it: one request, and the whole config goes — every link from the node.
      await ports.interpretation!.unwatch!(ref.handle, WATCH);
      expect(calls).toEqual({ addAutoProcessor: 2, removeAutoProcessor: 1, remove: 0 });
      expect(await classLinks()).toBe(0);
      expect(await perspective.get(new LinkQuery({ source: NODE }))).toHaveLength(0);
      // The run stays: it is the cursor a watch registered again under this id resumes from.
      expect(await perspective.get(new LinkQuery({ source: run, predicate: RUN_PROCESSOR }))).toHaveLength(1);

      // Stopping it again is quiet: there is nothing left to remove.
      await ports.interpretation!.unwatch!(ref.handle, WATCH);
      expect(calls).toEqual({ addAutoProcessor: 2, removeAutoProcessor: 2, remove: 0 });
    },
  );
});
