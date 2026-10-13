/**
 * Lanes read out of a definition and compiled back — the round trip that lets a flow be edited as a
 * main line and branches while only states and moves are stored.
 */
import type { FlowDefinition } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { finalStates, type FlowLanes, toDefinition, toLanes, walkOf } from '../src/shared/flowLanes';

const base = { name: 'Flow', subjects: ['TaskBlock'] };
const pairs = (definition: FlowDefinition) => definition.transitions.map((t) => `${t.from}>${t.to}`).sort();

const roundTrips = (model: FlowLanes) => {
  const definition = toDefinition(base, model, {});
  const read = toLanes(definition);
  expect(read.fits).toBe(true);
  expect(read.model).toEqual(model);
  return definition;
};

describe('lanes', () => {
  it('compiles a main line under `next` and reads it back', () => {
    const definition = roundTrips({ rule: 'next', lanes: [{ states: ['a', 'b', 'c'] }], exceptions: [] });
    expect(pairs(definition)).toEqual(['a>b', 'b>c']);
    expect(finalStates(definition)).toEqual(['c']);
  });

  it('adds the way back under `next-and-back`, but never out of a final state', () => {
    const definition = roundTrips({ rule: 'next-and-back', lanes: [{ states: ['a', 'b', 'c'] }], exceptions: [] });
    expect(pairs(definition)).toEqual(['a>b', 'b>a', 'b>c']);
  });

  it('forks the end of a proposal into two final states', () => {
    const definition = roundTrips({
      rule: 'next',
      lanes: [{ states: ['draft', 'discussion', 'vote', 'adopted'] }, { states: ['rejected'], leaves: 'vote' }],
      exceptions: [],
    });
    expect(pairs(definition)).toEqual(['discussion>vote', 'draft>discussion', 'vote>adopted', 'vote>rejected']);
    expect(finalStates(definition)).toEqual(['adopted', 'rejected']);
  });

  it('reads a detour that comes back as a branch rejoining where it left', () => {
    const definition = roundTrips({
      rule: 'next',
      lanes: [
        { states: ['draft', 'review', 'published'] },
        { states: ['changes'], leaves: 'review', rejoins: 'review' },
      ],
      exceptions: [],
    });
    expect(pairs(definition)).toEqual(['changes>review', 'draft>review', 'review>changes', 'review>published']);
  });

  it('reads the same detour under `next-and-back`, where the way back is the rule’s', () => {
    roundTrips({
      rule: 'next-and-back',
      lanes: [
        { states: ['draft', 'review', 'published'] },
        { states: ['changes'], leaves: 'review', rejoins: 'review' },
      ],
      exceptions: [],
    });
  });

  it('reads a split that rejoins, and one that never does', () => {
    roundTrips({
      rule: 'next',
      lanes: [
        { states: ['triage', 'quick', 'release'] },
        { states: ['design', 'review'], leaves: 'triage', rejoins: 'release' },
        { states: ['wontfix'], leaves: 'triage' },
      ],
      exceptions: [],
    });
  });

  it('keeps a move nothing else covers as an exception', () => {
    const definition = roundTrips({
      rule: 'next',
      lanes: [{ states: ['draft', 'discussion', 'vote', 'adopted'] }, { states: ['rejected'], leaves: 'vote' }],
      exceptions: [{ from: 'discussion', to: 'rejected', name: 'withdraw' }],
    });
    expect(definition.transitions.at(-1)).toEqual({ from: 'discussion', to: 'rejected', name: 'withdraw' });
  });

  it('reads a board that allows every move as `any`', () => {
    const definition = roundTrips({ rule: 'any', lanes: [{ states: ['todo', 'doing', 'done'] }], exceptions: [] });
    expect(definition.transitions).toHaveLength(6);
  });

  it('carries what each state requires through, without lanes having a say', () => {
    const definition = toDefinition(
      base,
      { rule: 'next', lanes: [{ states: ['a', 'b'] }], exceptions: [] },
      {
        b: { requires: [{ kind: 'approvals', count: 2 }], hint: 'Agreed.' },
      },
    );
    expect(definition.states).toEqual([
      { name: 'a' },
      { name: 'b', requires: [{ kind: 'approvals', count: 2 }], hint: 'Agreed.' },
    ]);
  });

  it('says a definition whose order lanes would change does not fit', () => {
    // A branch state placed before the main line it leaves from: lanes would reorder it.
    const foreign: FlowDefinition = {
      ...base,
      states: [{ name: 'side' }, { name: 'a' }, { name: 'b' }],
      transitions: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'side' },
      ],
    };
    expect(toLanes(foreign).fits).toBe(false);
  });
});

describe('walkOf', () => {
  const model: FlowLanes = {
    rule: 'next',
    lanes: [{ states: ['draft', 'discussion', 'vote', 'adopted'] }, { states: ['rejected'], leaves: 'vote' }],
    exceptions: [],
  };
  const definition = toDefinition(base, model, {});

  it('marks the walk so far done, where it stands current, and the rest ahead', () => {
    expect(walkOf(definition, model, 'discussion')).toEqual({
      steps: [
        { name: 'draft', at: 'done' },
        { name: 'discussion', at: 'current' },
        { name: 'vote', at: 'ahead' },
        { name: 'adopted', at: 'ahead' },
      ],
      next: ['vote'],
    });
  });

  it('offers both ends at the fork', () => {
    expect(walkOf(definition, model, 'vote').next).toEqual(['adopted', 'rejected']);
  });

  it('walks the main line up to where a branch leaves, then the branch', () => {
    expect(walkOf(definition, model, 'rejected').steps.map((s) => `${s.name}:${s.at}`)).toEqual([
      'draft:done',
      'discussion:done',
      'vote:done',
      'rejected:current',
    ]);
  });

  it('draws a record with no known state as all ahead, able to enter the first', () => {
    const walk = walkOf(definition, model, null);
    expect(walk.steps.every((s) => s.at === 'ahead')).toBe(true);
    expect(walk.next).toEqual(['draft']);
  });
});
