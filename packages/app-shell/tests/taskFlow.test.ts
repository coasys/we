/**
 * A space's task states as a flow: when there is one, what it compiles to, and what asking for a
 * move does — driven through the in-memory flow port with several agents asking.
 */
import { createInMemoryFlowPort } from '@we/backend-inmemory';
import type { FlowMoveResult, FlowView } from '@we/backend-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  compileTaskFlow,
  createTaskFlowActions,
  flowStateOf,
  needsAgreement,
  parseTaskStateGuards,
  readMoveResult,
  storeTaskStateGuards,
  TASK_FLOW,
  type TaskFlowActions,
  type TaskFlowView,
  taskMoveCard,
  type TaskStateRule,
} from '../src/shared/taskFlow';

const ANA = 'did:key:ana';
const BEN = 'did:key:ben';

const DEFAULTS: TaskStateRule[] = [{ slug: 'todo' }, { slug: 'doing' }, { slug: 'done' }];

describe('compileTaskFlow', () => {
  it('compiles nothing for a space where no state asks for agreement', () => {
    expect(compileTaskFlow(DEFAULTS)).toBeNull();
    expect(compileTaskFlow([{ slug: 'todo', approvals: 1, approverKind: '' }])).toBeNull();
  });

  it('turns every state into a flow once one asks, with every move between them', () => {
    const flow = compileTaskFlow([{ slug: 'todo' }, { slug: 'doing' }, { slug: 'done', approvals: 2 }])!;
    expect(flow.name).toBe(TASK_FLOW);
    expect(flow.states.map((s) => s.name)).toEqual(['todo', 'doing', 'done']);
    expect(flow.states.find((s) => s.name === 'done')?.requires).toEqual([{ kind: 'approvals', count: 2 }]);
    expect(flow.states.find((s) => s.name === 'todo')?.requires).toBeUndefined();
    // Six moves among three states.
    expect(flow.transitions).toHaveLength(6);
    expect(flow.transitions).toContainEqual({ from: 'done', to: 'todo' });
  });

  it('names whose approval counts as the holders of an involvement kind on the task being moved', () => {
    const flow = compileTaskFlow([{ slug: 'todo' }, { slug: 'done', approverKind: 'reviewer' }])!;
    expect(flow.states.find((s) => s.name === 'done')?.requires).toEqual([
      {
        kind: 'approvals',
        count: 1,
        from: { entity: 'Involvement', agentField: 'agent', where: { kind: 'reviewer' }, subjectField: 'node' },
      },
    ]);
  });

  it('normalises approvals, and treats a kind on its own as asking for agreement', () => {
    expect(needsAgreement({ slug: 'x', approvals: 0 })).toBe(false);
    expect(needsAgreement({ slug: 'x', approverKind: 'reviewer' })).toBe(true);
    const flow = compileTaskFlow([{ slug: 'todo' }, { slug: 'done', approvals: 999 }])!;
    expect(flow.states.find((s) => s.name === 'done')?.requires).toEqual([{ kind: 'approvals', count: 20 }]);
  });
});

