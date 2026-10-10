/**
 * A space's starter: what it sets, what it writes, and that the deployment's own one is sound.
 *
 * The writes happen once, at a create press, and nothing shows a starter that half-applied — the
 * space simply arrives without its canvas. So these pin the order records are written in, what
 * contains each, and that a broken reference costs that record rather than the space.
 */
import { CORE_MANIFEST } from '@we/entities/manifest';
import { DEFAULT_SIGNAL_TYPE } from '@we/template-kit';
import { describe, expect, it } from 'vitest';

import weSeed from '../../../we-seed.json';
import {
  applyStarterRecords,
  defaultSpaceStarter,
  type SpaceStarter,
  starterProblems,
  starterSettings,
  type StarterWriter,
  unreferencedIds,
} from '../src/shared/spaceStarter';
import type { WeSeedFile } from '../src/types/seed';

const seed = weSeed as unknown as WeSeedFile;

function recorder() {
  const created: { entity: string; fields: Record<string, unknown>; parent: string | null; id: string }[] = [];
  const roles: { name: string; node: string }[] = [];
  const links: Record<string, string | string[]>[] = [];
  const composed: string[] = [];
  const writer: StarterWriter = {
    create: async (entity, fields, parent) => {
      const id = `${entity}-${created.length + 1}`;
      created.push({ entity, fields, parent, id });
      return id;
    },
    role: async (name, node) => void roles.push({ name, node }),
    linkSpace: async (relations) => void links.push(relations),
    compose: async (id) => void composed.push(id),
  };
  return { created, roles, links, composed, writer };
}

const TARGET = { rootId: 'root-1', spaceId: 'space-1', space: { name: 'Acme', description: 'Makers' } };

const STARTER: SpaceStarter = {
  id: 'test',
  settings: {
    defaultTemplateId: 'workshop',
    enabledModules: ['call'],
    name: 'not a setting',
    taskStates: ['$todo', '$done'],
  },
  records: [
    { $id: 'like', entity: 'SignalType', fields: { slug: 'like' } },
    { $id: 'todo', entity: 'TaskState', fields: { slug: 'todo' } },
    { $id: 'done', entity: 'TaskState', fields: { slug: 'done' } },
    { $id: 'canvas', entity: 'CollectionBlock', fields: { kind: 'canvas' }, in: '$root' },
    { $id: 'board', entity: 'CollectionBlock', fields: { kind: 'board', gathers: ['$root'] }, in: '$root' },
    { entity: 'CollectionBlock', fields: { kind: 'column', slug: 'todo' }, in: '$board' },
    { $id: 'post', entity: 'CollectionBlock', fields: { type: 'root', kind: 'post' }, in: '$root' },
    {
      entity: 'TextBlock',
      fields: { text: 'Welcome to {{space.name}}, $5 well spent', marks: '[{"type":"strong","start":0,"end":7}]' },
      in: '$post',
    },
  ],
  roles: { canvas: '$canvas', board: '$board' },
  input: true,
};

describe('starter settings', () => {
  it('sets the space’s settings, stores lists as the fields hold them, and never its identity', () => {
    expect(starterSettings(STARTER)).toEqual({
      defaultTemplateId: 'workshop',
      enabledModules: '["call"]',
      extractLooseMessages: true,
    });
  });

  it('leaves a setting that refers to records for after they are written', () => {
    expect(starterSettings(STARTER)).not.toHaveProperty('taskStates');
  });

  it('sets nothing without a starter', () => {
    expect(starterSettings(undefined)).toEqual({});
  });
});

