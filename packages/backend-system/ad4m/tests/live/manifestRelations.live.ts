/**
 * The relations an installed SDNA declares, as WE reads them back from a real executor.
 *
 * A model author writes a link as a typed `hasOne` with `target_class_name` and no `sh:class` — the
 * shape AD4M's model API produces. The readers checked here are the ones a fake cannot settle,
 * because each answers from what the executor actually stores:
 *
 * - the manifest (`foreignSchemas`) names each relation's target class, and pairs a `belongsTo`
 *   with the forward it inverts (`reverseOf`);
 * - the neutral manifest keeps the link a relation, so a template can `include` and `scope` it;
 * - `include` of the field hydrates the record it points at;
 * - a `scope` drill through the `belongsTo`, and an inbound `scope` through the child's own field,
 *   both find the record that points at the anchor.
 */
import { Ad4mClient } from '@coasys/ad4m';
import { getEntityForDataset } from '@we/entities';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { createAd4mQueryAdapter } from '../../src/ad4mAdapter';
import { createAd4mBackendPorts } from '../../src/backendPortsAdapter';
import { toNeutralManifest } from '../../src/neutralManifest';

const setter = (predicate: string) => [{ action: 'setSingleTarget', source: 'this', predicate, target: 'value' }];
const TOPIC = {
  target_class: 'manifestlive://MlTopic',
  properties: [
    {
      path: 'manifestlive://title',
      name: 'title',
      datatype: 'xsd://string',
      min_count: 1,
      max_count: 1,
      writable: true,
      setter: setter('manifestlive://title'),
      identity: true,
    },
    // The positions about this topic, read back from the link each position holds.
    {
      path: 'manifestlive://about',
      name: 'positions',
      relation_kind: 'belongsToMany',
      target_class_name: 'MlPosition',
      node_kind: 'IRI',
    },
  ],
};
const POSITION = {
  target_class: 'manifestlive://MlPosition',
  properties: [
    {
      path: 'manifestlive://statement',
      name: 'statement',
      datatype: 'xsd://string',
      min_count: 1,
      max_count: 1,
      writable: true,
      setter: setter('manifestlive://statement'),
      identity: true,
    },
    {
      path: 'manifestlive://about',
      name: 'about',
      min_count: 0,
      max_count: 1,
      writable: true,
      setter: setter('manifestlive://about'),
      relation_kind: 'hasOne',
      target_class_name: 'MlTopic',
      node_kind: 'IRI',
    },
  ],
};

type Row = Record<string, unknown> & { id: string };
type Model = {
  create(dataset: unknown, data: Record<string, unknown>): Promise<Row>;
  findAll(dataset: unknown, query?: Record<string, unknown>): Promise<Row[]>;
};

let client: Ad4mClient | undefined;
afterAll(async () => client?.close());

async function eventually<T>(read: () => Promise<T>, holds: (value: T) => boolean, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  let value = await read();
  while (!holds(value) && Date.now() < until) {
    await new Promise((done) => setTimeout(done, 300));
    value = await read();
  }
  return value;
}

describe('an installed SDNA’s relations, read back live', () => {
  it('names targets, pairs a belongsTo, and reads through both', { timeout: 120_000 }, async () => {
    const { url, token } = inject('ad4mExecutor');
    client = new Ad4mClient(url, token);
    const agent = (await client.agent.me()).did;
    const ports = createAd4mBackendPorts(client, { selfId: () => agent });
    const ref = await ports.lifecycle.create(`manifest-relations-${Date.now()}`);
    try {
      await ports.schemas.installSpace(ref.handle, []);
      const perspective = ref.handle as {
        addSdna(n: string, c: string, t: 'subject_class', s: string): Promise<boolean>;
      };
      await perspective.addSdna('MlTopic', '', 'subject_class', JSON.stringify(TOPIC));
      await perspective.addSdna('MlPosition', '', 'subject_class', JSON.stringify(POSITION));

      // The manifest: the target from `target_class_name`, and the belongsTo paired with its forward.
      const entries = await ports.schemas.foreignSchemas(ref.handle);
      const about = entries.find((e) => e.name === 'MlPosition')?.properties.find((p) => p.name === 'about');
      expect(about).toMatchObject({ type: 'uri', relatedEntity: 'MlTopic' });
      const positions = entries.find((e) => e.name === 'MlTopic')?.properties.find((p) => p.name === 'positions');
      expect(positions).toMatchObject({ relatedEntity: 'MlPosition', reverse: true, reverseOf: 'about' });

      // The neutral manifest a template is validated against keeps the link a relation.
      const { manifest } = toNeutralManifest(entries);
      expect(manifest.entities.MlPosition.relations.about).toMatchObject({ target: 'MlTopic' });

      const Topic = getEntityForDataset('MlTopic', ref.handle) as unknown as Model;
      const Position = getEntityForDataset('MlPosition', ref.handle) as unknown as Model;
      const topic = await Topic.create(ref.handle, { title: 'Roadmap' });
      const position = await Position.create(ref.handle, { statement: 'Ship it', about: topic.id });

      // `include` hydrates what the field points at.
      const included = await eventually(
        () => Position.findAll(ref.handle, { where: { id: position.id }, include: { about: true } }),
        (rows) => typeof rows[0]?.about === 'object' && rows[0]?.about !== null,
      );
      expect((included[0].about as Row).id).toBe(topic.id);

      // `scope` — the `$query` path, lowered by the query adapter onto the model's own read.
      const adapter = createAd4mQueryAdapter(() => entries);
      const scoped = async (scope: Record<string, unknown>) =>
        (await Position.findAll(ref.handle, adapter.lower({ irVersion: 1, entity: 'MlPosition', scope } as never))).map(
          (row) => row.id,
        );
      // Down the belongsTo: the topic's positions are the ones pointing at it.
      expect(await scoped({ anchor: 'MlTopic', via: 'positions', anchorId: topic.id })).toEqual([position.id]);
      // Inbound through the child's own field, as the graph's backward read asks it — the relation
      // is the position's, not the anchor's.
      expect(await scoped({ anchor: 'MlTopic', via: 'about', anchorId: topic.id, direction: 'in' })).toEqual([
        position.id,
      ]);
    } finally {
      await ports.lifecycle.remove(ref.id);
    }
  });
});
