/**
 * WE's own space operations, run against the reference backend: the vocabularies a community names,
 * what an agent keeps privately about a space, and the settings on the space's own record.
 */
import { deriveIdentityId, getEntity, isOperationError, runOperation } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const ME = 'did:test:me';
const AT = '2026-11-24T10:00:00.000Z';

interface Row {
  id: string;
  [field: string]: unknown;
}
type Model = {
  findOne(d: unknown, q: Record<string, unknown>): Promise<Row | null>;
  findAll(d: unknown, q?: Record<string, unknown>): Promise<Row[]>;
  create(d: unknown, data: Record<string, unknown>, o?: Record<string, unknown>): Promise<Row>;
};
const model = (name: string) => getEntity(name) as unknown as Model;

let dataset: unknown;
const run = (name: string, args: Record<string, unknown>, invokedAt?: string) =>
  runOperation(`core.${name}`, args, { dataset, invoker: ME, ...(invokedAt ? { invokedAt } : {}) });
const all = (entity: string, where?: Record<string, unknown>) =>
  model(entity).findAll(dataset, { ...(where ? { where } : {}), order: { createdAt: 'asc' } });
const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (isOperationError(error) ? `${error.class}:${error.code}` : error),
  );

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => ME },
    { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-space-ops', name: 'Space' }] },
  );
  dataset = (await ports.lifecycle.get('ds-space-ops'))!.handle;
});

describe('task states', () => {
  it('makes a state with the name’s slug, and refuses the same name twice', async () => {
    expect(await run('createTaskState', { name: '  In review ', color: 'blue' })).toMatchObject({ slug: 'in-review' });
    expect(await all('TaskState')).toMatchObject([
      { name: 'In review', slug: 'in-review', semantic: 'open', color: 'blue' },
    ]);
    expect(await errorOf(run('createTaskState', { name: 'In Review' }))).toBe('precondition:slugTaken');
    expect(await errorOf(run('createTaskState', { name: '!!' }))).toBe('precondition:noSlug');
    expect(await errorOf(run('createTaskState', { name: 'Later', semantic: 'someday' }))).toBe(
      'precondition:notASemantic',
    );
    expect(await all('TaskState')).toHaveLength(1);
  });

  it('a retired state still holds its slug', async () => {
    await run('createTaskState', { name: 'Blocked', semantic: 'blocked' });
    await run('setTaskStateRetired', { slug: 'blocked', retired: true });
    expect(await all('TaskState')).toMatchObject([{ slug: 'blocked', retired: true }]);
    expect(await errorOf(run('createTaskState', { name: 'Blocked' }))).toBe('precondition:slugTaken');
  });

  it('edits the record a slug names, keeping the name when none is given and ignoring an unknown meaning', async () => {
    await model('TaskState').create(dataset, { name: 'Doing', slug: 'doing', semantic: 'active' });
    await run('updateTaskState', { slug: 'doing', name: ' ', color: 'red', semantic: 'nonsense', approvals: 2 });
    expect((await all('TaskState')).map((s) => [s.name, s.color, s.semantic, s.approvals])).toEqual([
      ['Doing', 'red', 'active', 2],
    ]);
    await run('updateTaskState', { slug: 'doing', name: 'Underway', semantic: 'blocked', color: '' });
    const [first] = await all('TaskState');
    expect(first).toMatchObject({ name: 'Underway', semantic: 'blocked' });
    expect(first?.color ?? '').toBe('');
    expect(await errorOf(run('updateTaskState', { slug: 'nope', name: 'x' }))).toBe('precondition:unknownState');
  });

  it('adds and removes evidence requirements, and stores none as nothing', async () => {
    await run('createTaskState', { name: 'Done', semantic: 'done' });
    await run('addTaskStateEvidence', { slug: 'done', requirement: { entity: 'CollectionBlock', via: 'responses' } });
    await run('addTaskStateEvidence', { slug: 'done', requirement: { entity: 'ImageBlock', min: 2 } });
    expect((await all('TaskState'))[0]?.evidence).toEqual([
      { entity: 'CollectionBlock', via: 'responses' },
      { entity: 'ImageBlock', min: 2 },
    ]);
    await run('removeTaskStateEvidence', { slug: 'done', index: 0 });
    expect((await all('TaskState'))[0]?.evidence).toEqual([{ entity: 'ImageBlock', min: 2 }]);
    await run('removeTaskStateEvidence', { slug: 'done', index: 0 });
    expect((await all('TaskState'))[0]?.evidence ?? null).toBeNull();
  });

  it('names a state by its slug, the same id from any invocation, and refuses the slug again', async () => {
    const made = (await run('createTaskState', { name: 'Blocked', semantic: 'blocked' })) as { id: string };
    expect(made.id).toBe(await deriveIdentityId('TaskState', [['slug', 'blocked']]));
    expect(await errorOf(run('createTaskState', { name: ' BLOCKED ' }))).toBe('precondition:slugTaken');
    expect(await all('TaskState')).toHaveLength(1);
  });

  it('orders the states by slug, dropping slugs nobody has and a slug given twice', async () => {
    const space = await model('Space').create(dataset, { name: 'S', description: '' });
    const todo = await model('TaskState').create(dataset, { name: 'To do', slug: 'todo' });
    const done = await model('TaskState').create(dataset, { name: 'Done', slug: 'done' });
    const order = await run('reorderTaskStates', { space: space.id, slugs: ['done', 'ghost', 'todo', 'done'] });
    expect(order).toEqual([done.id, todo.id]);
    expect((await model('Space').findOne(dataset, { where: { id: space.id } }))?.taskStates).toEqual([
      done.id,
      todo.id,
    ]);
  });
});

