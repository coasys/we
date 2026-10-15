/**
 * A flow as a template draws it — steps and requirements in words, and a record's walk.
 */
import type { FlowDefinition } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { definitionOf, presetDraft } from '../src/shared/flowDraft';
import { toLanes } from '../src/shared/flowLanes';
import { approvalsRule, editorView, historyView, involvementRole, kindOf, recordView } from '../src/shared/flowViews';

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

  it('names whose approval counts in the community’s words, and what a guard needs', () => {
    const definition: FlowDefinition = {
      name: 'Review',
      subjects: ['TaskBlock'],
      states: [
        { name: 'draft' },
        {
          name: 'review',
          requires: [
            { kind: 'approvals', count: 2, from: involvementRole('reviewer') },
            { kind: 'guard', entity: 'FileBlock', tie: { relation: 'responses' } },
          ],
        },
      ],
      transitions: [{ from: 'draft', to: 'review' }],
    };
    const review = editorView(definition, { state: (n) => n.toUpperCase(), kind: () => 'Reviewers' }).lanes[0].steps[1];
    expect(review.requires).toEqual(['2 approvals from Reviewers', 'at least 1 FileBlock in response to it']);
    expect(review.approverKind).toBe('reviewer');
    expect(review.label).toBe('REVIEW');
  });
});

describe('recordView', () => {
  it('walks a record, counts each waiting move against what it needs, and marks the viewer’s own ask', () => {
    const { model } = toLanes(proposal);
    const view = recordView(
      proposal,
      model,
      { subject: 'p1', state: 'vote', waiting: [{ to: 'adopted', voters: ['did:a', 'did:b'] }], stalled: false },
      'Buy a kettle',
      'did:a',
    );
    expect(view.title).toBe('Buy a kettle');
    // No start time from the backend reads as none, not as 1970.
    expect(view.startedAt).toBe('');
    expect(view.walk.map((s) => s.at)).toEqual(['done', 'done', 'current', 'ahead']);
    expect(view.next.map((s) => s.label)).toEqual(['Adopted', 'Rejected']);
    expect(view.waiting).toEqual([
      { to: 'adopted', toLabel: 'Adopted', voters: ['did:a', 'did:b'], needs: 3, note: '', mine: true },
    ]);
  });
});

describe('when a record started', () => {
  it('reads the time it entered the flow as a date a timestamp shows', () => {
    const { model } = toLanes(proposal);
    const view = recordView(
      proposal,
      model,
      { subject: 'p1', state: 'draft', waiting: [], stalled: false, since: 0 },
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
    expect(historyView([{ from: 'draft', to: 'review', voters: ['did:a'], evidence: ['x'], at: 5 }])).toEqual([
      {
        from: 'draft',
        to: 'review',
        fromLabel: 'Draft',
        toLabel: 'Review',
        voters: ['did:a'],
        at: 5,
        when: '1970-01-01T00:00:00.005Z',
        evidence: ['x'],
        note: '',
      },
    ]);
  });
});