describe('applying a starter', () => {
  it('writes each record under the container it names, in order — and one that names none under nothing', async () => {
    const { created, writer } = recorder();
    await applyStarterRecords(STARTER, TARGET, writer);

    expect(created.map((c) => [c.entity, c.parent])).toEqual([
      ['SignalType', null],
      ['TaskState', null],
      ['TaskState', null],
      ['CollectionBlock', 'root-1'],
      ['CollectionBlock', 'root-1'],
      ['CollectionBlock', 'CollectionBlock-5'],
      ['CollectionBlock', 'root-1'],
      ['TextBlock', 'CollectionBlock-7'],
    ]);
  });

  it('resolves references in fields, to one record or a list of them, and leaves other strings alone', async () => {
    const { created, writer } = recorder();
    await applyStarterRecords(STARTER, TARGET, writer);
    expect(created[4].fields.gathers).toEqual(['root-1']);
    // `$5` is not a whole-string reference, and a reference inside a JSON value is text.
    expect(created[7].fields.text).toBe('Welcome to Acme, $5 well spent');
    expect(created[7].fields.marks).toBe('[{"type":"strong","start":0,"end":7}]');
  });

  it('writes the space’s relations once the records exist, in order', async () => {
    const { links, writer } = recorder();
    await applyStarterRecords(STARTER, TARGET, writer);
    expect(links).toEqual([{ taskStates: ['TaskState-2', 'TaskState-3'] }]);
  });

  it('asks the writer to finish every record, deepest first, after the relations', async () => {
    const order: string[] = [];
    const { writer } = recorder();
    await applyStarterRecords(STARTER, TARGET, {
      ...writer,
      linkSpace: async () => void order.push('links'),
      compose: async (id) => void order.push(id),
    });
    expect(order[0]).toBe('links');
    expect(order.slice(1)).toEqual([
      'TextBlock-8',
      'CollectionBlock-7',
      'CollectionBlock-6',
      'CollectionBlock-5',
      'CollectionBlock-4',
      'TaskState-3',
      'TaskState-2',
      'SignalType-1',
    ]);
  });

  it('records the roles last, and answers them', async () => {
    const { roles, writer } = recorder();
    const written = await applyStarterRecords(STARTER, TARGET, writer);
    expect(roles).toEqual([
      { name: 'canvas', node: 'CollectionBlock-4' },
      { name: 'board', node: 'CollectionBlock-5' },
    ]);
    expect(written).toEqual({ canvas: 'CollectionBlock-4', board: 'CollectionBlock-5' });
  });

  it('skips a record whose container or reference failed, and whatever refers to it, but writes the rest', async () => {
    const { created, roles, writer } = recorder();
    const failing: StarterWriter = {
      ...writer,
      create: async (entity, fields, parent) => {
        if (fields.kind === 'board') throw new Error('no such shape');
        return writer.create(entity, fields, parent);
      },
    };
    const reported: string[] = [];
    await applyStarterRecords(STARTER, TARGET, failing, (message) => void reported.push(message));

    expect(created.map((c) => c.fields.kind ?? c.entity)).toEqual([
      'SignalType',
      'TaskState',
      'TaskState',
      'canvas',
      'post',
      'TextBlock',
    ]);
    expect(roles.map((r) => r.name)).toEqual(['canvas']);
    // The board, the column inside it, and the role naming it.
    expect(reported).toHaveLength(3);
  });
});