describe('vocabularies', () => {
  it('a signal type takes its mode’s range and reading, and its slug is unique', async () => {
    await run('createSignalType', { name: 'Agree', mode: 'vote', rangeMin: 0, rangeMax: 10 });
    await run('createSignalType', { name: 'Stars', slug: 'stars', mode: 'rating', rangeMin: 1, rangeMax: 5 });
    await run('createSignalType', { name: 'Like' });
    expect((await all('SignalType')).map((t) => [t.slug, t.rangeMin, t.rangeMax, t.aggregate])).toEqual([
      ['agree', -1, 1, 'sum'],
      ['stars', 1, 5, 'mean'],
      ['like', 0, 1, 'count'],
    ]);
    expect(await errorOf(run('createSignalType', { name: 'Something', slug: 'stars' }))).toBe('precondition:slugTaken');
  });

  it('a kind of connection derives its slug, and is refused twice', async () => {
    await run('createRelationshipType', { name: 'Contradicts', inverseName: 'Contradicted by' });
    expect(await all('RelationshipType')).toMatchObject([{ slug: 'contradicts', inverseName: 'Contradicted by' }]);
    expect(await errorOf(run('createRelationshipType', { name: 'contradicts' }))).toBe('precondition:slugTaken');
  });

  it('a kind of involvement: made, edited and retired by slug', async () => {
    expect(await run('createInvolvementType', { name: 'Shepherd', semantic: 'odd', reflexive: true })).toMatchObject({
      slug: 'shepherd',
    });
    expect(await all('InvolvementType')).toMatchObject([
      { slug: 'shepherd', semantic: 'responsible', reflexive: true },
    ]);
    expect(await errorOf(run('createInvolvementType', { name: 'shepherd' }))).toBe('precondition:slugTaken');
    await run('updateInvolvementType', {
      slug: 'shepherd',
      name: 'Guide',
      semantic: 'reviewing',
      appliesTo: 'TaskBlock',
    });
    await run('setInvolvementTypeRetired', { slug: 'shepherd', retired: true });
    expect(await all('InvolvementType')).toMatchObject([
      { name: 'Guide', slug: 'shepherd', semantic: 'reviewing', appliesTo: 'TaskBlock', retired: true },
    ]);
  });
});

describe('what an agent keeps privately', () => {
  it('one read marker per record, moved forward to the invocation’s time, a doubled one healed', async () => {
    await model('ReadMarker').create(dataset, { nodeId: 'n1', spaceUuid: 's', lastReadAt: '2026-01-01' });
    await model('ReadMarker').create(dataset, { nodeId: 'n1', spaceUuid: 's', lastReadAt: '2026-01-02' });
    const row = (await run('markRead', { node: 'n1', space: 's' }, AT)) as Row;
    const markers = await all('ReadMarker');
    expect(markers).toHaveLength(1);
    expect(row).toMatchObject({ id: markers[0]!.id, nodeId: 'n1', lastReadAt: AT });
    expect(await run('markRead', { node: 'n2', space: 's' }, AT)).toMatchObject({ nodeId: 'n2', lastReadAt: AT });
    expect((await all('ReadMarker')).map((m) => m.nodeId)).toEqual(['n1', 'n2']);
  });

  it('mutes an account once, and unmuting removes every copy', async () => {
    await run('setAgentMuted', { did: 'did:x', muted: true, description: 'noisy' });
    await run('setAgentMuted', { did: 'did:x', muted: true });
    expect(await all('MutedAgent')).toMatchObject([{ did: 'did:x', description: 'noisy' }]);
    await model('MutedAgent').create(dataset, { did: 'did:x' });
    await run('setAgentMuted', { did: 'did:x', muted: false });
    expect(await all('MutedAgent')).toEqual([]);
  });

  it('a preference per space, made by the first choice and changed by the next', async () => {
    const made = (await run('setViewVisible', { space: 's', view: 'cards', visible: false })) as Row;
    expect(made).toMatchObject({ spaceUuid: 's', hiddenViews: ['cards'] });
    await run('setViewVisible', { space: 's', view: 'map', visible: false });
    await run('setModuleVisible', { space: 's', module: 'call', visible: false });
    await run('setSpaceTemplateOverride', { space: 's', template: 'mine' });
    await run('setMyModuleSetting', { space: 's', group: 'polls', key: 'anonymous', value: true });
    const back = (await run('setViewVisible', { space: 's', view: 'cards', visible: true })) as Row;
    expect(back.hiddenViews).toEqual(['map']);
    expect(await all('SpacePreference')).toMatchObject([
      {
        id: made.id,
        spaceUuid: 's',
        hiddenViews: ['map'],
        mutedModules: ['call'],
        templateId: 'mine',
        moduleSettings: { polls: { anonymous: true } },
      },
    ]);
    // Withdrawing the only answer in a group takes the group away.
    await run('setMyModuleSetting', { space: 's', group: 'polls', key: 'anonymous' });
    expect((await all('SpacePreference'))[0]?.moduleSettings).toEqual({});
  });
});

