import { describe, expect, it } from 'vitest';

import {
  type FlowProposal,
  type FlowProposeResult,
  type FlowRun,
  type FlowSnapshot,
  openMoves,
  readProposeResult,
  runFor,
} from './flows';

const run = (id: string, subject: string, startedAt?: number, state = 'todo'): FlowRun => ({
  id,
  subject,
  state,
  ...(startedAt !== undefined ? { startedAt } : {}),
});

const proposal = (over: Partial<FlowProposal> & Pick<FlowProposal, 'id' | 'to'>): FlowProposal => ({
  run: 'r1',
  from: 'todo',
  proposer: 'did:a',
  voters: ['did:a'],
  settled: false,
  ...over,
});

describe('runFor', () => {
  it('picks the earliest started run of the subject, whoever asks', () => {
    const runs = [run('r2', 'task', 20), run('r1', 'task', 10), run('r3', 'other', 1)];
    expect(runFor(runs, 'task')?.id).toBe('r1');
    expect(runFor([...runs].reverse(), 'task')?.id).toBe('r1');
  });

  it('breaks a tie on the id, so two readers holding the same runs agree', () => {
    expect(runFor([run('b', 'task', 5), run('a', 'task', 5)], 'task')?.id).toBe('a');
  });

  it('prefers a run with a start time over one without', () => {
    expect(runFor([run('a', 'task'), run('b', 'task', 5)], 'task')?.id).toBe('b');
  });

  it('answers nothing for a subject with no run', () => {
    expect(runFor([run('a', 'task', 1)], 'nope')).toBeUndefined();
  });
});

describe('openMoves', () => {
  const current = run('r1', 'task', 1, 'todo');

  it('merges twin proposals for one move and keeps every voter once, in the order they asked', () => {
    const snapshot: FlowSnapshot = {
      runs: [current],
      proposals: [
        proposal({ id: 'p2', to: 'done', proposer: 'did:b', voters: ['did:b', 'did:a'], proposedAt: 20 }),
        proposal({ id: 'p1', to: 'done', proposer: 'did:a', voters: ['did:a', 'did:c'], proposedAt: 10 }),
      ],
    };
    expect(openMoves(snapshot, current)).toEqual([
      { to: 'done', proposals: ['p1', 'p2'], voters: ['did:a', 'did:c', 'did:b'], proposer: 'did:a', proposedAt: 10 },
    ]);
  });

  it('leaves out settled proposals, proposals from a state the run has left, and other runs', () => {
    const snapshot: FlowSnapshot = {
      runs: [current],
      proposals: [
        proposal({ id: 'settled', to: 'doing', settled: true }),
        proposal({ id: 'stale', to: 'done', from: 'doing' }),
        proposal({ id: 'elsewhere', to: 'done', run: 'r9' }),
        proposal({ id: 'open', to: 'blocked' }),
      ],
    };
    expect(openMoves(snapshot, current).map((m) => m.to)).toEqual(['blocked']);
  });
});

describe('readProposeResult', () => {
  const base: FlowProposeResult = {
    proposal: 'p',
    opened: true,
    voted: true,
    moves: [],
    state: 'todo',
    stalled: false,
  };

  it('reads the four cases a surface tells apart', () => {
    expect(readProposeResult({ ...base, moves: [{ from: 'todo', to: 'done', voters: ['did:a'] }] })).toBe('moved');
    expect(readProposeResult(base)).toBe('waiting');
    expect(readProposeResult({ ...base, opened: false, voted: false })).toBe('already-voted');
  });

  it('says a stuck run is stuck, even when the call also recorded a vote', () => {
    expect(readProposeResult({ ...base, stalled: true })).toBe('stalled');
  });
});
