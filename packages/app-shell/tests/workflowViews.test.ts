/**
 * A workflow as a template draws it — steps and requirements in words, and a record's walk.
 */
import type { WorkflowDefinition } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { definitionOf, presetDraft } from '../src/shared/workflowDraft';
import { toLanes } from '../src/shared/workflowLanes';
import {
  approvalsRule,
  editorView,
  evidenceLabel,
  historyView,
  involvementRole,
  kindOf,
  recordView,
  refusalWords,
} from '../src/shared/workflowViews';

const proposal = definitionOf(presetDraft('proposal', 'Proposal', ['TextBlock']));

describe('editorView', () => {
  it('draws the main line and each branch, saying where it leaves and that it ends', () => {
    const view = editorView(proposal);
    expect(view.fits).toBe(true);
    expect(view.lanes.map((l) => [l.main, l.leavesLabel, l.ends, l.steps.map((s) => s.label)])).toEqual([
      [true, '', false, ['Draft', 'Discussion', 'Vote', 'Adopted']],
      [false, 'Vote', true, ['Rejected']],
      [false, 'Discussion', true, ['Withdrawn']],
    ]);
    expect(view.exceptions).toEqual([
      { from: 'draft', to: 'withdrawn', fromLabel: 'Draft', toLabel: 'Withdrawn', name: '' },
    ]);
  });

  it('says what entering a step takes, in words, and which steps are final', () => {
    const adopted = editorView(proposal).lanes[0].steps[3];
    expect(adopted).toMatchObject({
      final: true,
      approvals: 3,
      requires: ['3 approvals'],
      hint: 'Agreed by the group.',
    });
  });

  it('names whose approval counts in the community’s words, and what a requirement needs', () => {
    const definition: WorkflowDefinition = {
      name: 'Review',
      entities: ['TaskBlock'],
      states: [
        { name: 'draft' },
        {
          name: 'review',
          requires: [
            { kind: 'approvals', count: 2, from: involvementRole('reviewer') },
            { kind: 'evidence', entity: 'FileBlock', via: { relation: 'responses' } },
          ],
        },
      ],
      transitions: [{ from: 'draft', to: 'review' }],
    };
    const review = editorView(definition, { state: (n) => n.toUpperCase(), kind: () => 'Reviewers' }).lanes[0].steps[1];
    expect(review.requires).toEqual(['2 approvals from Reviewers', 'at least 1 file in response to it']);
    expect(review.approverKind).toBe('reviewer');
    expect(review.label).toBe('REVIEW');
  });

  it('says a comment requirement as a comment, and anything else by its entity', () => {
    expect(
      evidenceLabel({
        kind: 'evidence',
        entity: 'CollectionBlock',
        where: { kind: 'reply' },
        via: { relation: 'responses' },
      }),
    ).toBe('at least 1 comment in response to it');
    expect(evidenceLabel({ kind: 'evidence', entity: 'CollectionBlock', where: { kind: 'reply' }, min: 2 })).toBe(
      'at least 2 comments',
    );
    // A collection of another kind is not a comment — a call held about a record is one too.
    expect(evidenceLabel({ kind: 'evidence', entity: 'CollectionBlock', where: { kind: 'note' } })).toBe(
      'at least 1 CollectionBlock',
    );
  });
});

describe('recordView', () => {
  it('walks a record, counts each waiting move against what it needs, and marks the viewer’s own ask', () => {
    const { model } = toLanes(proposal);
    const view = recordView(
      proposal,
      model,
      { record: 'p1', state: 'vote', waiting: [{ to: 'adopted', approvers: ['did:a', 'did:b'] }], stalled: false },
      'Buy a kettle',
      'did:a',
    );
    expect(view.title).toBe('Buy a kettle');
    // No start time from the backend reads as none, not as 1970.
    expect(view.startedAt).toBe('');
    expect(view.walk.map((s) => s.at)).toEqual(['done', 'done', 'current', 'ahead']);
    expect(view.next.map((s) => s.label)).toEqual(['Adopted', 'Rejected']);
    expect(view.waiting).toEqual([
      { to: 'adopted', toLabel: 'Adopted', approvers: ['did:a', 'did:b'], needs: 3, note: '', mine: true },
    ]);
  });
});

