/**
 * A space's task states as a flow: when there is one, what it compiles to, and what asking for a
 * move does — driven through the in-memory flow port with several agents voting.
 */
import { createInMemoryFlowPort } from '@we/backend-inmemory';
import type { FlowSnapshot } from '@we/backend-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  compileTaskFlow,
  createTaskFlowActions,
  ENTRY_STATE,
  flowStateOf,
  needsAgreement,
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

  it('turns every state into a flow once one asks, with the entry first and every move between them', () => {
    const flow = compileTaskFlow([{ slug: 'todo' }, { slug: 'doing' }, { slug: 'done', approvals: 2 }])!;
    expect(flow.name).toBe(TASK_FLOW);
    expect(flow.states.map((s) => s.name)).toEqual([ENTRY_STATE, 'todo', 'doing', 'done']);
    expect(flow.states.find((s) => s.name === 'done')?.approvals).toBe(2);
    // Three entries, and six moves among three states.
    expect(flow.transitions).toHaveLength(3 + 6);
    expect(flow.transitions).toContainEqual({ from: 'done', to: 'todo' });
    expect(flow.transitions).toContainEqual({ from: ENTRY_STATE, to: 'done' });
  });

  it('names whose approval counts as the holders of an involvement kind on the task being moved', () => {
    const flow = compileTaskFlow([{ slug: 'todo' }, { slug: 'done', approverKind: 'reviewer' }])!;
    expect(flow.states.find((s) => s.name === 'done')?.role).toEqual({
      entity: 'Involvement',
      agentField: 'agent',
      where: { kind: 'reviewer' },
      subjectField: 'node',
    });
  });

  it('normalises approvals, and treats a kind on its own as asking for agreement', () => {
    expect(needsAgreement({ slug: 'x', approvals: 0 })).toBe(false);
    expect(needsAgreement({ slug: 'x', approverKind: 'reviewer' })).toBe(true);
    const flow = compileTaskFlow([{ slug: 'todo' }, { slug: 'done', approvals: 999 }])!;
    expect(flow.states.find((s) => s.name === 'done')?.approvals).toBe(20);
  });
});

describe('asking for a move', () => {
  let signedIn = ANA;
  let states: TaskStateRule[];
  let snapshot: FlowSnapshot | null;
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

  const refresh = async () => {
    const stop = await port.watch(dataset, TASK_FLOW, (s) => (snapshot = s));
    await new Promise((r) => setTimeout(r, 0));
    stop();
  };

  beforeEach(async () => {
    signedIn = ANA;
    snapshot = null;
    states = [{ slug: 'todo' }, { slug: 'doing' }, { slug: 'done', approvals: 2 }];
    actions = createTaskFlowActions({
      dataset: () => dataset,
      port: () => port,
      states: () => states,
      snapshot: () => snapshot,
      me: () => signedIn,
    });
    await port.install(dataset, compileTaskFlow(states)!);
  });

  it('says nothing — so the caller writes the state — where the space has no flow', async () => {
    states = DEFAULTS;
    expect(await actions.move('task-a', 'todo', 'doing')).toBeNull();
  });

  it('enters a never-moved task into the state it already holds, then asks for the move', async () => {
    // The task was made in Doing before the space asked for agreement.
    expect(await actions.move('task-b', 'doing', 'done')).toBe('waiting');
    await refresh();
    const view: TaskFlowView = { snapshot: snapshot!, rules: { done: { approvals: 2, approverKind: '' } } };
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
    await refresh();
    expect(flowStateOf({ snapshot: snapshot!, rules: {} }, 'task-c')).toBe('done');
  });

  it('moves at once into a state that asks for nothing', async () => {
    expect(await actions.move('task-d', 'todo', 'doing')).toBe('moved');
  });

  it('withdraws only the viewer’s own vote', async () => {
    await actions.move('task-e', 'doing', 'done');
    await refresh();
    expect(await as(BEN, () => actions.withdraw('task-e'))).toBe(0);
    expect(await actions.withdraw('task-e')).toBeGreaterThan(0);
    await refresh();
    expect(taskMoveCard({ snapshot: snapshot!, rules: {} }, 'task-e', () => [], ANA)).toBeUndefined();
  });

  it('starts a task made into a column that asks for agreement in the first one that does not', () => {
    expect(actions.entryFor('done')).toBe('todo');
  });
});

describe('taskMoveCard', () => {
  const snapshot: FlowSnapshot = {
    runs: [{ id: 'r', subject: 'task', state: 'doing', startedAt: 1 }],
    proposals: [{ id: 'p', run: 'r', from: 'doing', to: 'done', proposer: ANA, voters: [ANA, BEN], settled: false }],
  };
  const view: TaskFlowView = { snapshot, rules: { done: { approvals: 1, approverKind: 'reviewer' } } };

  it('counts only the holders of the kind, and offers approval only to one who would count', () => {
    const holders = (kind: string) => (kind === 'reviewer' ? [BEN, 'did:key:cat'] : []);
    expect(taskMoveCard(view, 'task', holders, 'did:key:cat')).toMatchObject({ counted: 1, canApprove: true });
    expect(taskMoveCard(view, 'task', holders, 'did:key:dan')).toMatchObject({ canApprove: false });
    expect(taskMoveCard(view, 'task', holders, ANA)).toMatchObject({ mine: true, canApprove: false });
  });

  it('reads nothing for the entry state — the board goes on reading `status` there', () => {
    const entry: TaskFlowView = {
      snapshot: { runs: [{ ...snapshot.runs[0], state: ENTRY_STATE }], proposals: [] },
      rules: {},
    };
    expect(flowStateOf(entry, 'task')).toBeUndefined();
  });
});
