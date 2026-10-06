/**
 * The in-memory flow port — the semantics a surface relies on, with several agents voting.
 *
 * Several agents are one process here, so "who is signed in" is a variable the test moves between
 * calls. That is the whole reason these tests can exist without an executor: against a real backend,
 * two people agreeing on one move needs two identities sharing one dataset.
 */
import type { DatasetHandle, FlowDefinition, FlowPort, FlowSnapshot } from '@we/backend-shared';
import { openMoves, readProposeResult, runFor } from '@we/backend-shared';
import { getEntity } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const ALICE = 'did:test:alice';
const BOB = 'did:test:bob';
const CAROL = 'did:test:carol';

/** Todo → Doing needs one; Done needs two; Review needs one from whoever is reviewing the task. */
const FLOW: FlowDefinition = {
  name: 'Tasks',
  subjects: ['TaskBlock'],
  states: [
    { name: 'todo' },
    { name: 'doing' },
    { name: 'done', approvals: 2 },
    {
      name: 'review',
      role: { entity: 'Involvement', agentField: 'agent', where: { kind: 'reviewing' }, subjectField: 'node' },
    },
  ],
  transitions: [
    { from: 'todo', to: 'doing' },
    { from: 'doing', to: 'todo' },
    { from: 'doing', to: 'done' },
    { from: 'done', to: 'doing' },
    { from: 'doing', to: 'review' },
  ],
};

let signedIn = ALICE;
let flows: FlowPort;
let dataset: DatasetHandle;

beforeEach(async () => {
  signedIn = ALICE;
  const ports = createInMemoryBackendPorts(
    { selfId: () => signedIn },
    { agent: { id: ALICE, unlocked: true }, datasets: [{ id: 'ds', name: 'Space' }] },
  );
  flows = ports.flows!;
  dataset = (await ports.lifecycle.get('ds'))!.handle;
  await flows.install(dataset, FLOW);
});

const as = async <T>(did: string, act: () => Promise<T>): Promise<T> => {
  signedIn = did;
  try {
    return await act();
  } finally {
    signedIn = ALICE;
  }
};

async function latest(): Promise<FlowSnapshot> {
  let seen: FlowSnapshot | undefined;
  const stop = await flows.watch(dataset, 'Tasks', (s) => (seen = s));
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  stop();
  return seen!;
}

