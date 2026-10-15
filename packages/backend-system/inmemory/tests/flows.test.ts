/**
 * The in-memory flow port — the semantics a surface relies on, with several agents asking.
 *
 * Several agents are one process here, so "who is signed in" is a variable the test moves between
 * calls. That is the whole reason these tests can exist without an executor: against a real backend,
 * two people agreeing on one move needs two identities sharing one dataset.
 */
import type { DatasetHandle, FlowDefinition, FlowPort, FlowView } from '@we/backend-shared';
import { itemFor } from '@we/backend-shared';
import { getEntity } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const ALICE = 'did:test:alice';
const BOB = 'did:test:bob';
const CAROL = 'did:test:carol';

/**
 * Todo → Doing needs one; Done needs two; Review needs one from whoever is reviewing the task;
 * Shipped needs a response on the task marked as a release note.
 */
const FLOW: FlowDefinition = {
  name: 'Tasks',
  subjects: ['TaskBlock'],
  states: [
    { name: 'todo' },
    { name: 'doing' },
    { name: 'done', requires: [{ kind: 'approvals', count: 2 }] },
    {
      name: 'review',
      requires: [
        {
          kind: 'approvals',
          count: 1,
          from: { entity: 'Involvement', agentField: 'agent', where: { kind: 'reviewing' }, subjectField: 'node' },
        },
      ],
    },
    {
      name: 'shipped',
      requires: [
        { kind: 'guard', entity: 'TextBlock', where: { text: 'release note' }, tie: { relation: 'responses' } },
      ],
    },
  ],
  transitions: [
    { from: 'todo', to: 'doing' },
    { from: 'doing', to: 'todo' },
    { from: 'doing', to: 'done' },
    { from: 'done', to: 'doing' },
    { from: 'doing', to: 'review' },
    { from: 'doing', to: 'shipped' },
  ],
};

let signedIn = ALICE;
let flows: FlowPort;
let dataset: DatasetHandle;
let task: string;

type Created = { id: string; save(): Promise<void>; [key: string]: unknown };
const model = (name: string) =>
  getEntity(name) as unknown as { create(dataset: unknown, data: Record<string, unknown>): Promise<Created> };

beforeEach(async () => {
  signedIn = ALICE;
  const ports = createInMemoryBackendPorts(
    { selfId: () => signedIn },
    { agent: { id: ALICE, unlocked: true }, datasets: [{ id: 'ds', name: 'Space' }] },
  );
  flows = ports.flows!;
  dataset = (await ports.lifecycle.get('ds'))!.handle;
  await flows.install(dataset, FLOW);
  task = (await model('TaskBlock').create(dataset, { title: 'Ship it' })).id;
});

const as = async <T>(did: string, act: () => Promise<T>): Promise<T> => {
  signedIn = did;
  try {
    return await act();
  } finally {
    signedIn = ALICE;
  }
};

async function latest(): Promise<FlowView> {
  let seen: FlowView | undefined;
  const stop = await flows.watch(dataset, 'Tasks', (v) => (seen = v));
  await new Promise((r) => setTimeout(r, 0));
  stop();
  return seen!;
}

const move = (to: string, opts?: { from?: string; note?: string }) => flows.move(dataset, 'Tasks', task, to, opts);

describe('in-memory flows: definitions', () => {
  it('lists, reads back exactly what was installed, and refuses one it cannot enforce', async () => {
    expect(await flows.list(dataset)).toEqual([{ name: 'Tasks', editable: true, records: 0 }]);
    expect(await flows.read(dataset, 'Tasks')).toEqual(FLOW);
    expect(await flows.read(dataset, 'Missing')).toBeNull();
    await expect(
      flows.install(dataset, { ...FLOW, name: 'Bad', transitions: [{ from: 'todo', to: 'nowhere' }] }),
    ).rejects.toThrow('not a state of this flow');
  });

  it('refuses to remove a flow while a record is going through it, and removes one that has none', async () => {
    await flows.start(dataset, 'Tasks', task);
    await expect(flows.remove(dataset, 'Tasks')).rejects.toThrow('still has 1 record');
    await flows.install(dataset, { ...FLOW, name: 'Empty' });
    await flows.remove(dataset, 'Empty');
    expect((await flows.list(dataset)).map((f) => f.name)).toEqual(['Tasks']);
  });
});

