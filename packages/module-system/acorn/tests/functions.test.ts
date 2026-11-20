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

  it("children come from the connections, in Acorn's sibling order, ids or included records alike", () => {
    const connections = [
      edge('root', 's2', 1),
      edge('root', 's1', 0),
      { parent: { id: 'root' }, child: { id: 'u1' }, siblingOrder: 2 },
    ];
    const kids = call('acornChildren', { outcome: 'root', outcomes, connections }) as Array<{ id: string }>;
    // Highest siblingOrder first — stock's map and table draw it leftmost / topmost.
    expect(kids.map((k) => k.id)).toEqual(['u1', 's2', 's1']);
    expect(call('acornChildren', { outcome: 's1', outcomes, connections })).toEqual([]);
  });

  it('siblings on the same siblingOrder are ordered by statement, as Acorn breaks the tie', () => {
    const named = [
      outcome('p', 'Uncertain'),
      outcome('x', 'Small', { content: 'Beta' }),
      outcome('y', 'Small', { content: 'Alpha' }),
    ];
    const kids = call('acornChildren', {
      outcome: 'p',
      outcomes: named,
      connections: [edge('p', 'x'), edge('p', 'y')],
    });
    expect((kids as Array<{ id: string }>).map((k) => k.id)).toEqual(['y', 'x']);
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

describe('the outcome table rows', () => {
  const rowsOf = (options: Record<string, unknown>) =>
    call('acornTableRows', options) as Array<{ id: string; depth: number; number: string; open: boolean }>;

  it("numbers a row as Acorn does — hashCodeId of the action hash, not of the mount's URL", () => {
    // acorn-ad4m-ui api/clientSideIdHash.ts, by hand for "uhCkkA".
    let h = 0;
    for (const ch of 'uhCkkA') h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
    const want = Math.abs(h).toString().slice(0, 6);
    expect(rowsOf({ outcomes: [{ id: 'QmLang://uhCkkA' }] })[0].number).toBe(want);
    expect(rowsOf({ outcomes: [{ id: 'uhCkkA' }] })[0].number).toBe(want);
  });

  it('walks roots depth-first; a folded row hides its subtree unless a filter is on', () => {
    const outcomes = [
      { id: 'r', content: 'root', scopeType: 'Uncertain' },
      { id: 'a', content: 'alpha', scopeType: 'Small' },
      { id: 'b', content: 'beta', scopeType: 'Small' },
      { id: 'lone', content: 'lone', scopeType: 'Small' },
    ];
    const connections = [edge('r', 'b', 1), edge('r', 'a', 0)];
    // Acorn's sibling order: the higher siblingOrder (b's 1) first.
    expect(rowsOf({ outcomes, connections }).map((r) => [r.id, r.depth])).toEqual([
      ['r', 0],
      ['b', 1],
      ['a', 1],
      ['lone', 0],
    ]);
    expect(rowsOf({ outcomes, connections, collapsed: ['r'] }).map((r) => r.id)).toEqual(['r', 'lone']);
    expect(
      rowsOf({ outcomes, connections, collapsed: ['r'], filter: { keyword: 'BETA' } }).map((r) => [r.id, r.depth]),
    ).toEqual([['b', 1]]);
  });

  it('a cycle with no root is still drawn, from its first outcome, with what hangs below it', () => {
    const outcomes = [
      outcome('x', 'Uncertain', { content: 'ex' }),
      outcome('y', 'Uncertain', { content: 'why' }),
      outcome('leaf', 'Small', { content: 'leaf' }),
    ];
    const connections = [edge('x', 'y'), edge('y', 'x'), edge('y', 'leaf')];
    expect(rowsOf({ outcomes, connections }).map((r) => [r.id, r.depth])).toEqual([
      ['x', 0],
      ['y', 1],
      ['leaf', 2],
    ]);
    // A search finds the cycle's outcomes, as any other.
    expect(rowsOf({ outcomes, connections, filter: { keyword: 'why' } }).map((r) => [r.id, r.depth])).toEqual([
      ['y', 1],
    ]);
    expect(rowsOf({ outcomes, connections, filter: { keyword: 'leaf' } }).map((r) => r.id)).toEqual(['leaf']);
  });
});

describe('the outcome table on a long chain', () => {
  /** A chain r0 → r1 → … of Small leaves under Uncertain parents, each connection counting its reads. */
  const chain = (n: number) => {
    let reads = 0;
    const outcomes = Array.from({ length: n }, (_, i) =>
      outcome(`r${i}`, i === n - 1 ? 'Small' : 'Uncertain', { content: `step ${i}` }),
    );
    const connections = Array.from({ length: n - 1 }, (_, i) => {
      const c = edge(`r${i}`, `r${i + 1}`);
      return new Proxy(c, {
        get: (target, key) => {
          if (key === 'parent' || key === 'child') reads++;
          return target[key as keyof typeof target];
        },
      });
    });
    return { outcomes, connections, reads: () => reads };
  };

  it('reads each connection a bounded number of times, however long the chain', () => {
    const { outcomes, connections, reads } = chain(300);
    const rows = call('acornTableRows', { outcomes, connections }) as Array<{ depth: number; scope: string }>;
    expect(rows).toHaveLength(300);
    expect(rows[299].depth).toBe(299);
    expect(rows[0].scope).toBe('Big');
    expect(reads()).toBeLessThan(300 * 10);
  });

  it('draws a 2000-outcome chain, filtered or not, fast', () => {
    const { outcomes, connections } = chain(2000);
    const started = performance.now();
    const rows = call('acornTableRows', { outcomes, connections }) as Array<{ id: string; depth: number }>;
    const found = call('acornTableRows', { outcomes, connections, filter: { keyword: 'step 1999' } }) as Array<{
      id: string;
      depth: number;
    }>;
    const folded = call('acornTableRows', { outcomes, connections, collapsed: ['r0'] }) as Array<{ id: string }>;
    expect(performance.now() - started).toBeLessThan(1000);
    expect(rows).toHaveLength(2000);
    expect(rows[1999]).toMatchObject({ id: 'r1999', depth: 1999 });
    expect(found).toEqual([expect.objectContaining({ id: 'r1999', depth: 1999 })]);
    expect(folded.map((r) => r.id)).toEqual(['r0']);
  });
});

describe('the outcome table filter', () => {
  it('finds a row by its ID number', () => {
    const outcomes = [outcome('QmL://uhCkkOne', 'Small'), outcome('QmL://uhCkkTwoDifferent', 'Small')];
    const all = call('acornTableRows', { outcomes }) as Array<{ id: string; number: string }>;
    expect(all[0].number).not.toBe(all[1].number);
    const hit = call('acornTableRows', { outcomes, filter: { keyword: all[1].number } }) as Array<{ id: string }>;
    expect(hit.map((r) => r.id)).toEqual(['QmL://uhCkkTwoDifferent']);
  });
});

describe('the working value a whole-field edit starts from', () => {
  const written = [tasks, JSON.stringify([{ task: 'a', complete: true }])];
  it('is the last written while the stored value is one this view replaced or wrote', () => {
    const working = JSON.stringify([{ task: 'a', complete: false }]);
    expect(call('acornWorking', { stored: tasks, working, written })).toBe(working);
    // The mount reads a list back with its keys in another order; it is still the same list.
    expect(call('acornWorking', { stored: '[{"complete":true,"task":"a"}]', working, written })).toBe(working);
    expect(call('acornWorking', { stored: ['x'], working: ['x', 'y'], written: [['x'], ['x', 'y']] })).toEqual([
      'x',
      'y',
    ]);
    expect(call('acornWorking', { stored: undefined, working: '[]', written: [undefined, '[]'] })).toBe('[]');
  });
  it("is the stored value when nothing was written, or the stored value is somebody else's", () => {
    expect(call('acornWorking', { stored: tasks, working: 'x', written: [] })).toBe(tasks);
    expect(call('acornWorking', { stored: '[]', working: 'x', written: [tasks] })).toBe('[]');
    expect(call('acornWorking', { stored: ['z'], working: ['x'], written: 'nope' })).toEqual(['z']);
  });
});
