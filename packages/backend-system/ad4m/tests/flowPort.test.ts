/**
 * The AD4M flow port's own logic: compiling a definition, and installing one over what a dataset
 * already holds. Both are pure over the perspective's link surface, so a fake perspective that
 * records what was removed and added is enough to pin them.
 *
 * What the engine then does with the links is the engine's business and is not tested here.
 */
import type { FlowDefinition } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { createAd4mFlowPort, toShaclFlow } from '../src/flowPort';

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

const FLOW: FlowDefinition = {
  name: 'Tasks',
  subjects: ['TaskBlock'],
  states: [
    { name: '_entry' },
    { name: 'todo' },
    { name: 'done', approvals: 2 },
    {
      name: 'review',
      role: { entity: 'Involvement', agentField: 'agent', where: { kind: 'reviewing' }, subjectField: 'node' },
    },
  ],
  transitions: [
    { from: '_entry', to: 'todo' },
    { from: 'todo', to: 'done' },
    { from: 'done', to: 'todo' },
    { from: 'todo', to: 'review' },
  ],
};

const rules = (definition: FlowDefinition) =>
  Object.fromEntries(toShaclFlow(definition).states.map((s) => [s.name, s.consensusRule ?? null]));

describe('toShaclFlow', () => {
  it('orders states as given, so the first is where every run starts', () => {
    const flow = toShaclFlow(FLOW);
    expect(flow.states.map((s) => [s.name, s.value])).toEqual([
      ['_entry', 0],
      ['todo', 1],
      ['done', 2],
      ['review', 3],
    ]);
    expect(flow.flowUri).toBe('we://flow/TasksFlow');
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

  it('compiles one definition to the same bytes every time, so two installs never read as rival rules', () => {
    const a = toShaclFlow(FLOW).toLinks();
    const b = toShaclFlow(structuredClone(FLOW)).toLinks();
    expect(a).toEqual(b);
  });
});

describe('install', () => {
  it('writes the definition and the name register into an empty dataset', async () => {
    const fake = fakePerspective();
    await createAd4mFlowPort().install(fake.perspective as never, FLOW);
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
    const port = createAd4mFlowPort();
    await port.install(fake.perspective as never, FLOW);
    fake.added.length = 0;
    await port.install(fake.perspective as never, FLOW);
    expect(fake.added).toEqual([]);
    expect(fake.removed).toEqual([]);
  });

  it('replaces a changed rule rather than adding a second one beside it', async () => {
    const fake = fakePerspective();
    const port = createAd4mFlowPort();
    await port.install(fake.perspective as never, FLOW);
    const three: FlowDefinition = {
      ...FLOW,
      states: FLOW.states.map((s) => (s.name === 'done' ? { ...s, approvals: 3 } : s)),
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
    const port = createAd4mFlowPort();
    await port.install(fake.perspective as never, FLOW);
    await port.install(fake.perspective as never, {
      ...FLOW,
      states: FLOW.states.filter((s) => s.name !== 'review'),
      transitions: FLOW.transitions.filter((t) => t.to !== 'review'),
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
    const otherFlow = { source: 'ad4m://self', predicate: 'ad4m://has_flow', target: 'literal:string:Other' };
    const fake = fakePerspective([receiptIndex, otherFlow]);
    await createAd4mFlowPort().install(fake.perspective as never, FLOW);
    expect(fake.removed).toEqual([]);
    expect(fake.all()).toEqual(expect.arrayContaining([receiptIndex, otherFlow]));
  });
});
