/**
 * A tree built from an installed SDNA's own relations, on a real executor — the reads and the
 * write the Workshop tree makes, against a shape that declares its links as `hasOne` +
 * `target_class_name` and nothing else.
 *
 * The unit tests answer these with fakes, and every fake was written from the code it tests. The
 * claims checked here are the ones a fake cannot settle:
 *
 * - the manifest WE reads back from the executor names each relation's target class;
 * - a batched "who points at these" read (`where: { field: [ids] }`) finds the children;
 * - an installed class has no `set`/`add`/`remove` for a `max_count: 1` relation, so a reparent has
 *   to go through the static `update` — and that write lands.
 */
import { Ad4mClient } from '@coasys/ad4m';
import { getEntityForDataset } from '@we/entities';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { createAd4mBackendPorts } from '../../src/backendPortsAdapter';

/** Two classes in the shape a model author writes: links as typed `hasOne`s, no `sh:class`. */
const setter = (predicate: string) => [{ action: 'setSingleTarget', source: 'this', predicate, target: 'value' }];
const TOPIC = {
  target_class: 'treelive://LiveTopic',
  properties: [
    {
      path: 'treelive://title',
      name: 'title',
      datatype: 'xsd://string',
      min_count: 1,
      max_count: 1,
      writable: true,
      setter: setter('treelive://title'),
      identity: true,
    },
    {
      path: 'treelive://subTopicOf',
      name: 'subTopicOf',
      min_count: 0,
      max_count: 1,
      writable: true,
      setter: setter('treelive://subTopicOf'),
      relation_kind: 'hasOne',
      target_class_name: 'LiveTopic',
      node_kind: 'IRI',
    },
  ],
};
const POSITION = {
  target_class: 'treelive://LivePosition',
  properties: [
    {
      path: 'treelive://statement',
      name: 'statement',
      datatype: 'xsd://string',
      min_count: 1,
      max_count: 1,
      writable: true,
      setter: setter('treelive://statement'),
      identity: true,
    },
    {
      path: 'treelive://about',
      name: 'about',
      min_count: 0,
      max_count: 1,
      writable: true,
      setter: setter('treelive://about'),
      relation_kind: 'hasOne',
      target_class_name: 'LiveTopic',
      node_kind: 'IRI',
    },
  ],
};

type Row = Record<string, unknown> & { id: string };
type Model = {
  create(dataset: unknown, data: Record<string, unknown>): Promise<Row>;
  findAll(dataset: unknown, query?: Record<string, unknown>): Promise<Row[]>;
  findOne(dataset: unknown, query?: Record<string, unknown>): Promise<Row | null>;
  update(dataset: unknown, id: string, data: Record<string, unknown>): Promise<unknown>;
};

let client: Ad4mClient | undefined;
afterAll(async () => client?.close());

/** Polls a read until it holds, since writes come back over the subscription socket. */
async function eventually<T>(read: () => Promise<T>, holds: (value: T) => boolean, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  let value = await read();
  while (!holds(value) && Date.now() < until) {
    await new Promise((done) => setTimeout(done, 300));
    value = await read();
  }
  return value;
}

describe('a tree over an installed SDNA’s relations, live', () => {
  it('reads the relations, finds the children, and moves one', { timeout: 120_000 }, async () => {
    const { url, token } = inject('ad4mExecutor');
    client = new Ad4mClient(url, token);
    const agent = (await client.agent.me()).did;
    const ports = createAd4mBackendPorts(client, { selfId: () => agent });
    const ref = await ports.lifecycle.create(`tree-relations-${Date.now()}`);
    try {
      await ports.schemas.installSpace(ref.handle, []);
      const perspective = ref.handle as {
        addSdna(n: string, c: string, t: 'subject_class', s: string): Promise<boolean>;
      };
      await perspective.addSdna('LiveTopic', '', 'subject_class', JSON.stringify(TOPIC));
      await perspective.addSdna('LivePosition', '', 'subject_class', JSON.stringify(POSITION));

      // The manifest the canvas and the spine picker read: each relation names its target.
      const entries = await ports.schemas.foreignSchemas(ref.handle);
      const about = entries.find((e) => e.name === 'LivePosition')?.properties.find((p) => p.name === 'about');
      expect(about).toMatchObject({ type: 'uri', relatedEntity: 'LiveTopic' });
      const sub = entries.find((e) => e.name === 'LiveTopic')?.properties.find((p) => p.name === 'subTopicOf');
      expect(sub).toMatchObject({ type: 'uri', relatedEntity: 'LiveTopic' });

      const Topic = getEntityForDataset('LiveTopic', ref.handle) as unknown as Model;
      const Position = getEntityForDataset('LivePosition', ref.handle) as unknown as Model;
      const t1 = await Topic.create(ref.handle, { title: 'Roadmap' });
      const t2 = await Topic.create(ref.handle, { title: 'Q3', subTopicOf: t1.id });
      const p1 = await Position.create(ref.handle, { statement: 'Ship it', about: t2.id });

      // The seed's batched pull: one read for every parent of a kind.
      const children = await eventually(
        () => Position.findAll(ref.handle, { where: { about: [t1.id, t2.id] } }),
        (rows) => rows.length > 0,
      );
      expect(children.map((r) => r.id)).toEqual([p1.id]);
      expect(children[0].about).toBe(t2.id);
      const subs = await Topic.findAll(ref.handle, { where: { subTopicOf: [t1.id] } });
      expect(subs.map((r) => r.id)).toEqual([t2.id]);

      // The drop's write: no accessor on an installed class's to-one, so the static update.
      const record = (await Position.findOne(ref.handle, { where: { id: p1.id } }))!;
      expect(typeof record.setAbout).toBe('undefined');
      await Position.update(ref.handle, p1.id, { about: t1.id });
      const moved = await eventually(
        () => Position.findOne(ref.handle, { where: { id: p1.id } }),
        (row) => row?.about === t1.id,
      );
      expect(moved?.about).toBe(t1.id);
    } finally {
      await ports.lifecycle.remove(ref.id);
    }
  });
});
