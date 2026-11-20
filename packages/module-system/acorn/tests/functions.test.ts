/**
 * The pure functions S2-5's parts lean on: the task-list edits (an expression cannot serialise
 * the JSON field), the children join over AcornConnection, Acorn's roll-up as `computedState.ts`
 * defines it, and how a comment's author is named.
 */
import { describe, expect, it } from 'vitest';

import { ACORN_FUNCTIONS } from '../src/index.ts';

const call = (name: string, options: Record<string, unknown>) => {
  const fn = ACORN_FUNCTIONS.find((f) => f.name === name);
  if (!fn) throw new Error(`no function ${name}`);
  return (fn.fn as (o: unknown) => unknown)(options);
};

const tasks = JSON.stringify([
  { task: 'a', complete: true },
  { task: 'b', complete: false },
]);

const outcome = (id: string, scopeType: string, extra: Record<string, unknown> = {}) => ({ id, scopeType, ...extra });
const edge = (parent: string, child: string, siblingOrder = 0) => ({
  id: `${parent}>${child}`,
  parent,
  child,
  siblingOrder,
});

describe('task-list edits', () => {
  it('add appends an open task, trimmed; a blank one adds nothing', () => {
    expect(JSON.parse(call('acornTasksAdded', { taskList: tasks, task: '  c ' }) as string)).toEqual([
      { task: 'a', complete: true },
      { task: 'b', complete: false },
      { task: 'c', complete: false },
    ]);
    expect(call('acornTasksAdded', { taskList: tasks, task: '  ' })).toBe(tasks);
    expect(JSON.parse(call('acornTasksAdded', { taskList: '', task: 'x' }) as string)).toEqual([
      { task: 'x', complete: false },
    ]);
  });

  it('toggle flips one task by index; remove drops one', () => {
    expect(JSON.parse(call('acornTasksToggled', { taskList: tasks, index: 1 }) as string)).toEqual([
      { task: 'a', complete: true },
      { task: 'b', complete: true },
    ]);
    expect(JSON.parse(call('acornTasksRemoved', { taskList: tasks, index: 0 }) as string)).toEqual([
      { task: 'b', complete: false },
    ]);
    // An index past the end changes nothing.
    expect(call('acornTasksToggled', { taskList: tasks, index: 9 })).toBe(tasks);
  });
});

describe('children and the roll-up', () => {
  const outcomes = [
    outcome('root', 'Uncertain'),
    outcome('s1', 'Small', { achievementStatus: 'Achieved' }),
    outcome('s2', 'Small', { achievementStatus: 'NotAchieved', taskList: tasks }),
    outcome('u1', 'Uncertain'),
    outcome('s3', 'Small', { achievementStatus: 'Achieved' }),
  ];

  it('children come from the connections, in sibling order, ids or included records alike', () => {
    const connections = [
      edge('root', 's2', 1),
      edge('root', 's1', 0),
      { parent: { id: 'root' }, child: { id: 'u1' }, siblingOrder: 2 },
    ];
    const kids = call('acornChildren', { outcome: 'root', outcomes, connections }) as Array<{ id: string }>;
    expect(kids.map((k) => k.id)).toEqual(['s1', 's2', 'u1']);
    expect(call('acornChildren', { outcome: 's1', outcomes, connections })).toEqual([]);
  });

  it('an Uncertain outcome over Smalls only is Big; partly achieved Smalls make it partially achieved', () => {
    const connections = [edge('root', 's1'), edge('root', 's2')];
    const r = call('acornRollup', { outcome: outcomes[0], outcomes, connections }) as Record<string, unknown>;
    expect(r).toMatchObject({
      scope: 'Big',
      status: 'PartiallyAchieved',
      smallsAchieved: 1,
      smallsTotal: 2,
      uncertains: 0,
      children: 2,
    });
    expect(call('acornRollupLabel', { rollup: r })).toBe('Partially achieved · 1/2 smalls');
  });

  it('an Uncertain descendant keeps it Uncertain and not achieved — counted through a grandchild', () => {
    const connections = [edge('root', 's1'), edge('root', 'u1'), edge('u1', 's3'), edge('u1', 'x-missing')];
    const r = call('acornRollup', { outcome: outcomes[0], outcomes, connections }) as Record<string, unknown>;
    // u1 has one achieved Small under it, so it is Big and achieved; root's smalls are 2/2.
    expect(r).toMatchObject({ scope: 'Big', status: 'Achieved', smallsAchieved: 2, smallsTotal: 2, uncertains: 0 });

    const open = [edge('root', 's1'), edge('root', 'u1')];
    const r2 = call('acornRollup', { outcome: outcomes[0], outcomes, connections: open }) as Record<string, unknown>;
    expect(r2).toMatchObject({
      scope: 'Uncertain',
      status: 'NotAchieved',
      uncertains: 1,
      smallsAchieved: 1,
      smallsTotal: 1,
    });
  });

  it('a leaf is its own scope; a Small leaf with tasks part done is partially achieved', () => {
    const r = call('acornRollup', { outcome: outcomes[2], outcomes, connections: [] }) as Record<string, unknown>;
    expect(r).toMatchObject({
      scope: 'Small',
      status: 'PartiallyAchieved',
      tasksAchieved: 1,
      tasksTotal: 2,
      children: 0,
    });
    const u = call('acornRollup', { outcome: outcomes[3], outcomes, connections: [] }) as Record<string, unknown>;
    expect(u).toMatchObject({ scope: 'Uncertain', status: 'NotAchieved', uncertains: 1 });
  });

  it('a cycle in the connections stops rather than recursing for ever', () => {
    const connections = [edge('root', 'u1'), edge('u1', 'root')];
    const r = call('acornRollup', { outcome: outcomes[0], outcomes, connections }) as Record<string, unknown>;
    expect(r.children).toBe(1);
  });

  it('wrong-typed input answers the empty roll-up', () => {
    expect(call('acornChildren', {})).toEqual([]);
    expect(call('acornRollup', {})).toMatchObject({ children: 0 });
    expect(call('acornRollupLabel', {})).toBe('');
  });
});

describe('authors and times', () => {
  const profiles = [
    { agent: 'did:key:z6MkAliceAAAAAAAAAAAAAAAA', firstName: 'Alice', lastName: 'Anders' },
    { agent: 'did:key:z6MkHandleOnly000000000000', firstName: '', lastName: '', handle: 'h' },
  ];

  it('names an author by profile, else by handle, else the DID short form', () => {
    expect(call('acornAuthor', { did: 'did:key:z6MkAliceAAAAAAAAAAAAAAAA', profiles })).toBe('Alice Anders');
    expect(call('acornAuthor', { did: 'did:key:z6MkHandleOnly000000000000', profiles })).toBe('h');
    expect(call('acornAuthor', { did: 'did:key:z6MkStrangerXYZ12345wxyz', profiles })).toBe('z6Mk…wxyz');
    expect(call('acornAuthor', { did: '', profiles })).toBe('Unknown');
  });

  it("reads Acorn's seconds and the fixture's milliseconds alike", () => {
    expect(call('acornWhen', { timestamp: 1_700_000_000 })).toBe('2023-11-14 22:13');
    expect(call('acornWhen', { timestamp: 1_700_000_000_000 })).toBe('2023-11-14 22:13');
    expect(call('acornWhen', { timestamp: 0 })).toBe('');
  });
});
