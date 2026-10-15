/**
 * Editing a flow as lanes: every edit either gives the next draft or says why not, and every preset is
 * a definition a backend accepts and reads back as the same lanes.
 */
import { validateFlowDefinition } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import {
  addBranch,
  addException,
  addStep,
  definitionOf,
  type DraftEdit,
  draftOf,
  type FlowDraft,
  isRefusal,
  moveStep,
  presetDraft,
  removeStep,
  renameStep,
  setBranchEnd,
  setRequirements,
  setRule,
  stateLabelOf,
  stateNameOf,
} from '../src/shared/flowDraft';
import { finalStates } from '../src/shared/flowLanes';

const ok = (edit: DraftEdit): FlowDraft => {
  if (isRefusal(edit)) throw new Error(edit.refused);
  return edit;
};
const pairs = (draft: FlowDraft) =>
  definitionOf(draft)
    .transitions.map((t) => `${t.from}>${t.to}`)
    .sort();

const blank = () => presetDraft('blank', 'Work', ['TaskBlock']);

describe('presets', () => {
  it.each(['blank', 'review', 'proposal'] as const)('%s is a sound definition that reads back as itself', (preset) => {
    const draft = presetDraft(preset, 'Flow', ['TaskBlock']);
    const definition = definitionOf(draft);
    expect(validateFlowDefinition(definition)).toEqual([]);
    expect(draftOf(definition)).toEqual(draft);
  });

  it('ends a proposal three ways, and lets one person withdraw without asking for a vote', () => {
    const draft = presetDraft('proposal', 'Proposal', ['TextBlock']);
    expect(finalStates(definitionOf(draft))).toEqual(['adopted', 'rejected', 'withdrawn']);
    expect(draft.states.withdrawn?.requires).toBeUndefined();
    expect(pairs(draft)).toContain('draft>withdrawn');
  });
});

describe('editing steps', () => {
  it('names a step from what was typed, and reads it back for a person', () => {
    expect(stateNameOf('  In Review! ')).toBe('in-review');
    expect(stateLabelOf('in-review')).toBe('In review');
  });

  it('adds a step after another, or first, and refuses a name already taken', () => {
    let draft = ok(addStep(blank(), 0, 'Doing', 'start'));
    draft = ok(addStep(draft, 0, 'Inbox'));
    expect(draft.model.lanes[0].states).toEqual(['inbox', 'start', 'doing', 'done']);
    expect(addStep(draft, 0, 'doing')).toEqual({ refused: 'There is already a step called "Doing".' });
  });

  it('moves a step along its lane, and does nothing past either end', () => {
    const draft = ok(moveStep(blank(), 'done', -1));
    expect(draft.model.lanes[0].states).toEqual(['done', 'start']);
    expect(ok(moveStep(draft, 'done', -1)).model.lanes[0].states).toEqual(['done', 'start']);
  });

  it('renames a step everywhere it is named', () => {
    let draft = presetDraft('proposal', 'Proposal', []);
    draft = ok(renameStep(draft, 'vote', 'Decision'));
    expect(draft.model.lanes[1].leaves).toBe('decision');
    expect(draft.states.decision).toBeUndefined();
    expect(pairs(draft)).toContain('decision>adopted');
    expect(renameStep(draft, 'draft', 'Adopted')).toEqual({ refused: 'There is already a step called "Adopted".' });
  });

  it('refuses to remove a step a branch hangs from, and takes the moves naming it with any other', () => {
    const draft = presetDraft('proposal', 'Proposal', []);
    expect(isRefusal(removeStep(draft, 'vote'))).toBe(true);
    const without = ok(removeStep(draft, 'withdrawn'));
    expect(without.model.lanes).toHaveLength(2);
    expect(without.model.exceptions).toEqual([]);
  });
});

describe('branches and rules', () => {
  it('adds a branch that ends, then makes it rejoin', () => {
    let draft = ok(addStep(blank(), 0, 'Review', 'start'));
    draft = ok(addBranch(draft, 'review', 'Changes'));
    expect(finalStates(definitionOf(draft))).toEqual(['done', 'changes']);
    draft = ok(setBranchEnd(draft, 1, 'review'));
    expect(pairs(draft)).toEqual(['changes>review', 'review>changes', 'review>done', 'start>review']);
    expect(draftOf(definitionOf(draft))).toEqual(draft);
  });

  it('refuses `any` while a branch exists, rather than dropping it', () => {
    const draft = ok(addBranch(blank(), 'start', 'Side'));
    expect(isRefusal(setRule(draft, 'any'))).toBe(true);
    expect(ok(setRule(blank(), 'any')).model.rule).toBe('any');
  });

  it('adds an exception only where no move already goes', () => {
    const draft = ok(addStep(blank(), 0, 'Doing', 'start'));
    expect(isRefusal(addException(draft, 'start', 'doing'))).toBe(true);
    expect(pairs(ok(addException(draft, 'start', 'done')))).toContain('start>done');
  });

  it('sets what entering a step requires, and clears it with an empty list', () => {
    let draft = ok(setRequirements(blank(), 'done', [{ kind: 'approvals', count: 2 }]));
    expect(definitionOf(draft).states[1]).toEqual({ name: 'done', requires: [{ kind: 'approvals', count: 2 }] });
    draft = ok(setRequirements(draft, 'done', []));
    expect(definitionOf(draft).states[1]).toEqual({ name: 'done' });
  });
});
