/**
 * Reading the engine's runs and proposals back as the contract's records — pure, so pinned here
 * without an executor.
 */
import { describe, expect, it } from 'vitest';

import { type EngineProposal, itemOf, openMoves, type Run, runFor, stepsOf } from '../src/flowRuns';

const run = (id: string, subject: string, startedAt?: number, state = 'todo'): Run => ({
  id,
  subject,
  state,
  ...(startedAt !== undefined ? { startedAt } : {}),
});

const proposal = (over: Partial<EngineProposal> & Pick<EngineProposal, 'id' | 'to'>): EngineProposal => ({
  run: 'r1',
  from: 'todo',
  proposer: 'did:a',
  voters: ['did:a'],
  settled: false,
  evidence: [],
  ...over,
});

const anybody =
  (count = 1) =>
  () => ({ count, restricted: false });

describe('runFor', () => {
  it('picks the earliest started run of the subject, whoever asks', () => {
    const runs = [run('r2', 'task', 20), run('r1', 'task', 10), run('r3', 'other', 1)];
    expect(runFor(runs, 'task')?.id).toBe('r1');
    expect(runFor([...runs].reverse(), 'task')?.id).toBe('r1');
  });

  it('breaks a tie on the id, so two readers holding the same runs agree', () => {
    expect(runFor([run('b', 'task', 5), run('a', 'task', 5)], 'task')?.id).toBe('a');
  });

  it('prefers a run with a start time over one without, and answers nothing for a subject with none', () => {
    expect(runFor([run('a', 'task'), run('b', 'task', 5)], 'task')?.id).toBe('b');
    expect(runFor([run('a', 'task', 1)], 'nope')).toBeUndefined();
  });
});

describe('openMoves', () => {
  const current = run('r1', 'task', 1, 'todo');

  it('merges twin proposals for one move and keeps every voter once, in the order they asked', () => {
    const proposals = [
      proposal({ id: 'p2', to: 'done', proposer: 'did:b', voters: ['did:b', 'did:a'], proposedAt: 20 }),
      proposal({
        id: 'p1',
        to: 'done',
        proposer: 'did:a',
        voters: ['did:a', 'did:c'],
        proposedAt: 10,
        rationale: 'Ready',
      }),
    ];
    expect(openMoves(proposals, current)).toEqual([
      { to: 'done', proposals: ['p1', 'p2'], approvers: ['did:a', 'did:c', 'did:b'], askedAt: 10, note: 'Ready' },
    ]);
  });

  it('leaves out settled proposals, proposals from a state the run has left, and other runs', () => {
    const proposals = [
      proposal({ id: 'settled', to: 'doing', settled: true }),
      proposal({ id: 'stale', to: 'done', from: 'doing' }),
      proposal({ id: 'elsewhere', to: 'done', run: 'r9' }),
      proposal({ id: 'open', to: 'blocked' }),
    ];
    expect(openMoves(proposals, current).map((m) => m.to)).toEqual(['blocked']);
  });
});

describe('itemOf', () => {
  it('reads a run at the entry, or not derived here, as having no state', () => {
    expect(itemOf(run('r1', 'task', 1, '_entry'), [], anybody()).state).toBeNull();
    expect(itemOf(run('r1', 'task', 1, ''), [], anybody()).state).toBeNull();
    expect(itemOf(run('r1', 'task', 1, 'todo'), [], anybody())).toEqual({
      record: 'task',
      state: 'todo',
      since: 1,
      waiting: [],
      stalled: false,
    });
  });

  it('calls a record stalled when two moves out of its state each have their asks and neither happened', () => {
    const proposals = [
      proposal({ id: 'p1', to: 'adopted', voters: ['did:a', 'did:b'] }),
      proposal({ id: 'p2', to: 'rejected', voters: ['did:c', 'did:d'] }),
    ];
    expect(itemOf(run('r1', 'task', 1), proposals, anybody(2)).stalled).toBe(true);
    expect(itemOf(run('r1', 'task', 1), proposals, anybody(3)).stalled).toBe(false);
  });

  it('never infers a stall in a state that counts only some people — the asks may not count', () => {
    const proposals = [
      proposal({ id: 'p1', to: 'adopted', voters: ['did:a'] }),
      proposal({ id: 'p2', to: 'rejected', voters: ['did:c'] }),
    ];
    expect(itemOf(run('r1', 'task', 1), proposals, () => ({ count: 1, restricted: true })).stalled).toBe(false);
  });
});

describe('stepsOf', () => {
  it('lists settled moves oldest first, joins twins, and leaves out placing the record', () => {
    const r = run('r1', 'task', 1, 'done');
    const proposals = [
      proposal({ id: 'enter', from: '_entry', to: 'todo', settled: true, proposedAt: 1 }),
      proposal({
        id: 'p2',
        from: 'todo',
        to: 'done',
        voters: ['did:b'],
        settled: true,
        proposedAt: 6,
        evidence: ['e2'],
      }),
      proposal({
        id: 'p1',
        from: 'todo',
        to: 'done',
        voters: ['did:a'],
        settled: true,
        proposedAt: 5,
        evidence: ['e1'],
      }),
      proposal({ id: 'open', from: 'done', to: 'todo', proposedAt: 9 }),
    ];
    expect(stepsOf(proposals, r)).toEqual([
      { from: 'todo', to: 'done', approvers: ['did:a', 'did:b'], at: 5, evidence: ['e1', 'e2'] },
    ]);
  });
});