describe('checking a starter', () => {
  const vocabulary = {
    entities: new Set(Object.keys(CORE_MANIFEST.entities)),
    spaceFields: new Set([
      ...Object.keys(CORE_MANIFEST.entities.Space.properties),
      ...Object.keys(CORE_MANIFEST.entities.Space.relations ?? {}),
    ]),
    templates: new Set(['workshop']),
    modules: new Set(['call']),
  };

  it('names every problem it finds', () => {
    const problems = starterProblems(
      {
        id: 'broken',
        settings: {
          name: 'x',
          colour: 'red',
          defaultTemplateId: 'nowhere',
          enabledModules: ['ghost'],
          taskStates: ['$nowhere'],
        },
        records: [
          { $id: 'a', entity: 'NoSuchThing' },
          { entity: 'CollectionBlock', in: '$later' },
          { $id: 'later', entity: 'CollectionBlock', fields: { gathers: ['$after'], title: '{{space.owner}}' } },
          { $id: 'a', entity: 'CollectionBlock' },
          { entity: 'CollectionBlock', in: '$space' },
          { entity: 'CollectionBlock', fields: { kind: 'column', slug: 'blocked' } },
          { $id: 'after', entity: 'CollectionBlock', in: null as unknown as string },
        ],
        roles: { canvas: '$missing', home: '$root' },
      },
      vocabulary,
    );
    expect(problems).toEqual([
      "settings.name is the space's identity, not a setting",
      'settings.colour is not a Space field',
      'settings.defaultTemplateId names a template this deployment does not bundle: nowhere',
      'settings.enabledModules names an unknown module: ghost',
      'records[0].entity is not in the manifest: NoSuchThing',
      "records[1].in must name $root or an earlier record's $id: $later",
      'records[2].fields.gathers refers to $after, which no earlier record defines',
      'records[2].fields.title has an unknown placeholder: {{space.owner}}',
      'records[3].$id is used twice: a',
      "records[4].in must name $root or an earlier record's $id: $space",
      'records[5] is a column for a task state the starter does not define: blocked',
      'records[6].in is null — leave it out for a record nothing contains',
      'settings.taskStates refers to $nowhere, which no record defines',
      "roles.canvas must name a record's $id: $missing",
      "roles.home must name a record's $id: $root",
    ]);
  });

  it('names the $ids nothing refers to, through any of in, fields, settings or roles', () => {
    expect(
      unreferencedIds({
        id: 'ids',
        settings: { taskStates: ['$todo'] },
        records: [
          { $id: 'todo', entity: 'TaskState' },
          { $id: 'board', entity: 'CollectionBlock', in: '$root' },
          { entity: 'CollectionBlock', in: '$board' },
          { $id: 'canvas', entity: 'CollectionBlock', in: '$root' },
          { $id: 'gathered', entity: 'CollectionBlock', in: '$root' },
          { entity: 'CollectionBlock', fields: { gathers: ['$gathered'] }, in: '$root' },
          { $id: 'lonely', entity: 'SignalType' },
        ],
        roles: { canvas: '$canvas' },
      }),
    ).toEqual(['lonely']);
  });

  it('ships starters whose every $id is referred to', () => {
    for (const starter of seed.spaceStarters ?? []) expect(unreferencedIds(starter)).toEqual([]);
  });

  it('passes every starter the deployment ships', () => {
    expect(seed.spaceStarters?.length).toBeGreaterThan(0);
    const modules = (seed.modules ?? []).map((m) => (typeof m === 'string' ? m : m.id));
    for (const starter of seed.spaceStarters ?? []) {
      expect(
        starterProblems(starter, { ...vocabulary, templates: new Set(seed.templates), modules: new Set(modules) }),
      ).toEqual([]);
    }
  });

  it('starts every space with the like reaction the cards feed counts by slug', () => {
    // Two files naming one slug is how they come apart: the feed resolves `like` for its counts.
    const like = defaultSpaceStarter(seed.spaceStarters)?.records?.find((r) => r.entity === 'SignalType');
    expect(like?.fields).toMatchObject({ slug: DEFAULT_SIGNAL_TYPE.slug, name: DEFAULT_SIGNAL_TYPE.name });
  });

  /*
    The states a new space starts with. Small, but what is pinned here is what lets everything
    outside a board reason about work whose states a community has renamed.
  */
  describe('the task states a new space starts with', () => {
    const states = (defaultSpaceStarter(seed.spaceStarters)?.records ?? [])
      .filter((r) => r.entity === 'TaskState')
      .map((r) => r.fields as { slug: string; semantic: string });

    it('covers open, active and done, so "is this outstanding" is always answerable', () => {
      expect(states.map((s) => s.semantic).sort()).toEqual(['active', 'done', 'open']);
    });

    it('has exactly one done state, since that is the one anything outside a board reads', () => {
      expect(states.filter((s) => s.semantic === 'done')).toHaveLength(1);
    });

    it('has unique slugs, which are what a task stores and a column binds to', () => {
      expect(new Set(states.map((s) => s.slug)).size).toBe(states.length);
    });

    it('names the states the extraction hint offers a model, so what it extracts lands in a column', () => {
      const status = CORE_MANIFEST.entities.TaskBlock.properties.status as { options?: string[] };
      expect(states.map((s) => s.slug).sort()).toEqual([...(status.options ?? [])].sort());
    });
  });
});
