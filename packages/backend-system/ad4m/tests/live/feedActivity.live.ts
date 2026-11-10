/**
 * The Feed's activity read, against a real executor: what a page of extracted records costs, and
 * whether a row says where it came from without being asked.
 *
 * The Feed draws "3 tasks, from Monday sync" by reading each kind of record the space can extract,
 * a page at a time, and grouping by `extractedFrom`. It used to `include` that relation. The source
 * is usually the call, a collection holding every line said in it, so the include hydrated the call
 * into every row of the page — measured on staging at about 18 KB a row, 926 KB for one page of
 * connections, re-read on every refresh. The Feed reads only the source's id, and the title from the
 * calls it reads anyway, so it dropped the include.
 *
 * That relies on one thing the unit tests cannot check: that a row carries `extractedFrom`, a
 * reverse relation, as the source's id when nothing includes it. If the executor stopped resolving
 * reverse relations unasked, every activity row would read as made by hand and nothing would fail —
 * so this asks the executor. The sizes print beside it.
 */
import { Ad4mClient } from '@coasys/ad4m';
import type { BackendPorts } from '@we/backend-shared';
import { CollectionBlock, TaskBlock, TextBlock } from '@we/entities';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { createAd4mBackendPorts } from '../../src/backendPortsAdapter';

/** A call long enough to show what hydrating it costs: lines of about the length people speak in. */
const LINES = 200;
/** One Feed page — `FEED_FIRST_PAGE` in `@we/module-feed`. */
const PAGE = 50;

let opened: { client: Ad4mClient; ports: BackendPorts; space: string } | undefined;

afterAll(async () => {
  if (!opened) return;
  await opened.ports.lifecycle.remove(opened.space).catch(() => {});
  opened.client.close();
});

const bytes = (rows: unknown[]) => Buffer.byteLength(JSON.stringify(rows));

describe('the Feed’s activity read', () => {
  it(
    'names each record’s source by id unasked, at a fraction of the size of including it',
    { timeout: 300_000 },
    async () => {
      const { url, token } = inject('ad4mExecutor');
      const client = new Ad4mClient(url, token);
      const me = (await client.agent.me()).did;
      const ports = createAd4mBackendPorts(client, { selfId: () => me });
      const ref = await ports.lifecycle.create(`feed-activity-${Date.now()}`);
      opened = { client, ports, space: ref.id };
      await ports.schemas.installSpace(ref.handle, []);
      const handle = ref.handle as never;

      const root = (await CollectionBlock.create(handle, { kind: 'space', title: 'Space' } as never)) as { id: string };
      const call = (await CollectionBlock.create(handle, { kind: 'call', title: 'Monday sync' } as never, {
        parent: { id: root.id, relation: 'children', entity: 'CollectionBlock' },
      })) as { id: string };
      for (let i = 0; i < LINES; i++)
        await TextBlock.create(
          handle,
          {
            text: `Line ${i}: we should book the venue before the brief goes out, and ask Ben.`,
            source: 'spoken',
          } as never,
          { parent: { id: call.id, relation: 'children', entity: 'CollectionBlock' } },
        );
      for (let i = 0; i < PAGE; i++) {
        const task = (await TaskBlock.create(handle, { title: `Task ${i}` } as never, {
          parent: { id: root.id, relation: 'children', entity: 'CollectionBlock' },
        })) as { id: string };
        await CollectionBlock.addRelation(handle, call.id, 'extracted', task.id);
      }

      // The query the Feed's host makes of one activity type: `within` as `parent`, as `withinAsParent`.
      const page = {
        parent: { id: root.id, relation: 'children', entity: 'CollectionBlock' },
        order: { createdAt: 'desc' },
        limit: PAGE,
      };
      const findAll = (
        TaskBlock.findAll as unknown as (h: never, q: unknown) => Promise<Record<string, unknown>[]>
      ).bind(TaskBlock);
      const bare = await findAll(handle, page);
      const included = await findAll(handle, { ...page, include: { extractedFrom: true } });

      expect(bare).toHaveLength(PAGE);
      for (const row of bare) expect(row.extractedFrom).toBe(call.id);

      const before = bytes(included);
      const after = bytes(bare);
      console.info(
        `Feed activity page, ${PAGE} tasks from a call of ${LINES} lines: ` +
          `with include ${before} B (${Math.round(before / PAGE)} B a row), ` +
          `without ${after} B (${Math.round(after / PAGE)} B a row)`,
      );
      expect(after).toBeLessThan(before);
    },
  );
});
