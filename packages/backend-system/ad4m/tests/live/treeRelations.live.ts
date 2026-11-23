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
 *   to go through the static `update` — and that write lands, and so does a clear (`''`).
 */
import { Ad4mClient, type PerspectiveProxy, SHACLShape } from '@coasys/ad4m';
import { getEntityForDataset } from '@we/entities';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { createAd4mQueryAdapter } from '../../src/ad4mAdapter';
import { createAd4mBackendPorts } from '../../src/backendPortsAdapter';

/** Two classes in the shape a model author writes: links as typed `hasOne`s, no `sh:class`. */
const setter = (predicate: string) => [{ action: 'setSingleTarget', source: 'this', predicate, target: 'value' }];

/** Register shapes given as SHACL JSON, as another app would. */
const register = (handle: unknown, ...shapes: object[]) =>
  (handle as PerspectiveProxy).registerShapes(shapes.map((s) => SHACLShape.fromJSON(s as never)));

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

/** A parent that lists its children — the to-many a tree reads from the holder's side. */
const link = (action: string, predicate: string) => [{ action, source: 'this', predicate, target: 'value' }];
const AGENDA = {
  target_class: 'treelive://LiveAgenda',
  properties: [
    {
      path: 'treelive://agendaTitle',
      name: 'title',
      datatype: 'xsd://string',
      min_count: 1,
      max_count: 1,
      writable: true,
      setter: setter('treelive://agendaTitle'),
      identity: true,
    },
    {
      path: 'treelive://items',
      name: 'items',
      min_count: 0,
      writable: true,
      relation_kind: 'hasMany',
      target_class_name: 'LiveTopic',
      node_kind: 'IRI',
      adder: link('addLink', 'treelive://items'),
      remover: link('removeLink', 'treelive://items'),
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
      await register(ref.handle, TOPIC, POSITION);

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

  /*
    The two reads a level of the canvas's relation pull makes, for every parent of a kind at once —
    never one read per parent. Backward: "what points at any of these topics through `about`", the
    inbound scope the shared relation reader asks, read here the two ways it reaches the executor (the
    query adapter's traverse form, and the `where` over the field the graph host lowers it to). Forward:
    the children a list of agendas holds, read with `include` on the parents — and, for a template
    that drills instead, the same children through an outbound scope anchored at the whole list.
  */
  it('reads a level of the pull for a list of anchors, both ways round', { timeout: 120_000 }, async () => {
    const { url, token } = inject('ad4mExecutor');
    client ??= new Ad4mClient(url, token);
    const agent = (await client.agent.me()).did;
    const ports = createAd4mBackendPorts(client, { selfId: () => agent });
    const ref = await ports.lifecycle.create(`tree-relations-list-${Date.now()}`);
    try {
      await ports.schemas.installSpace(ref.handle, []);
      await register(ref.handle, TOPIC, POSITION, AGENDA);
      const entries = await ports.schemas.foreignSchemas(ref.handle);
      expect(entries.find((e) => e.name === 'LiveAgenda')?.properties.find((p) => p.name === 'items')).toMatchObject({
        relatedEntity: 'LiveTopic',
        isCollection: true,
      });

      const Topic = getEntityForDataset('LiveTopic', ref.handle) as unknown as Model;
      const Position = getEntityForDataset('LivePosition', ref.handle) as unknown as Model;
      const Agenda = getEntityForDataset('LiveAgenda', ref.handle) as unknown as Model;
      const [t1, t2, t3] = await Promise.all(
        ['Roadmap', 'Hiring', 'Budget'].map((title) => Topic.create(ref.handle, { title })),
      );
      const p1 = await Position.create(ref.handle, { statement: 'Ship it', about: t1.id });
      const p2 = await Position.create(ref.handle, { statement: 'Hire two', about: t2.id });
      await Position.create(ref.handle, { statement: 'Elsewhere', about: t3.id });
      const a1 = await Agenda.create(ref.handle, { title: 'Monday' });
      const a2 = await Agenda.create(ref.handle, { title: 'Tuesday' });
      /*
        Listed by link, as the class stores them. `addRelation` is refused here: AD4M's `fromSHACL`
        reads an installed `hasMany` back as getter-only, so it offers no write — a gap of its own,
        noted beside the to-one clear in the PR, and not one the tree's reads depend on.
      */
      const lists = ref.handle as {
        add(link: { source: string; predicate: string; target: string }): Promise<unknown>;
      };
      for (const [parent, child] of [
        [a1.id, t1.id],
        [a2.id, t2.id],
        [a2.id, t3.id],
      ]) {
        await lists.add({ source: parent, predicate: 'treelive://items', target: child });
      }
      const adapter = createAd4mQueryAdapter(() => entries);
      const ids = (rows: Row[]) => rows.map((row) => row.id).sort();

      // Backward, through the query adapter: an inbound scope anchored at two topics at once.
      const inbound = await eventually(
        () =>
          Position.findAll(
            ref.handle,
            adapter.lower({
              irVersion: 1,
              entity: 'LivePosition',
              scope: { anchor: 'LiveTopic', via: 'about', anchorId: [t1.id, t2.id], direction: 'in' },
            } as never),
          ),
        (rows) => rows.length >= 2,
      );
      expect(ids(inbound)).toEqual([p1.id, p2.id].sort());
      // Backward, as the graph host lowers the same read: a filter on the child's own field.
      expect(ids(await Position.findAll(ref.handle, { where: { about: [t1.id, t2.id] } }))).toEqual(
        [p1.id, p2.id].sort(),
      );

      // Forward, the to-many pull: both agendas' items in one read, each on the agenda that lists it.
      const parents = await eventually(
        () => Agenda.findAll(ref.handle, { where: { id: [a1.id, a2.id] }, include: { items: true } }),
        (rows) => rows.length === 2 && rows.every((row) => Array.isArray(row.items) && row.items.length > 0),
      );
      const held = Object.fromEntries(
        parents.map((row) => [
          row.id,
          ids((row.items as Row[]).map((item) => (typeof item === 'string' ? { id: item } : item))),
        ]),
      );
      expect(held).toEqual({ [a1.id]: [t1.id], [a2.id]: [t2.id, t3.id].sort() });
      expect((parents.find((row) => row.id === a1.id)!.items as Row[])[0]).toMatchObject({
        id: t1.id,
        title: 'Roadmap',
      });
      // The same children through an outbound scope over both agendas, for a template that drills.
      const drilled = await Topic.findAll(
        ref.handle,
        adapter.lower({
          irVersion: 1,
          entity: 'LiveTopic',
          scope: { anchor: 'LiveAgenda', via: 'items', anchorId: [a1.id, a2.id] },
        } as never),
      );
      expect(ids(drilled)).toEqual([t1.id, t2.id, t3.id].sort());
    } finally {
      await ports.lifecycle.remove(ref.id);
    }
  });

  /*
    The clear a tree drop into the unconnected area, and the undo of a first attach, both need: an
    installed class's `max_count: 1` relation is a plain property to the model, and the SDK
    makes `update(..., { field: '' })` and `{ field: null }` remove that property's links. Checked
    against what the perspective stores, not what the model reads back.
  */
  it('clears an installed to-one with an empty value or null', { timeout: 120_000 }, async () => {
    const { url, token } = inject('ad4mExecutor');
    client ??= new Ad4mClient(url, token);
    const agent = (await client.agent.me()).did;
    const ports = createAd4mBackendPorts(client, { selfId: () => agent });
    const ref = await ports.lifecycle.create(`tree-relations-clear-${Date.now()}`);
    try {
      await ports.schemas.installSpace(ref.handle, []);
      const perspective = ref.handle as {
        get(q: { source?: string; predicate?: string }): Promise<{ data: { target: string } }[]>;
      };
      await register(ref.handle, TOPIC, POSITION);
      await ports.schemas.foreignSchemas(ref.handle);
      const Topic = getEntityForDataset('LiveTopic', ref.handle) as unknown as Model;
      const Position = getEntityForDataset('LivePosition', ref.handle) as unknown as Model;
      const t = await Topic.create(ref.handle, { title: 'Roadmap' });
      const p = await Position.create(ref.handle, { statement: 'Ship it', about: t.id });
      const stored = async () =>
        (await perspective.get({ source: p.id, predicate: 'treelive://about' })).map((l) => l.data.target);
      expect(await stored()).toEqual([t.id]);

      await Position.update(ref.handle, p.id, { about: null });
      expect(await stored()).toEqual([]);
      await Position.update(ref.handle, p.id, { about: t.id });
      expect(await stored()).toEqual([t.id]);

      await Position.update(ref.handle, p.id, { about: '' });
      expect(await stored()).toEqual([]);
      const read = await eventually(
        () => Position.findOne(ref.handle, { where: { id: p.id } }),
        (row) => !row?.about,
      );
      expect(read?.about).toBeFalsy();

      // And it can be pointed again — the undo of the clear.
      await Position.update(ref.handle, p.id, { about: t.id });
      expect(await stored()).toEqual([t.id]);
    } finally {
      await ports.lifecycle.remove(ref.id);
    }
  });
});
