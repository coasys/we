/**
 * A space's task states as a workflow: when there is one, what it compiles to, and what asking for a
 * move does — driven through the in-memory workflow port with several agents asking.
 */
import { createInMemoryWorkflowPort } from '@we/backend-inmemory';
import type { MoveResult, WorkflowView } from '@we/backend-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  compileTaskWorkflow,
  createTaskWorkflowActions,
  needsAgreement,
  parseTaskStateEvidence,
  readMoveResult,
  storeTaskStateEvidence,
  TASK_WORKFLOW,
  taskMoveCard,
  type TaskStateRule,
  type TaskWorkflowActions,
  type TaskWorkflowView,
  workflowStateOf,
} from '../src/shared/taskWorkflow';

const ANA = 'did:key:ana';
const BEN = 'did:key:ben';

const DEFAULTS: TaskStateRule[] = [{ slug: 'todo' }, { slug: 'doing' }, { slug: 'done' }];

describe('compileTaskWorkflow', () => {
  it('compiles nothing for a space where no state asks for agreement', () => {
    expect(compileTaskWorkflow(DEFAULTS)).toBeNull();
    expect(compileTaskWorkflow([{ slug: 'todo', approvals: 1, approverKind: '' }])).toBeNull();
  });

  it('turns every state into a workflow once one asks, with every move between them', () => {
    const workflow = compileTaskWorkflow([{ slug: 'todo' }, { slug: 'doing' }, { slug: 'done', approvals: 2 }])!;
    expect(workflow.name).toBe(TASK_WORKFLOW);
    expect(workflow.states.map((s) => s.name)).toEqual(['todo', 'doing', 'done']);
    expect(workflow.states.find((s) => s.name === 'done')?.requires).toEqual([{ kind: 'approvals', count: 2 }]);
    expect(workflow.states.find((s) => s.name === 'todo')?.requires).toBeUndefined();
    // Six moves among three states.
    expect(workflow.transitions).toHaveLength(6);
    expect(workflow.transitions).toContainEqual({ from: 'done', to: 'todo' });
  });

  it('names whose approval counts as the holders of an involvement kind on the task being moved', () => {
    const workflow = compileTaskWorkflow([{ slug: 'todo' }, { slug: 'done', approverKind: 'reviewer' }])!;
    expect(workflow.states.find((s) => s.name === 'done')?.requires).toEqual([
      {
        kind: 'approvals',
        count: 1,
        from: { entity: 'Involvement', agentField: 'agent', where: { kind: 'reviewer' }, recordField: 'node' },
      },
    ]);
  });

  it('normalises approvals, and treats a kind on its own as asking for agreement', () => {
    expect(needsAgreement({ slug: 'x', approvals: 0 })).toBe(false);
    expect(needsAgreement({ slug: 'x', approverKind: 'reviewer' })).toBe(true);
    const workflow = compileTaskWorkflow([{ slug: 'todo' }, { slug: 'done', approvals: 999 }])!;
    expect(workflow.states.find((s) => s.name === 'done')?.requires).toEqual([{ kind: 'approvals', count: 20 }]);
  });
});

