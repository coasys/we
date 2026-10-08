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
  type SpaceStarter,
  starterProblems,
  starterSettings,
  type StarterWriter,
} from '../src/shared/spaceStarter';
import type { WeSeedFile } from '../src/types/seed';

const seed = weSeed as unknown as WeSeedFile;

function recorder() {
  const created: { entity: string; fields: Record<string, unknown>; parent: string; id: string }[] = [];
  const roles: { name: string; node: string }[] = [];
  const writer: StarterWriter = {
    create: async (entity, fields, parent) => {
      const id = `${entity}-${created.length + 1}`;
      created.push({ entity, fields, parent, id });
      return id;
    },
    role: async (name, node) => void roles.push({ name, node }),
  };
  return { created, roles, writer };
}

const STARTER: SpaceStarter = {
  id: 'test',
  settings: { defaultTemplateId: 'workshop', enabledModules: ['call'], name: 'not a setting' },
  records: [
    { $id: 'like', entity: 'SignalType', fields: { slug: 'like' } },
    { $id: 'canvas', entity: 'CollectionBlock', fields: { kind: 'canvas' }, in: '$root' },
    { entity: 'Placement', fields: {}, in: '$canvas' },
  ],
  roles: { canvas: '$canvas' },
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

  it('sets nothing without a starter', () => {
    expect(starterSettings(undefined)).toEqual({});
  });
});

describe('applying a starter', () => {
  it('writes each record under its container, in order, then the roles', async () => {
    const { created, roles, writer } = recorder();
    const written = await applyStarterRecords(STARTER, 'root-1', writer);

    expect(created.map((c) => [c.entity, c.parent])).toEqual([
      ['SignalType', 'root-1'],
      ['CollectionBlock', 'root-1'],
      ['Placement', 'CollectionBlock-2'],
    ]);
    expect(roles).toEqual([{ name: 'canvas', node: 'CollectionBlock-2' }]);
    expect(written).toEqual({ canvas: 'CollectionBlock-2' });
  });

  it('skips a record whose container failed, and the role pointing at it, but writes the rest', async () => {
    const { created, roles, writer } = recorder();
    const failing: StarterWriter = {
      ...writer,
      create: async (entity, fields, parent) => {
        if (entity === 'CollectionBlock') throw new Error('no such shape');
        return writer.create(entity, fields, parent);
      },
    };
    const reported: string[] = [];
    await applyStarterRecords(STARTER, 'root-1', failing, (message) => void reported.push(message));

    expect(created.map((c) => c.entity)).toEqual(['SignalType']);
    expect(roles).toEqual([]);
    expect(reported).toHaveLength(3);
  });
});

describe('checking a starter', () => {
  const vocabulary = {
    entities: new Set(Object.keys(CORE_MANIFEST.entities)),
    spaceFields: new Set(Object.keys(CORE_MANIFEST.entities.Space.properties)),
    templates: new Set(['workshop']),
    modules: new Set(['call']),
  };

  it('names every problem it finds', () => {
    const problems = starterProblems(
      {
        id: 'broken',
        settings: { name: 'x', colour: 'red', defaultTemplateId: 'nowhere', enabledModules: ['ghost'] },
        records: [
          { $id: 'a', entity: 'NoSuchThing' },
          { entity: 'CollectionBlock', in: '$later' },
          { $id: 'later', entity: 'CollectionBlock' },
          { $id: 'a', entity: 'CollectionBlock' },
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
      'records[3].$id is used twice: a',
      "roles.canvas must name a record's $id: $missing",
      "roles.home must name a record's $id: $root",
    ]);
  });

  it('passes the deployment’s own starter', () => {
    const starter = seed.spaceStarter;
    expect(starter).toBeDefined();
    const modules = (seed.modules ?? []).map((m) => (typeof m === 'string' ? m : m.id));
    expect(
      starterProblems(starter!, { ...vocabulary, templates: new Set(seed.templates), modules: new Set(modules) }),
    ).toEqual([]);
  });

  it('starts every space with the like reaction the cards feed counts by slug', () => {
    // Two files naming one slug is how they come apart: the feed resolves `like` for its counts.
    const like = seed.spaceStarter?.records?.find((r) => r.entity === 'SignalType');
    expect(like?.fields).toMatchObject({ slug: DEFAULT_SIGNAL_TYPE.slug, name: DEFAULT_SIGNAL_TYPE.name });
  });
});