describe('the space’s settings', () => {
  let space: Row;
  beforeEach(async () => {
    space = await model('Space').create(dataset, { name: 'S', description: '' });
  });
  const stored = async () => (await model('Space').findOne(dataset, { where: { id: space.id } }))!;

  it('a first module toggle pins the fallback, and later ones change the stored list', async () => {
    expect(await run('setModuleEnabled', { space: space.id, module: 'polls', on: true, fallback: ['call'] })).toEqual([
      'call',
      'polls',
    ]);
    await run('setModuleEnabled', { space: space.id, module: 'call', on: false, fallback: ['call', 'globe'] });
    await run('setModuleEnabled', { space: space.id, module: 'polls', on: true });
    expect((await stored()).enabledModules).toEqual(['polls']);
  });

  it('views: appended, taken out, reordered only among those on, unknown ones kept where they are', async () => {
    await model('Space').create(dataset, { name: 'other', description: '' });
    const id = space.id;
    await run('setViewEnabled', { space: id, view: 'cards', on: true, fallback: ['feed', 'future'] });
    expect((await stored()).enabledViews).toEqual(['feed', 'future', 'cards']);
    await run('setViewEnabled', { space: id, view: 'feed', on: false });
    await run('reorderViews', { space: id, order: ['cards', 'map', 'future'] });
    expect((await stored()).enabledViews).toEqual(['cards', 'future']);
  });

  it('archives a workflow once, and brings it back', async () => {
    await run('setWorkflowArchived', { space: space.id, workflow: 'review', archived: true });
    await run('setWorkflowArchived', { space: space.id, workflow: 'review', archived: true });
    expect((await stored()).archivedWorkflows).toEqual(['review']);
    await run('setWorkflowArchived', { space: space.id, workflow: 'review', archived: false });
    expect((await stored()).archivedWorkflows).toEqual([]);
  });

  it('writes and withdraws a community setting, leaving its other groups alone', async () => {
    await run('setSpaceModuleSetting', { space: space.id, group: 'polls', key: 'anonymous', value: false });
    await run('setSpaceModuleSetting', { space: space.id, group: 'call', key: 'record', value: 'ask' });
    await run('setSpaceModuleSetting', { space: space.id, group: 'polls', key: 'anonymous' });
    expect((await stored()).moduleSettings).toEqual({ call: { record: 'ask' } });
  });

  it('a collection’s interpretation: the switch, and one model in or out of its own list or the fallback', async () => {
    const call = await model('CollectionBlock').create(dataset, { kind: 'call' });
    await run('setCollectionInterpretation', { collection: call.id, autoExtract: false });
    await run('setCollectionInterpretation', {
      collection: call.id,
      entity: 'Decision',
      on: true,
      fallback: ['TaskBlock'],
    });
    await run('setCollectionInterpretation', { collection: call.id, entity: 'TaskBlock', on: false });
    expect(await model('CollectionBlock').findOne(dataset, { where: { id: call.id } })).toMatchObject({
      autoExtract: false,
      extractionTargets: ['Decision'],
    });
  });

  it('meta: the space’s own place replaced, an event’s place untouched, and taken away', async () => {
    const elsewhere = await model('LocationBlock').create(dataset, { latitude: 9, longitude: 9 });
    await run('updateSpaceMeta', {
      space: space.id,
      name: 'Renamed',
      location: { latitude: 1, longitude: 2, city: 'A' },
    });
    const first = (await stored()).location as string;
    await run('updateSpaceMeta', { space: space.id, location: { latitude: 3, longitude: 4 } });
    const second = (await stored()).location as string;
    expect(second).not.toBe(first);
    expect((await stored()).name).toBe('Renamed');
    expect((await all('LocationBlock')).map((l) => l.id).sort()).toEqual([elsewhere.id, second].sort());
    await run('updateSpaceMeta', { space: space.id, clearLocation: true });
    expect((await all('LocationBlock')).map((l) => l.id)).toEqual([elsewhere.id]);
  });

  it('makes the space’s collection once', async () => {
    const root = await run('makeSpaceCollection', {
      space: space.id,
      autoExtract: true,
      extractionTargets: ['TaskBlock'],
    });
    expect((await stored()).root).toBe(root);
    expect(await model('CollectionBlock').findOne(dataset, { where: { id: root } })).toMatchObject({
      kind: 'channel',
      mode: 'feed',
      autoExtract: true,
    });
    expect(await errorOf(run('makeSpaceCollection', { space: space.id }))).toBe('precondition:hasCollection');
  });
});