describe('asking for a move', () => {
  let signedIn = ANA;
  let states: TaskStateRule[];
  let actions: TaskWorkflowActions;
  const dataset = {};
  const port = createInMemoryWorkflowPort(() => signedIn);

  const as = async <T>(did: string, act: () => Promise<T>) => {
    signedIn = did;
    try {
      return await act();
    } finally {
      signedIn = ANA;
    }
  };

  const latest = async (rules: TaskWorkflowView['rules'] = {}): Promise<TaskWorkflowView> => {
    let view: WorkflowView | undefined;
    const stop = await port.watch(dataset, TASK_WORKFLOW, (v) => (view = v));
    await new Promise((r) => setTimeout(r, 0));
    stop();
    return { view: view!, rules };
  };

  beforeEach(async () => {
    signedIn = ANA;
    states = [{ slug: 'todo' }, { slug: 'doing' }, { slug: 'done', approvals: 2 }];
    actions = createTaskWorkflowActions({ dataset: () => dataset, port: () => port, states: () => states });
    await port.install(dataset, compileTaskWorkflow(states)!);
  });

  it('says nothing — so the caller writes the state — where the space has no workflow', async () => {
    states = DEFAULTS;
    expect(await actions.move('task-a', 'todo', 'doing')).toBeNull();
  });

  it('enters a never-moved task into the state it already holds, then asks for the move', async () => {
    // The task was made in Doing before the space asked for agreement.
    expect(await actions.move('task-b', 'doing', 'done')).toBe('waiting');
    const view = await latest({ done: { approvals: 2, approverKind: '' } });
    expect(workflowStateOf(view, 'task-b')).toBe('doing');
    expect(taskMoveCard(view, 'task-b', () => [], BEN)).toMatchObject({
      to: 'done',
      approvers: [ANA],
      counted: 1,
      needs: 2,
      mine: false,
      canApprove: true,
    });
  });

  it('moves once a second person asks for the same move', async () => {
    await actions.move('task-c', 'doing', 'done');
    expect(await as(BEN, () => actions.move('task-c', 'doing', 'done'))).toBe('moved');
    expect(workflowStateOf(await latest(), 'task-c')).toBe('done');
  });

  it('moves at once into a state that asks for nothing', async () => {
    expect(await actions.move('task-d', 'todo', 'doing')).toBe('moved');
  });

  it('withdraws only the viewer’s own ask', async () => {
    await actions.move('task-e', 'doing', 'done');
    expect(await as(BEN, () => actions.withdraw('task-e'))).toBe(0);
    expect(await actions.withdraw('task-e')).toBeGreaterThan(0);
    expect(taskMoveCard(await latest(), 'task-e', () => [], ANA)).toBeUndefined();
  });

  it('starts a task made into a column that asks for agreement in the first one that does not', () => {
    expect(actions.entryFor('done')).toBe('todo');
  });
});

describe('taskMoveCard', () => {
  const workflowView: WorkflowView = {
    workflow: TASK_WORKFLOW,
    items: [
      { record: 'task', state: 'doing', since: 1, waiting: [{ to: 'done', approvers: [ANA, BEN] }], stalled: false },
    ],
  };
  const view: TaskWorkflowView = { view: workflowView, rules: { done: { approvals: 1, approverKind: 'reviewer' } } };

  it('counts only the holders of the kind, and offers approval only to one who would count', () => {
    const holders = (kind: string) => (kind === 'reviewer' ? [BEN, 'did:key:cat'] : []);
    expect(taskMoveCard(view, 'task', holders, 'did:key:cat')).toMatchObject({ counted: 1, canApprove: true });
    expect(taskMoveCard(view, 'task', holders, 'did:key:dan')).toMatchObject({ canApprove: false });
    expect(taskMoveCard(view, 'task', holders, ANA)).toMatchObject({ mine: true, canApprove: false });
  });

  it('reads nothing where the workflow cannot say — the board goes on reading `status` there', () => {
    const unknown: TaskWorkflowView = {
      view: { workflow: TASK_WORKFLOW, items: [{ ...workflowView.items[0], state: null }] },
      rules: {},
    };
    expect(workflowStateOf(unknown, 'task')).toBeUndefined();
  });
});