describe('in-memory flows: moves', () => {
  it('starts a record in the first state, or where it is told, and finds it again rather than restarting it', async () => {
    expect((await flows.start(dataset, 'Tasks', task)).state).toBe('todo');
    expect((await as(BOB, () => flows.start(dataset, 'Tasks', task, { at: 'doing' }))).state).toBe('todo');
    const other = (await model('TaskBlock').create(dataset, { title: 'Other' })).id;
    expect((await flows.start(dataset, 'Tasks', other, { at: 'doing' })).state).toBe('doing');
  });

  it('enters a record the flow has not seen where the caller says it already stands', async () => {
    const result = await move('done', { from: 'doing' });
    expect(result).toMatchObject({ outcome: 'waiting', state: 'doing', to: 'done', voted: true });
  });

  it('moves at once where one ask is enough, and reports it as a step', async () => {
    const result = await move('doing', { note: 'Starting' });
    expect(result).toEqual({
      outcome: 'moved',
      state: 'doing',
      steps: [{ from: 'todo', to: 'doing', voters: [ALICE], at: expect.any(Number), evidence: [], note: 'Starting' }],
    });
  });

  it('treats asking for where a record already stands as done', async () => {
    await move('doing');
    expect(await move('doing')).toEqual({ outcome: 'moved', state: 'doing', steps: [] });
  });

  it('waits for a second person where two are needed, and one person asking twice is still one', async () => {
    await move('doing');
    expect(await move('done')).toMatchObject({ outcome: 'waiting', voted: true, voters: [ALICE] });
    expect(await move('done')).toMatchObject({ outcome: 'waiting', voted: false, voters: [ALICE] });
    expect(itemFor(await latest(), task)?.waiting).toMatchObject([{ to: 'done', voters: [ALICE] }]);

    const bob = await as(BOB, () => move('done'));
    expect(bob).toMatchObject({
      outcome: 'moved',
      state: 'done',
      steps: [{ from: 'doing', to: 'done', voters: [ALICE, BOB] }],
    });
    expect(itemFor(await latest(), task)).toMatchObject({ state: 'done', waiting: [] });
  });

  it('refuses a move the record cannot make from where it stands, writing nothing', async () => {
    expect(await move('done')).toEqual({ outcome: 'refused', reason: 'not-allowed', state: 'todo' });
    expect(itemFor(await latest(), task)?.waiting).toEqual([]);
  });

  it('counts only the people the role names for this record, and records an ask that did not count', async () => {
    const involve = async (agent: string, node: string) => {
      const row = await model('Involvement').create(dataset, { agent, kind: 'reviewing' });
      row.node = [node];
      await row.save();
    };
    const other = (await model('TaskBlock').create(dataset, { title: 'Other' })).id;
    await involve(BOB, task);
    await involve(CAROL, other);
    await move('doing');

    expect(await move('review')).toMatchObject({ outcome: 'waiting' });
    expect(await as(CAROL, () => move('review'))).toMatchObject({ outcome: 'waiting', voters: [ALICE, CAROL] });
    const bob = await as(BOB, () => move('review'));
    expect(bob).toMatchObject({ outcome: 'moved', steps: [{ voters: [BOB] }] });
  });

  it('refuses a move whose guard does not hold, and makes it with the guard’s records as evidence once it does', async () => {
    await move('doing');
    expect(await move('shipped')).toEqual({ outcome: 'refused', reason: 'unmet', state: 'doing' });

    const note = await model('TextBlock').create(dataset, { text: 'release note' });
    const Task = getEntity('TaskBlock') as unknown as {
      findAll(d: unknown, q: unknown): Promise<Array<{ addResponses(id: string): Promise<void> }>>;
    };
    const [row] = await Task.findAll(dataset, { where: { id: task } });
    await row.addResponses(note.id);

    const shipped = await move('shipped');
    expect(shipped).toMatchObject({ outcome: 'moved', steps: [{ to: 'shipped', evidence: [note.id] }] });
    expect((await flows.history(dataset, 'Tasks', task)).map((s) => s.to)).toEqual(['doing', 'shipped']);
  });

  it('closes every ask out of a state the record has left', async () => {
    await move('doing');
    await move('done');
    await move('todo');
    expect(itemFor(await latest(), task)).toMatchObject({ state: 'todo', waiting: [] });
  });
});

describe('in-memory flows: withdrawing', () => {
  it('takes back only the caller’s own asks, and never a move that happened', async () => {
    await move('doing');
    await move('done');
    await as(BOB, () => flows.withdraw(dataset, 'Tasks', task));
    expect(itemFor(await latest(), task)?.waiting).toMatchObject([{ to: 'done', voters: [ALICE] }]);

    expect(await flows.withdraw(dataset, 'Tasks', task)).toBe(1);
    expect(itemFor(await latest(), task)).toMatchObject({ state: 'doing', waiting: [] });
  });
});

describe('in-memory flows: watching', () => {
  it('tells a watcher about a peer’s ask', async () => {
    await move('doing');
    const seen: FlowView[] = [];
    const stop = await flows.watch(dataset, 'Tasks', (v) => seen.push(v));
    await as(BOB, () => move('done'));
    await new Promise((r) => setTimeout(r, 0));
    stop();
    expect(itemFor(seen.at(-1), task)?.waiting).toMatchObject([{ to: 'done', voters: [BOB] }]);
  });
});