describe('in-memory flows', () => {
  it('starts every run in the first state, and finds the same run again rather than starting another', async () => {
    const first = await flows.start(dataset, 'Tasks', 'task-1');
    const again = await as(BOB, () => flows.start(dataset, 'Tasks', 'task-1'));
    expect(first.state).toBe('todo');
    expect(again.id).toBe(first.id);
  });

  it('moves at once where one approval is enough', async () => {
    const run = await flows.start(dataset, 'Tasks', 'task-1');
    const result = await flows.propose(dataset, run.id, 'doing');
    expect(readProposeResult(result)).toBe('moved');
    expect(result.moves).toEqual([{ from: 'todo', to: 'doing', voters: [ALICE] }]);
    expect(result.state).toBe('doing');
  });

  it('waits for a second person where two are needed, and the second joins rather than opening a twin', async () => {
    const run = await flows.start(dataset, 'Tasks', 'task-1');
    await flows.propose(dataset, run.id, 'doing');

    const alice = await flows.propose(dataset, run.id, 'done');
    expect(readProposeResult(alice)).toBe('waiting');
    expect(alice.opened).toBe(true);

    const again = await flows.propose(dataset, run.id, 'done');
    expect(readProposeResult(again)).toBe('already-voted');

    const snapshot = await latest();
    const current = runFor(snapshot.runs, 'task-1')!;
    expect(openMoves(snapshot, current)).toMatchObject([{ to: 'done', voters: [ALICE] }]);

    const bob = await as(BOB, () => flows.propose(dataset, run.id, 'done'));
    expect(bob.opened).toBe(false);
    expect(bob.proposal).toBe(alice.proposal);
    expect(readProposeResult(bob)).toBe('moved');
    expect(bob.moves[0]).toEqual({ from: 'doing', to: 'done', voters: [ALICE, BOB] });
  });

  it('moves a run back when the vote that completed a move is withdrawn', async () => {
    const run = await flows.start(dataset, 'Tasks', 'task-1');
    await flows.propose(dataset, run.id, 'doing');
    const opened = await flows.propose(dataset, run.id, 'done');
    await as(BOB, () => flows.propose(dataset, run.id, 'done'));
    expect(runFor((await latest()).runs, 'task-1')?.state).toBe('done');

    await as(BOB, () => flows.withdraw(dataset, opened.proposal));
    expect(runFor((await latest()).runs, 'task-1')?.state).toBe('doing');
  });

  it('refuses to withdraw what the caller never asked for', async () => {
    const run = await flows.start(dataset, 'Tasks', 'task-1');
    await flows.propose(dataset, run.id, 'doing');
    const opened = await flows.propose(dataset, run.id, 'done');
    await expect(as(CAROL, () => flows.withdraw(dataset, opened.proposal))).rejects.toThrow();
  });

  it('refuses a move the run cannot make from where it stands, naming that state', async () => {
    const run = await flows.start(dataset, 'Tasks', 'task-1');
    await expect(flows.propose(dataset, run.id, 'done')).rejects.toThrow('`done` is not reachable from `todo`');
  });

  it('counts only the people the role names for this record, and a vote that did not count is still recorded', async () => {
    const Involvement = getEntity('Involvement') as unknown as {
      create(dataset: unknown, data: Record<string, unknown>): Promise<{ node?: unknown; save(): Promise<void> }>;
    };
    // The in-memory backend sets a to-one link through the record rather than through `create`.
    const involve = async (agent: string, node: string) => {
      const row = await Involvement.create(dataset, { agent, kind: 'reviewing' });
      row.node = [node];
      await row.save();
    };
    // Bob reviews task-1; Carol reviews a different task, which makes her nothing here.
    await involve(BOB, 'task-1');
    await involve(CAROL, 'task-2');

    const run = await flows.start(dataset, 'Tasks', 'task-1');
    await flows.propose(dataset, run.id, 'doing');

    const alice = await flows.propose(dataset, run.id, 'review');
    expect(readProposeResult(alice)).toBe('waiting');
    const carol = await as(CAROL, () => flows.propose(dataset, run.id, 'review'));
    expect(readProposeResult(carol)).toBe('waiting');

    const bob = await as(BOB, () => flows.propose(dataset, run.id, 'review'));
    expect(readProposeResult(bob)).toBe('moved');
    expect(bob.moves[0].voters).toEqual([BOB]);
  });

  it('asks again on a second visit: a move that happened consumed the votes that made it', async () => {
    const run = await flows.start(dataset, 'Tasks', 'task-1');
    await flows.propose(dataset, run.id, 'doing');
    await flows.propose(dataset, run.id, 'todo');
    const back = await flows.propose(dataset, run.id, 'doing');
    expect(back.opened).toBe(true);
    expect(back.state).toBe('doing');
  });

  it('tells a watcher about a peer’s vote', async () => {
    const run = await flows.start(dataset, 'Tasks', 'task-1');
    await flows.propose(dataset, run.id, 'doing');
    const seen: FlowSnapshot[] = [];
    const stop = await flows.watch(dataset, 'Tasks', (s) => seen.push(s));
    await as(BOB, () => flows.propose(dataset, run.id, 'done'));
    await new Promise((r) => setTimeout(r, 0));
    stop();
    const last = seen.at(-1)!;
    expect(openMoves(last, runFor(last.runs, 'task-1')!)).toMatchObject([{ to: 'done', voters: [BOB] }]);
  });
});