describe('readMoveResult', () => {
  const read = (result: MoveResult) => readMoveResult(result);

  it('tells a move that happened from one that was already made', () => {
    expect(
      read({ outcome: 'moved', state: 'done', moves: [{ from: 'doing', to: 'done', approvers: [ANA], evidence: [] }] }),
    ).toBe('moved');
    expect(read({ outcome: 'moved', state: 'done', moves: [] })).toBe('already-there');
  });

  it('tells a first ask from a repeated one, and names a refusal by its reason', () => {
    expect(read({ outcome: 'waiting', state: 'doing', to: 'done', approved: true, approvers: [ANA] })).toBe('waiting');
    expect(read({ outcome: 'waiting', state: 'doing', to: 'done', approved: false, approvers: [ANA] })).toBe(
      'already-approved',
    );
    expect(read({ outcome: 'refused', reason: 'unmet', state: 'doing' })).toBe('unmet');
    expect(read({ outcome: 'refused', reason: 'not-allowed', state: 'doing' })).toBe('not-allowed');
  });

  it('reads an unanswered move as slow rather than failed', () => {
    expect(read({ outcome: 'pending' })).toBe('slow');
    expect(read({ outcome: 'stalled', state: 'vote' })).toBe('stalled');
  });
});

describe('a rule over the states, and what must be there', () => {
  it('runs the states as a workflow under a rule even where no state asks for agreement', () => {
    expect(compileTaskWorkflow(DEFAULTS)).toBeNull();
    const workflow = compileTaskWorkflow(DEFAULTS, 'next')!;
    expect(workflow.transitions).toEqual([
      { from: 'todo', to: 'doing' },
      { from: 'doing', to: 'done' },
    ]);
    const back = compileTaskWorkflow(DEFAULTS, 'next-and-back')!;
    // Unlike a workflow written as lanes, the last state is not an end: a done task can be reopened.
    expect(back.transitions.map((t) => `${t.from}>${t.to}`).sort()).toEqual([
      'doing>done',
      'doing>todo',
      'done>doing',
      'todo>doing',
    ]);
  });

  it('compiles a requirement into the state it evidence, and counts it as asking', () => {
    const evidence = parseTaskStateEvidence(JSON.stringify([{ entity: 'TextBlock', via: 'responses' }]));
    expect(needsAgreement({ slug: 'done', evidence })).toBe(true);
    const workflow = compileTaskWorkflow([{ slug: 'todo' }, { slug: 'done', evidence }])!;
    expect(workflow.states[1]).toEqual({
      name: 'done',
      requires: [{ kind: 'evidence', entity: 'TextBlock', via: { relation: 'responses' } }],
    });
  });

  it('stores evidence compactly, reads them back, and reads anything unreadable as none', () => {
    const stored = storeTaskStateEvidence([{ entity: 'FileBlock', via: 'responses', min: 2 }, { entity: '' }]);
    expect(JSON.parse(stored)).toEqual([{ entity: 'FileBlock', via: 'responses', min: 2 }]);
    expect(parseTaskStateEvidence(stored)).toEqual([
      { kind: 'evidence', entity: 'FileBlock', via: { relation: 'responses' }, min: 2 },
    ]);
    expect(storeTaskStateEvidence([])).toBe('');
    expect(parseTaskStateEvidence('{not json')).toEqual([]);
  });

  it('keeps the conditions a requirement carries, so "a comment" stays a comment', () => {
    const stored = storeTaskStateEvidence([{ entity: 'CollectionBlock', where: { kind: 'reply' }, via: 'responses' }]);
    expect(parseTaskStateEvidence(stored)).toEqual([
      { kind: 'evidence', entity: 'CollectionBlock', where: { kind: 'reply' }, via: { relation: 'responses' } },
    ]);
  });

  it('refuses a move the rule does not allow without asking the backend', async () => {
    const port = createInMemoryWorkflowPort(() => ANA);
    const dataset = {};
    let asked = 0;
    const counting = { ...port, move: (...args: Parameters<typeof port.move>) => ((asked += 1), port.move(...args)) };
    const actions = createTaskWorkflowActions({
      dataset: () => dataset,
      port: () => counting,
      states: () => DEFAULTS,
      rule: () => 'next',
    });
    await port.install(dataset, compileTaskWorkflow(DEFAULTS, 'next')!);
    expect(await actions.move('task', 'todo', 'done')).toBe('not-allowed');
    expect(asked).toBe(0);
    expect(await actions.move('task', 'todo', 'doing')).toBe('moved');
    expect(asked).toBe(1);
  });
});