describe('when a record started', () => {
  it('reads the time it entered the workflow as a date a timestamp shows', () => {
    const { model } = toLanes(proposal);
    const view = recordView(
      proposal,
      model,
      { record: 'p1', state: 'draft', waiting: [], stalled: false, since: 0 },
      '',
      undefined,
    );
    expect(view.startedAt).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('rules from the editor', () => {
  it('writes no rule for one ask from anybody, and reads a written role back as its kind', () => {
    expect(approvalsRule(1, '')).toBeNull();
    expect(approvalsRule(2, '')).toEqual({ kind: 'approvals', count: 2 });
    const rule = approvalsRule(1, 'reviewer');
    expect(rule?.from).toEqual(involvementRole('reviewer'));
    expect(kindOf(rule?.from)).toBe('reviewer');
    expect(kindOf({ entity: 'Membership', agentField: 'agent' })).toBe('');
  });

  it('labels a history step in words', () => {
    expect(historyView([{ from: 'draft', to: 'review', approvers: ['did:a'], evidence: ['x'], at: 5 }])).toEqual([
      {
        from: 'draft',
        to: 'review',
        fromLabel: 'Draft',
        toLabel: 'Review',
        approvers: ['did:a'],
        at: 5,
        when: '1970-01-01T00:00:00.005Z',
        evidence: ['x'],
        note: '',
      },
    ]);
  });
});

describe('lanes on a line', () => {
  // A branch was drawn as a list under the main line, matched to where it left only by name.
  it('places a branch one along from the step it leaves, and knows where it rejoins', () => {
    const view = editorView(definitionOf(presetDraft('proposal', 'Proposal', [])));
    const [main, ...branches] = view.lanes;
    expect(main.column).toBe(0);
    for (const branch of branches) {
      const leaves = view.lanes.flatMap((lane) => lane.steps.map((step, i) => [step.name, lane.column + i] as const));
      const at = new Map(leaves).get(branch.leaves)!;
      expect(branch.column).toBe(at + 1);
      expect(branch.lastColumn).toBe(branch.column + branch.steps.length - 1);
      if (branch.rejoins) expect(branch.rejoinsColumn).toBe(new Map(leaves).get(branch.rejoins));
      else expect(branch.rejoinsColumn).toBe(-1);
      // Every branch of the Proposal leaves a step on the main line.
      expect(branch.leavesLane).toBe(0);
    }
  });

  // "Other moves" were listed under the lanes, apart from the steps they lead into.
  it('says on a step which steps an exception comes in from', () => {
    const view = editorView(definitionOf(presetDraft('proposal', 'Proposal', [])));
    const withdrawn = view.lanes.flatMap((lane) => lane.steps).find((step) => step.name === 'withdrawn');
    expect(withdrawn?.alsoFrom).toEqual(['Draft']);
  });
});

describe('why a move was refused', () => {
  const board: WorkflowDefinition = {
    name: 'TaskStates',
    entities: ['TaskBlock'],
    states: [
      { name: 'todo' },
      { name: 'doing' },
      {
        name: 'done',
        requires: [
          { kind: 'evidence', entity: 'CollectionBlock', where: { kind: 'reply' }, via: { relation: 'responses' } },
        ],
      },
    ],
    transitions: [
      { from: 'todo', to: 'doing' },
      { from: 'doing', to: 'done' },
      { from: 'doing', to: 'todo' },
    ],
  };

  it('names where a record can go instead', () => {
    expect(refusalWords(board, 'todo', 'done', 'not-allowed')).toBe('From Todo it can only move to Doing.');
    expect(refusalWords(board, 'doing', 'doing', 'not-allowed')).toBe('From Doing it can only move to Done or Todo.');
  });

  it('names what a step still needs', () => {
    expect(refusalWords(board, 'doing', 'done', 'unmet')).toBe(
      'Not yet — Done needs at least 1 comment in response to it.',
    );
  });

  it('says nothing more where it has nothing more to say', () => {
    expect(refusalWords(null, 'todo', 'done', 'not-allowed')).toBeNull();
    expect(refusalWords(board, 'todo', 'doing', 'unmet')).toBeNull();
  });
});