describe('asking for a move', () => {
  let signedIn = ANA;
  let states: TaskStateRule[];
  let actions: TaskFlowActions;
  const dataset = {};
  const port = createInMemoryFlowPort(() => signedIn);

  const as = async <T>(did: string, act: () => Promise<T>) => {
    signedIn = did;
    try {
      return await act();
    } finally {
      signedIn = ANA;
    }
  };

  const latest = async (rules: TaskFlowView['rules'] = {}): Promise<TaskFlowView> => {
    let view: FlowView | undefined;
    const stop = await port.watch(dataset, TASK_FLOW, (v) => (view = v));
    await new Promise((r) => setTimeout(r, 0));
    stop();
    return { view: view!, rules };
  };

  beforeEach(async () => {
    signedIn = ANA;
    states = [{ slug: 'todo' }, { slug: 'doing' }, { slug: 'done', approvals: 2 }];
    actions = createTaskFlowActions({ dataset: () => dataset, port: () => port, states: () => states });
    await port.install(dataset, compileTaskFlow(states)!);
  });

  it('says nothing — so the caller writes the state — where the space has no flow', async () => {
    states = DEFAULTS;
    expect(await actions.move('task-a', 'todo', 'doing')).toBeNull();
  });

  it('enters a never-moved task into the state it already holds, then asks for the move', async () => {
    // The task was made in Doing before the space asked for agreement.
    expect(await actions.move('task-b', 'doing', 'done')).toBe('waiting');
    const view = await latest({ done: { approvals: 2, approverKind: '' } });
    expect(flowStateOf(view, 'task-b')).toBe('doing');
    expect(taskMoveCard(view, 'task-b', () => [], BEN)).toMatchObject({
      to: 'done',
      voters: [ANA],
      counted: 1,
      needs: 2,
      mine: false,
      canApprove: true,
    });
  });

  it('moves once a second person asks for the same move', async () => {
    await actions.move('task-c', 'doing', 'done');
    expect(await as(BEN, () => actions.move('task-c', 'doing', 'done'))).toBe('moved');
    expect(flowStateOf(await latest(), 'task-c')).toBe('done');
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
  const flowView: FlowView = {
    flow: TASK_FLOW,
    items: [
      { subject: 'task', state: 'doing', since: 1, waiting: [{ to: 'done', voters: [ANA, BEN] }], stalled: false },
    ],
  };
  const view: TaskFlowView = { view: flowView, rules: { done: { approvals: 1, approverKind: 'reviewer' } } };

  it('counts only the holders of the kind, and offers approval only to one who would count', () => {
    const holders = (kind: string) => (kind === 'reviewer' ? [BEN, 'did:key:cat'] : []);
    expect(taskMoveCard(view, 'task', holders, 'did:key:cat')).toMatchObject({ counted: 1, canApprove: true });
    expect(taskMoveCard(view, 'task', holders, 'did:key:dan')).toMatchObject({ canApprove: false });
    expect(taskMoveCard(view, 'task', holders, ANA)).toMatchObject({ mine: true, canApprove: false });
  });

  it('reads nothing where the flow cannot say — the board goes on reading `status` there', () => {
    const unknown: TaskFlowView = {
      view: { flow: TASK_FLOW, items: [{ ...flowView.items[0], state: null }] },
      rules: {},
    };
    expect(flowStateOf(unknown, 'task')).toBeUndefined();
  });
});

describe('readMoveResult', () => {
  const read = (result: FlowMoveResult) => readMoveResult(result);

  it('tells a move that happened from one that was already made', () => {
    expect(
      read({ outcome: 'moved', state: 'done', steps: [{ from: 'doing', to: 'done', voters: [ANA], evidence: [] }] }),
    ).toBe('moved');
    expect(read({ outcome: 'moved', state: 'done', steps: [] })).toBe('already-there');
  });

  it('tells a first ask from a repeated one, and names a refusal by its reason', () => {
    expect(read({ outcome: 'waiting', state: 'doing', to: 'done', voted: true, voters: [ANA] })).toBe('waiting');
    expect(read({ outcome: 'waiting', state: 'doing', to: 'done', voted: false, voters: [ANA] })).toBe('already-voted');
    expect(read({ outcome: 'refused', reason: 'unmet', state: 'doing' })).toBe('unmet');
    expect(read({ outcome: 'refused', reason: 'not-allowed', state: 'doing' })).toBe('not-allowed');
  });

  it('reads an unanswered move as slow rather than failed', () => {
    expect(read({ outcome: 'pending' })).toBe('slow');
    expect(read({ outcome: 'stalled', state: 'vote' })).toBe('stalled');
  });
});

describe('a rule over the states, and what must be there', () => {
  it('runs the states as a flow under a rule even where no state asks for agreement', () => {
    expect(compileTaskFlow(DEFAULTS)).toBeNull();
    const flow = compileTaskFlow(DEFAULTS, 'next')!;
    expect(flow.transitions).toEqual([
      { from: 'todo', to: 'doing' },
      { from: 'doing', to: 'done' },
    ]);
    const back = compileTaskFlow(DEFAULTS, 'next-and-back')!;
    // The last state is final, as it is in any flow written as lanes: nothing leads back out of it.
    expect(back.transitions.map((t) => `${t.from}>${t.to}`).sort()).toEqual(['doing>done', 'doing>todo', 'todo>doing']);
  });

  it('compiles a guard into the state it guards, and counts it as asking', () => {
    const guards = parseTaskStateGuards(JSON.stringify([{ entity: 'TextBlock', tie: 'responses' }]));
    expect(needsAgreement({ slug: 'done', guards })).toBe(true);
    const flow = compileTaskFlow([{ slug: 'todo' }, { slug: 'done', guards }])!;
    expect(flow.states[1]).toEqual({
      name: 'done',
      requires: [{ kind: 'guard', entity: 'TextBlock', tie: { relation: 'responses' } }],
    });
  });

  it('stores guards compactly, reads them back, and reads anything unreadable as none', () => {
    const stored = storeTaskStateGuards([{ entity: 'FileBlock', tie: 'responses', min: 2 }, { entity: '' }]);
    expect(JSON.parse(stored)).toEqual([{ entity: 'FileBlock', tie: 'responses', min: 2 }]);
    expect(parseTaskStateGuards(stored)).toEqual([
      { kind: 'guard', entity: 'FileBlock', tie: { relation: 'responses' }, min: 2 },
    ]);
    expect(storeTaskStateGuards([])).toBe('');
    expect(parseTaskStateGuards('{not json')).toEqual([]);
  });

  it('keeps the conditions a requirement carries, so "a comment" stays a comment', () => {
    const stored = storeTaskStateGuards([{ entity: 'CollectionBlock', where: { kind: 'reply' }, tie: 'responses' }]);
    expect(parseTaskStateGuards(stored)).toEqual([
      { kind: 'guard', entity: 'CollectionBlock', where: { kind: 'reply' }, tie: { relation: 'responses' } },
    ]);
  });

  it('refuses a move the rule does not allow without asking the backend', async () => {
    const port = createInMemoryFlowPort(() => ANA);
    const dataset = {};
    let asked = 0;
    const counting = { ...port, move: (...args: Parameters<typeof port.move>) => ((asked += 1), port.move(...args)) };
    const actions = createTaskFlowActions({
      dataset: () => dataset,
      port: () => counting,
      states: () => DEFAULTS,
      rule: () => 'next',
    });
    await port.install(dataset, compileTaskFlow(DEFAULTS, 'next')!);
    expect(await actions.move('task', 'todo', 'done')).toBe('not-allowed');
    expect(asked).toBe(0);
    expect(await actions.move('task', 'todo', 'doing')).toBe('moved');
    expect(asked).toBe(1);
  });
});
