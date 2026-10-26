/**
 * The AD4M flow port's own logic: compiling a definition, and installing one over what a dataset
 * already holds. Both are pure over the perspective's link surface, so a fake perspective that
 * records what was removed and added is enough to pin them.
 *
 * What the engine then does with the links is the engine's business and is not tested here.
 */
import { SHACLFlow } from '@coasys/ad4m';
import type { WorkflowDefinition } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { createAd4mWorkflowPort, fromShaclFlow, isEditable, moveRefusal, toShaclFlow } from '../src/workflowPort';

interface Stored {
  data: { source: string; predicate?: string; target: string };
}

/** Links in, links out: `get` by source and predicate, `addLinks` and `removeLinks` recorded. */
function fakePerspective(initial: Stored['data'][] = []) {
  let links: Stored[] = initial.map((data) => ({ data }));
  const added: Stored['data'][] = [];
  const removed: Stored['data'][] = [];
  const perspective = {
    async get(query: { source?: string; predicate?: string }) {
      return links.filter(
        (l) =>
          (query.source === undefined || l.data.source === query.source) &&
          (query.predicate === undefined || l.data.predicate === query.predicate),
      );
    },
    async addLinks(next: Stored['data'][]) {
      for (const link of next) {
        const data = { source: link.source, predicate: link.predicate, target: link.target };
        links.push({ data });
        added.push(data);
      }
      return [];
    },
    async removeLinks(gone: Stored[]) {
      const drop = new Set(gone);
      links = links.filter((l) => !drop.has(l));
      removed.push(...gone.map((l) => l.data));
      return [];
    },
  };
  return { perspective, added, removed, all: () => links.map((l) => l.data) };
}

const REVIEWING = { entity: 'Involvement', agentField: 'agent', where: { kind: 'reviewing' }, recordField: 'node' };

const FLOW: WorkflowDefinition = {
  name: 'Tasks',
  entities: ['TaskBlock'],
  states: [
    { name: 'todo' },
    { name: 'done', requires: [{ kind: 'approvals', count: 2 }] },
    { name: 'review', requires: [{ kind: 'approvals', count: 1, from: REVIEWING }] },
    {
      name: 'shipped',
      requires: [
        { kind: 'evidence', entity: 'TextBlock', where: { text: 'release note' }, via: { relation: 'responses' } },
      ],
    },
  ],
  transitions: [
    { from: 'todo', to: 'done' },
    { from: 'done', to: 'todo' },
    { from: 'todo', to: 'review' },
    { from: 'review', to: 'shipped', name: 'ship' },
  ],
};

const rules = (definition: WorkflowDefinition) =>
  Object.fromEntries(toShaclFlow(definition).states.map((s) => [s.name, s.consensusRule ?? null]));

describe('toShaclFlow', () => {
  it('puts a hidden entry first, so every run begins there, then the states as given', () => {
    const flow = toShaclFlow(FLOW);
    expect(flow.states.map((s) => [s.name, s.value])).toEqual([
      ['_entry', 0],
      ['todo', 1],
      ['done', 2],
      ['review', 3],
      ['shipped', 4],
    ]);
    expect(flow.flowUri).toBe('we://flow/TasksFlow');
  });

  it('lets a record be placed from the entry into any state', () => {
    const fromEntry = toShaclFlow(FLOW)
      .transitions.filter((t) => t.fromState === '_entry')
      .map((t) => t.toState);
    expect(fromEntry).toEqual(['todo', 'done', 'review', 'shipped']);
  });

  it('writes no rule where one vote from anybody is enough — the engine’s own default', () => {
    expect(rules(FLOW)._entry).toBeNull();
    expect(rules(FLOW).todo).toBeNull();
    expect(rules(FLOW).done).toEqual({ n: 2 });
  });

  it('scopes a role to the run’s subject with the engine’s name for it, and sorts the conditions', () => {
    expect(rules(FLOW).review).toEqual({
      n: 1,
      fromRole: { className: 'Involvement', where: { kind: 'reviewing', node: '$flow.base' }, didProperty: 'agent' },
    });
    const text = JSON.stringify(rules(FLOW).review);
    expect(text.indexOf('"kind"')).toBeLessThan(text.indexOf('"node"'));
  });

  it('ties a guard to the record through the predicate its relation is stored under', () => {
    const shipped = toShaclFlow(FLOW).states.find((s) => s.name === 'shipped');
    expect(shipped?.requires).toEqual([
      { className: 'TextBlock', where: { text: 'release note' }, linkedTo: { via: 'we://response', to: 'base' } },
    ]);
  });

  it('refuses a guard tied through a relation read backwards, which the engine cannot follow', () => {
    expect(() =>
      toShaclFlow({
        ...FLOW,
        states: [
          { name: 'todo', requires: [{ kind: 'evidence', entity: 'TextBlock', via: { relation: 'respondsTo' } }] },
        ],
        transitions: [],
      }),
    ).toThrow('read backwards');
  });

  it('compiles one definition to the same bytes every time, so two installs never read as rival rules', () => {
    const a = toShaclFlow(FLOW).toLinks();
    const b = toShaclFlow(structuredClone(FLOW)).toLinks();
    expect(a).toEqual(b);
  });
});

