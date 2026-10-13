import { describe, expect, it } from 'vitest';

import {
  allowedMoves,
  approvalsFor,
  asksForMore,
  type FlowCapabilities,
  type FlowDefinition,
  guardsFor,
  isFinalState,
  validateFlowDefinition,
} from './flows';

const PROPOSAL: FlowDefinition = {
  name: 'Proposal',
  subjects: ['TextBlock'],
  states: [
    { name: 'draft' },
    { name: 'discussion' },
    { name: 'vote' },
    { name: 'adopted', requires: [{ kind: 'approvals', count: 3 }] },
    { name: 'rejected', requires: [{ kind: 'approvals', count: 3 }] },
  ],
  transitions: [
    { from: 'draft', to: 'discussion' },
    { from: 'discussion', to: 'vote' },
    { from: 'vote', to: 'adopted' },
    { from: 'vote', to: 'rejected' },
  ],
};

const SERVER: FlowCapabilities = {
  requirements: ['approvals'],
  enforcement: 'server',
  sealedEvidence: false,
  contention: 'first',
};

describe('validateFlowDefinition', () => {
  it('finds nothing wrong with a sound definition', () => {
    expect(validateFlowDefinition(PROPOSAL)).toEqual([]);
  });

  it('refuses a state name the backend keeps for itself, and one used twice', () => {
    const problems = validateFlowDefinition({
      ...PROPOSAL,
      states: [...PROPOSAL.states, { name: '_entry' }, { name: 'draft' }],
    });
    expect(problems.some((p) => p.includes('"_entry"'))).toBe(true);
    expect(problems.some((p) => p.includes('Two states are called "draft"'))).toBe(true);
  });

  it('refuses a move naming a state the flow does not have', () => {
    const problems = validateFlowDefinition({ ...PROPOSAL, transitions: [{ from: 'draft', to: 'published' }] });
    expect(problems).toEqual(['A move names "published", which is not a state of this flow.']);
  });

  it('refuses two approval rules on one state, and a count below one', () => {
    const problems = validateFlowDefinition({
      ...PROPOSAL,
      states: [
        {
          name: 'draft',
          requires: [
            { kind: 'approvals', count: 2 },
            { kind: 'approvals', count: 0 },
          ],
        },
        ...PROPOSAL.states.slice(1),
      ],
    });
    expect(problems.some((p) => p.includes('asks for approvals twice'))).toBe(true);
    expect(problems.some((p) => p.includes('asks for 0 approvals'))).toBe(true);
  });

  it('refuses a requirement the backend says it cannot enforce', () => {
    const guarded: FlowDefinition = {
      ...PROPOSAL,
      states: [
        { name: 'draft', requires: [{ kind: 'guard', entity: 'Comment', tie: { relation: 'responses' } }] },
        ...PROPOSAL.states.slice(1),
      ],
    };
    expect(validateFlowDefinition(guarded)).toEqual([]);
    expect(validateFlowDefinition(guarded, SERVER)).toEqual([
      '"draft" requires guard, which this backend cannot enforce.',
    ]);
  });
});

describe('readings', () => {
  it('offers the moves out of where a record stands, and only the first state to a record with none', () => {
    expect(allowedMoves(PROPOSAL, 'vote')).toEqual(['adopted', 'rejected']);
    expect(allowedMoves(PROPOSAL, null)).toEqual(['draft']);
  });

  it('calls a state no move leaves final', () => {
    expect(isFinalState(PROPOSAL, 'adopted')).toBe(true);
    expect(isFinalState(PROPOSAL, 'vote')).toBe(false);
  });

  it('reads one ask from anybody where a state says nothing', () => {
    expect(approvalsFor(PROPOSAL.states[0])).toEqual({ count: 1 });
    expect(approvalsFor(PROPOSAL.states[3])).toEqual({ count: 3 });
    expect(asksForMore(PROPOSAL.states[0])).toBe(false);
    expect(asksForMore(PROPOSAL.states[3])).toBe(true);
  });

  it('counts a guard alone as asking for more', () => {
    const state = {
      name: 'review',
      requires: [{ kind: 'guard' as const, entity: 'Document', tie: { relation: 'responses' } }],
    };
    expect(guardsFor(state)).toHaveLength(1);
    expect(asksForMore(state)).toBe(true);
  });
});