describe('fromShaclFlow', () => {
  it('reads back exactly the definition that was compiled, entry and all hidden', () => {
    expect(fromShaclFlow(toShaclFlow(FLOW))).toEqual(FLOW);
  });

  it('calls a flow WE wrote editable, and one carrying what the contract cannot hold not', () => {
    expect(isEditable(toShaclFlow(FLOW))).toBe(true);
    const foreign = toShaclFlow(FLOW);
    foreign.addState({ name: 'checked', value: 9, semanticCheck: 'Is it really done?' });
    expect(isEditable(foreign)).toBe(false);
    const elsewhere = new SHACLFlow('Tasks', 'other://flow/');
    for (const state of toShaclFlow(FLOW).states) elsewhere.addState(state);
    expect(isEditable(elsewhere)).toBe(false);
  });
});

describe('install', () => {
  it('writes the definition and the name register into an empty dataset', async () => {
    const fake = fakePerspective();
    await createAd4mWorkflowPort().install(fake.perspective as never, FLOW);
    expect(fake.removed).toEqual([]);
    expect(fake.added.length).toBeGreaterThan(0);
    expect(fake.all()).toEqual(
      expect.arrayContaining([
        { source: 'ad4m://self', predicate: 'ad4m://has_flow', target: expect.stringContaining('Tasks') },
        { source: expect.stringContaining('Tasks'), predicate: 'ad4m://flow_uri', target: 'we://flow/TasksFlow' },
      ]),
    );
  });

  it('writes nothing when the dataset already says what the definition says', async () => {
    const fake = fakePerspective();
    const port = createAd4mWorkflowPort();
    await port.install(fake.perspective as never, FLOW);
    fake.added.length = 0;
    await port.install(fake.perspective as never, FLOW);
    expect(fake.added).toEqual([]);
    expect(fake.removed).toEqual([]);
  });

  it('replaces a changed rule rather than adding a second one beside it', async () => {
    const fake = fakePerspective();
    const port = createAd4mWorkflowPort();
    await port.install(fake.perspective as never, FLOW);
    const three: WorkflowDefinition = {
      ...FLOW,
      states: FLOW.states.map((s) =>
        s.name === 'done' ? { ...s, requires: [{ kind: 'approvals' as const, count: 3 }] } : s,
      ),
    };
    await port.install(fake.perspective as never, three);

    const doneRules = fake
      .all()
      .filter((l) => l.source === 'we://flow/Tasks.done' && l.predicate === 'ad4m://consensusRule');
    expect(doneRules).toHaveLength(1);
    expect(decodeURIComponent(doneRules[0].target)).toContain('"n":3');
  });

  it('takes away a state and its moves that the new definition no longer has', async () => {
    const fake = fakePerspective();
    const port = createAd4mWorkflowPort();
    await port.install(fake.perspective as never, FLOW);
    await port.install(fake.perspective as never, {
      ...FLOW,
      states: FLOW.states.filter((s) => s.name !== 'review' && s.name !== 'shipped'),
      transitions: FLOW.transitions.filter((t) => t.to !== 'review' && t.from !== 'review'),
    });
    const sources = new Set(fake.all().map((l) => l.source));
    expect(sources.has('we://flow/Tasks.review')).toBe(false);
    expect(sources.has('we://flow/Tasks.todoToreview')).toBe(false);
    expect(fake.all().some((l) => l.predicate === 'ad4m://hasState' && l.target === 'we://flow/Tasks.review')).toBe(
      false,
    );
  });

  it('never removes a link off the flow that is not part of its definition', async () => {
    const receiptIndex = {
      source: 'we://flow/TasksFlow',
      predicate: 'ad4m://flow/flow_receipt',
      target: 'ad4m://flow/receipt/1',
    };
    const otherWorkflow = { source: 'ad4m://self', predicate: 'ad4m://has_flow', target: 'literal:string:Other' };
    const fake = fakePerspective([receiptIndex, otherWorkflow]);
    await createAd4mWorkflowPort().install(fake.perspective as never, FLOW);
    expect(fake.removed).toEqual([]);
    expect(fake.all()).toEqual(expect.arrayContaining([receiptIndex, otherWorkflow]));
  });
});

describe('moveRefusal', () => {
  it('reads "not reachable from where you asked to go" as already there', () => {
    // The board showed Done; a rule change had the engine re-judge the run into Doing.
    const error = new Error('RPC error 500: `doing` is not reachable from `doing` — no proposal written');
    expect(moveRefusal(error, 'doing', 'done')).toEqual({ outcome: 'moved', state: 'doing', moves: [] });
  });

  it('reads an unreachable move as not allowed, naming where the record stands — none at the entry', () => {
    expect(moveRefusal(new Error('`todo` is not reachable from `done`'), 'todo', 'done')).toEqual({
      outcome: 'refused',
      reason: 'not-allowed',
      state: 'done',
    });
    expect(moveRefusal(new Error('`todo` is not reachable from `_entry`'), 'todo', null)).toMatchObject({
      state: null,
    });
  });

  it('reads an unmet guard, a contested run and a timeout', () => {
    const unmet = new Error('guard for `shipped` is not satisfied on this replica — proposal not written');
    expect(moveRefusal(unmet, 'shipped', 'doing')).toEqual({ outcome: 'refused', reason: 'unmet', state: 'doing' });
    const contested = new Error('ad4m://x is contested in `vote` — two edges out of it already carry quorum');
    expect(moveRefusal(contested, 'adopted', 'vote')).toEqual({ outcome: 'stalled', state: 'vote' });
    const slow = new Error("RPC call 'perspective.proposeFlowTransition' timed out after 30000ms");
    expect(moveRefusal(slow, 'done', 'doing')).toEqual({ outcome: 'pending' });
  });

  it('leaves any other error to be thrown', () => {
    expect(moveRefusal(new Error('socket closed'), 'done', 'doing')).toBeUndefined();
  });
});
