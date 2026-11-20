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

  it("a new child's siblingOrder is one below its lowest sibling's, as stock appends on the right; 0 with none", () => {
    const next = (connections: unknown) => call('acornNextSiblingOrder', { parent: 'root', connections });
    // No siblings: 0, as stock's expanded view writes.
    expect(next([])).toBe(0);
    expect(next([edge('other', 's1', 5)])).toBe(0);
    // Dense: below the lowest, never the count.
    expect(next([edge('root', 's1', 0), edge('root', 's2', 1)])).toBe(-1);
    // Sparse: the count (2) would land between them; one below the lowest does not.
    expect(next([edge('root', 's1', 20), edge('root', 's2', 10), edge('other', 'u1', -50)])).toBe(9);
    // Negative orders, and parents read as included records.
    expect(next([edge('root', 's1', 5), { parent: { id: 'root' }, child: { id: 's2' }, siblingOrder: -3 }])).toBe(-4);
    expect(call('acornNextSiblingOrder', {})).toBe(0);
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

  it('a rootless cycle whose tail comes first in the list is drawn from the cycle, each outcome once', () => {
    const outcomes = [
      outcome('leaf', 'Small', { content: 'leaf' }),
      outcome('x', 'Uncertain', { content: 'ex' }),
      outcome('y', 'Uncertain', { content: 'why' }),
    ];
    const connections = [edge('x', 'y'), edge('y', 'x'), edge('y', 'leaf')];
    expect(rowsOf({ outcomes, connections }).map((r) => [r.id, r.depth])).toEqual([
      ['x', 0],
      ['y', 1],
      ['leaf', 2],
    ]);
    expect(rowsOf({ outcomes, connections, filter: { keyword: 'leaf' } }).map((r) => r.id)).toEqual(['leaf']);
    // The tail is under its parent, so folding the cycle hides it.
    expect(rowsOf({ outcomes, connections, collapsed: ['x'] }).map((r) => r.id)).toEqual(['x']);
  });

  it('a second rootless cycle that leads into one already drawn does not draw it again', () => {
    const outcomes = [
      outcome('a', 'Uncertain'),
      outcome('b', 'Uncertain'),
      outcome('c', 'Uncertain'),
      outcome('d', 'Uncertain'),
      outcome('leaf', 'Small'),
    ];
    // a ⇄ b → leaf, and c ⇄ d → a: the second cycle is upstream of the first.
    const connections = [
      edge('a', 'b'),
      edge('b', 'a'),
      edge('b', 'leaf'),
      edge('c', 'd'),
      edge('d', 'c'),
      edge('d', 'a'),
    ];
    const ids = rowsOf({ outcomes, connections }).map((r) => r.id);
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd', 'leaf']);
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
  // The history as acornWritten records it: what each edit replaced, ending with the value written last.
  const working = JSON.stringify([{ task: 'a', complete: false }]);
  const written = [tasks, JSON.stringify([{ task: 'a', complete: true }]), working];
  it('is the last written while the stored value is one this view replaced on the way', () => {
    expect(call('acornWorking', { stored: tasks, working, written })).toBe(working);
    // The mount reads a list back with its keys in another order; it is still the same list.
    expect(call('acornWorking', { stored: '[{"complete":true,"task":"a"}]', working, written })).toBe(working);
    expect(call('acornWorking', { stored: ['x'], working: ['x', 'y'], written: [['x'], ['x', 'y']] })).toEqual([
      'x',
      'y',
    ]);
    expect(call('acornWorking', { stored: undefined, working: '[]', written: [undefined, '[]'] })).toBe('[]');
  });
  it('once the working value has read back, an earlier value stored again is drawn, not hidden', () => {
    const history = [['x'], ['x', 'y']];
    expect(call('acornWorking', { stored: ['x'], working: ['x', 'y'], written: history })).toEqual(['x', 'y']);
    expect(call('acornWorking', { stored: ['x', 'y'], working: ['x', 'y'], written: history })).toEqual(['x', 'y']);
    // Stock reverts after the read-back: no write is pending, so the revert is the list.
    expect(call('acornWorking', { stored: ['x'], working: ['x', 'y'], written: history })).toEqual(['x']);
  });
  it('the history an edit records is text, extends an unsettled one, and starts afresh after a settled one', () => {
    const stored = ['x'];
    const first = call('acornWritten', { stored, working: ['x', 'y'], written: [] }) as string[];
    expect(first).toEqual(['["x"]', '["x","y"]']);
    // A subscription that reconciles its array in place cannot rewrite what was recorded.
    stored.push('y');
    expect(first).toEqual(['["x"]', '["x","y"]']);
    // Unsettled (stored is still the replaced value): the next edit extends it.
    expect(call('acornWritten', { stored: ['x'], working: ['x', 'y', 'z'], written: first })).toEqual([
      '["x"]',
      '["x","y"]',
      '["x","y","z"]',
    ]);
    // Read back: the next edit's history holds only what it replaces and writes.
    expect(call('acornWorking', { stored: ['x', 'y'], working: ['x', 'y'], written: first })).toEqual(['x', 'y']);
    expect(call('acornWritten', { stored: ['x'], working: ['x', 'w'], written: first })).toEqual([
      '["x"]',
      '["x","w"]',
    ]);
  });
  it("is the stored value when nothing was written, or the stored value is somebody else's", () => {
    expect(call('acornWorking', { stored: tasks, working: 'x', written: [] })).toBe(tasks);
    expect(call('acornWorking', { stored: '[]', working: 'x', written: [tasks] })).toBe('[]');
    expect(call('acornWorking', { stored: ['z'], working: ['x'], written: 'nope' })).toEqual(['z']);
  });
});

describe('connecting two outcomes on the map (S2-9)', () => {
  const refusal = (parent: string, child: string, connections: unknown) =>
    call('acornConnectRefusal', { parent, child, connections });
  // r → a → a1, r → b; c on its own.
  const tree = [edge('r', 'a', 1), edge('r', 'b', 0), edge('a', 'a1')];

  it('allows a parent → child line that keeps the tree a tree', () => {
    expect(refusal('b', 'c', tree)).toBe('');
    expect(refusal('c', 'r', tree)).toBe('');
    // A second parent, as stock's bottom port allows: a1 is under a, not under b.
    expect(refusal('b', 'a1', tree)).toBe('');
    expect(refusal('x', 'y', [])).toBe('');
  });

  it('refuses an outcome as its own child', () => {
    expect(refusal('a', 'a', tree)).toMatch(/itself/);
  });

  it('refuses a child already under the parent, directly or further down — stock offers neither', () => {
    expect(refusal('r', 'a', tree)).toMatch(/already under/);
    expect(refusal('r', 'a1', tree)).toMatch(/already under/);
  });

  it('refuses a line that would close a loop: the child is above the parent', () => {
    expect(refusal('a1', 'r', tree)).toMatch(/loop/);
    expect(refusal('a', 'r', tree)).toMatch(/loop/);
  });

  it('follows every parent, not only the first — a loop through a second parent is still a loop', () => {
    // x has two parents, p and q; q is under z. Connecting x → z would loop through q.
    const shared = [edge('p', 'x'), edge('z', 'q'), edge('q', 'x')];
    expect(refusal('x', 'z', shared)).toMatch(/loop/);
  });

  it('reads parents and children given as included records, and stops on a loop already stored', () => {
    const included = [{ parent: { id: 'r' }, child: { id: 'a' } }];
    expect(refusal('a', 'r', included)).toMatch(/loop/);
    const looped = [edge('a', 'b'), edge('b', 'a')];
    expect(refusal('c', 'a', looped)).toBe('');
    expect(refusal('a', 'c', looped)).toBe('');
  });

  it('names the connections as links: parent and child only, each once, in one order, one added', () => {
    const links = (options: Record<string, unknown>) => call('acornLinks', options);
    const one = links({
      connections: [edge('r', 'b'), edge('r', 'a', 1), { parent: { id: 'r' }, child: { id: 'a' } }],
    });
    expect(one).toEqual([
      { parent: 'r', child: 'a' },
      { parent: 'r', child: 'b' },
    ]);
    // The same set however the subscription orders or hydrates it: one canonical value to compare.
    expect(links({ connections: [edge('r', 'a', 7), edge('r', 'b', 3)] })).toEqual(one);
    expect(links({ connections: [edge('r', 'b')], add: { parent: 'a', child: 'c' } })).toEqual([
      { parent: 'a', child: 'c' },
      { parent: 'r', child: 'b' },
    ]);
    expect(links({ connections: [{ parent: 'r' }], add: { parent: 'x' } })).toEqual([]);
    expect(links({})).toEqual([]);
  });

  it('refuses a line without both ends', () => {
    expect(refusal('', 'a', tree)).toMatch(/two outcomes/);
    expect(call('acornConnectRefusal', {})).toMatch(/two outcomes/);
  });
});

/*
  S2-9b: a card dragged to another place in the map's tree (GraphView's `arrange-nodes`), and a
  selected card moved one place along its row with Shift+←/→ (stock's `alterSiblingOrder`). Each
  answers with a plan of at most two writes — a handler cannot loop — that `mapView` carries out.
*/
describe('acornArrange', () => {
  const o = (id: string, content = id) => ({ id, content, scopeType: 'Uncertain' });
  // r over a (2), b (1), c (0), drawn a b c; s over d (0); e on its own.
  const outcomes = ['r', 'a', 'b', 'c', 's', 'd', 'e'].map((id) => o(id));
  const connections = [edge('r', 'a', 2), edge('r', 'b', 1), edge('r', 'c', 0), edge('s', 'd', 0)];
  const arrange = (event: Record<string, unknown>, conns: Record<string, unknown>[] = connections) =>
    call('acornArrange', { ...event, outcomes, connections: conns }) as Record<string, unknown>;

  it('moves a card under another parent by updating the line it hangs from: parent and siblingOrder', () => {
    // Dropped on the right of d: one below s's lowest, stock's lowerThanLowestSiblingOrder.
    const plan = arrange({ outcome: 'b', into: 'sibling', target: 'd', before: false, order: ['d', 'b'] });
    expect(plan).toMatchObject({ refusal: '', move: 'r>b', create: false, parent: 's', child: 'b', siblingOrder: -1 });
    expect(plan.updates).toEqual([]);
    expect(plan.pending).toEqual([
      { id: 'r>b', was: { parent: 'r', siblingOrder: 1 }, now: { parent: 's', siblingOrder: -1 } },
    ]);
  });

  it('keeps the place it was dropped in when one write can: left of every sibling, or between two with room', () => {
    expect(arrange({ outcome: 'b', into: 'sibling', target: 'd', before: true, order: ['b', 'd'] })).toMatchObject({
      move: 'r>b',
      parent: 's',
      siblingOrder: 1,
      notice: '',
    });
    const gapped = [edge('r', 'a', 4), edge('r', 'c', 0), edge('s', 'd', 0)];
    expect(
      arrange({ outcome: 'd', into: 'sibling', target: 'c', before: true, order: ['a', 'd', 'c'] }, gapped),
    ).toMatchObject({ move: 's>d', parent: 'r', siblingOrder: 2, notice: '' });
  });

  it('puts it on the right, and says so, where its place would need its new siblings renumbered', () => {
    const plan = arrange({ outcome: 'd', into: 'sibling', target: 'b', before: true, order: ['a', 'd', 'b', 'c'] });
    expect(plan).toMatchObject({ move: 's>d', parent: 'r', siblingOrder: -1 });
    expect(plan.notice).toMatch(/right/);
  });

  it('a card dropped under one with no children becomes its first, at 0', () => {
    expect(arrange({ outcome: 'c', into: 'child', target: 'e', order: ['c'] })).toMatchObject({
      move: 'r>c',
      parent: 'e',
      siblingOrder: 0,
    });
  });

  it('a root dragged under a card gets a new line rather than a moved one', () => {
    const plan = arrange({ outcome: 'e', into: 'sibling', target: 'c', before: false, order: ['a', 'b', 'c', 'e'] });
    expect(plan).toMatchObject({ refusal: '', move: '', create: true, parent: 'r', child: 'e', siblingOrder: -1 });
    expect(plan.pending).toEqual([]);
  });

  it('refuses what a connect refuses — a loop, or a parent it is already under — and writes nothing', () => {
    // d also under b: dragging b under d closes a loop through the second parent.
    const twoParents = [...connections, edge('b', 'd', 0)];
    const loop = arrange({ outcome: 'b', into: 'child', target: 'd', order: ['b'] }, twoParents);
    expect(loop.refusal).toMatch(/loop/);
    expect(loop).toMatchObject({ move: '', create: false, updates: [] });
    // d drawn under b or s — under r through b already, so r is a parent it is already under.
    const under = arrange({ outcome: 'd', into: 'sibling', target: 'c', before: false, order: ['a', 'b', 'c', 'd'] }, [
      ...twoParents,
    ]);
    expect(under.refusal).toMatch(/already under/);
  });

  it('a move off a line the drop replaces is not refused for going through that line', () => {
    // a1 under a under r: moving a1 from a to r is not "already under r" — that path is the one moved.
    const deep = [...connections, edge('a', 'a1', 0)];
    const plan = call('acornArrange', {
      outcome: 'a1',
      into: 'sibling',
      target: 'c',
      before: false,
      order: ['a', 'b', 'c', 'a1'],
      outcomes: [...outcomes, o('a1')],
      connections: deep,
    }) as Record<string, unknown>;
    expect(plan).toMatchObject({ refusal: '', move: 'a>a1', parent: 'r', siblingOrder: -1 });
  });

  it('reorders along a row with one write where there is room: to either end', () => {
    expect(arrange({ outcome: 'c', into: 'sibling', target: 'a', before: true, order: ['c', 'a', 'b'] })).toMatchObject(
      { refusal: '', move: '', create: false, updates: [{ id: 'r>c', siblingOrder: 3 }] },
    );
    expect(
      arrange({ outcome: 'a', into: 'sibling', target: 'c', before: false, order: ['b', 'c', 'a'] }),
    ).toMatchObject({ updates: [{ id: 'r>a', siblingOrder: -1 }] });
  });

  it("reorders one place over with stock's swap where there is no room: two writes", () => {
    const plan = arrange({ outcome: 'b', into: 'sibling', target: 'a', before: true, order: ['b', 'a', 'c'] });
    // b to the far left has room (above a) — one write; c over b has none, so the two swap.
    expect(plan.updates).toEqual([{ id: 'r>b', siblingOrder: 3 }]);
    const swap = arrange({ outcome: 'c', into: 'sibling', target: 'b', before: true, order: ['a', 'c', 'b'] });
    expect(swap.updates).toEqual([
      { id: 'r>c', siblingOrder: 1 },
      { id: 'r>b', siblingOrder: 0 },
    ]);
    expect(swap.pending).toEqual([
      { id: 'r>c', was: { parent: 'r', siblingOrder: 0 }, now: { parent: 'r', siblingOrder: 1 } },
      { id: 'r>b', was: { parent: 'r', siblingOrder: 1 }, now: { parent: 'r', siblingOrder: 0 } },
    ]);
  });

  it('refuses a reorder that would need the row renumbered, and points at the keys', () => {
    const four = [...connections.slice(0, 3), edge('r', 'd', -1)];
    const plan = arrange(
      { outcome: 'd', into: 'sibling', target: 'b', before: true, order: ['a', 'd', 'b', 'c'] },
      four,
    );
    expect(plan.refusal).toMatch(/Shift/);
    expect(plan.updates).toEqual([]);
  });

  it('a drop back where it was writes nothing', () => {
    const plan = arrange({ outcome: 'b', into: 'sibling', target: 'c', before: true, order: ['a', 'b', 'c'] });
    expect(plan).toMatchObject({ refusal: '', notice: '', move: '', create: false, updates: [] });
  });
});

describe('acornSiblingMove (Shift+←/→)', () => {
  const o = (id: string) => ({ id, content: id, scopeType: 'Uncertain' });
  const outcomes = ['r', 'a', 'b', 'c', 'e'].map(o);
  const connections = [edge('r', 'a', 2), edge('r', 'b', 1), edge('r', 'c', 0)];
  const card = (id: string) => `we-graph://entity//AcornOutcome/${id}`;
  const move = (selected: string[], direction: string, conns = connections) =>
    call('acornSiblingMove', { selected, direction, outcomes, connections: conns }) as Record<string, unknown>;

  it('swaps the selected card with its neighbour: two update_connection writes, as stock does', () => {
    expect(move([card('b')], 'left').updates).toEqual([
      { id: 'r>b', siblingOrder: 2 },
      { id: 'r>a', siblingOrder: 1 },
    ]);
    expect(move([card('b')], 'right').updates).toEqual([
      { id: 'r>b', siblingOrder: 0 },
      { id: 'r>c', siblingOrder: 1 },
    ]);
  });

  it('equal orders move by one, left up and right down', () => {
    const tied = [edge('r', 'a', 0), edge('r', 'b', 0)];
    expect(move([card('b')], 'left', tied).updates).toEqual([
      { id: 'r>b', siblingOrder: 1 },
      { id: 'r>a', siblingOrder: 0 },
    ]);
    expect(move([card('a')], 'right', tied).updates).toEqual([
      { id: 'r>a', siblingOrder: -1 },
      { id: 'r>b', siblingOrder: 0 },
    ]);
  });

  it('does nothing at the end of a row, with nothing selected, or with several', () => {
    expect(move([card('a')], 'left').updates).toEqual([]);
    expect(move([card('c')], 'right').updates).toEqual([]);
    expect(move([], 'left').updates).toEqual([]);
    expect(move([card('a'), card('b')], 'left').updates).toEqual([]);
  });

  it('says a root has no sibling order', () => {
    const plan = move([card('e')], 'left');
    expect(plan.updates).toEqual([]);
    expect(plan.refusal).toMatch(/root/);
  });

  it('takes a plain id as well as a card address', () => {
    expect(move(['b'], 'left').updates).toHaveLength(2);
  });

  /** The row under r as Acorn draws it once the plan's updates are written. */
  const drawnAfter = (plan: Record<string, unknown>, conns: Array<ReturnType<typeof edge>>) => {
    const writes = new Map((plan.updates as Array<{ id: string; siblingOrder: number }>).map((u) => [u.id, u]));
    const after = conns.map((c) => ({ ...c, siblingOrder: writes.get(c.id)?.siblingOrder ?? c.siblingOrder }));
    return (call('acornChildren', { outcome: 'r', outcomes, connections: after }) as Array<{ id: string }>).map(
      (k) => k.id,
    );
  };

  it('moves one place among three tied siblings, not across the group', () => {
    const tied = [edge('r', 'a', 0), edge('r', 'b', 0), edge('r', 'c', 0)];
    const left = move([card('c')], 'left', tied);
    expect(left.refusal).toBe('');
    expect(drawnAfter(left, tied)).toEqual(['a', 'c', 'b']);
    expect((left.updates as unknown[]).length).toBeLessThanOrEqual(2);
    expect(drawnAfter(move([card('a')], 'right', tied), tied)).toEqual(['b', 'a', 'c']);
    expect(drawnAfter(move([card('b')], 'left', tied), tied)).toEqual(['b', 'a', 'c']);
    expect(drawnAfter(move([card('b')], 'right', tied), tied)).toEqual(['a', 'c', 'b']);
  });

  const I32_MAX = 2147483647;
  const I32_MIN = -2147483648;
  const inI32 = (plan: Record<string, unknown>) =>
    (plan.updates as Array<{ siblingOrder: number }>).every(
      (u) => Number.isInteger(u.siblingOrder) && u.siblingOrder >= I32_MIN && u.siblingOrder <= I32_MAX,
    );

  it("keeps every order within the zome's i32, at either limit", () => {
    const top = [edge('r', 'a', I32_MAX), edge('r', 'b', I32_MAX), edge('r', 'c', 0)];
    const up = move([card('b')], 'left', top);
    expect(inI32(up)).toBe(true);
    expect(drawnAfter(up, top)).toEqual(['b', 'a', 'c']);
    const bottom = [edge('r', 'a', 0), edge('r', 'b', I32_MIN), edge('r', 'c', I32_MIN)];
    const down = move([card('b')], 'right', bottom);
    expect(inI32(down)).toBe(true);
    expect(drawnAfter(down, bottom)).toEqual(['a', 'c', 'b']);
  });
});

describe('sibling orders at the limits of i32', () => {
  const o = (id: string) => ({ id, content: id, scopeType: 'Uncertain' });
  const outcomes = ['r', 'a', 'b', 's', 'd'].map(o);
  const I32_MAX = 2147483647;
  const I32_MIN = -2147483648;
  const values = (plan: Record<string, unknown>) => [
    ...(plan.move || plan.create ? [plan.siblingOrder as number] : []),
    ...(plan.updates as Array<{ siblingOrder: number }>).map((u) => u.siblingOrder),
  ];
  const arrange = (event: Record<string, unknown>, connections: unknown[]) =>
    call('acornArrange', { ...event, outcomes, connections }) as Record<string, unknown>;

  it('a new sibling under a row already at the lowest order gets the lowest, not one past it', () => {
    expect(call('acornNextSiblingOrder', { parent: 'r', connections: [edge('r', 'a', I32_MIN)] })).toBe(I32_MIN);
  });

  it('a drop left of a sibling at the highest order is not written one above it', () => {
    const conns = [edge('r', 'a', I32_MAX), edge('r', 'b', I32_MAX - 1), edge('s', 'd', 0)];
    const reparent = arrange(
      { outcome: 'd', into: 'sibling', target: 'a', before: true, order: ['d', 'a', 'b'] },
      conns,
    );
    expect(values(reparent).every((v) => v >= I32_MIN && v <= I32_MAX)).toBe(true);
    const reorder = arrange({ outcome: 'b', into: 'sibling', target: 'a', before: true, order: ['b', 'a'] }, conns);
    expect(values(reorder).every((v) => v >= I32_MIN && v <= I32_MAX)).toBe(true);
  });

  it('a drop right of a sibling at the lowest order is refused, saying why, rather than written one below it', () => {
    const conns = [edge('r', 'a', 0), edge('r', 'b', I32_MIN), edge('s', 'd', 0)];
    const plan = arrange({ outcome: 'd', into: 'sibling', target: 'b', before: false, order: ['a', 'b', 'd'] }, conns);
    expect(plan).toMatchObject({ move: '', create: false, updates: [] });
    expect(plan.refusal).toMatch(/order/);
  });
});

describe('acornPending', () => {
  const stored = [edge('r', 'a', 2), edge('r', 'b', 1)];
  const pending = [
    { id: 'r>a', was: { parent: 'r', siblingOrder: 2 }, now: { parent: 'r', siblingOrder: 1 } },
    { id: 'r>b', was: { parent: 'r', siblingOrder: 1 }, now: { parent: 's', siblingOrder: 2 } },
  ];
  const view = (connections: unknown[], p: unknown[]) =>
    (call('acornPending', { connections, pending: p }) as Array<Record<string, unknown>>).map((c) => [
      c.id,
      c.parent,
      c.siblingOrder,
    ]);

  it('draws a write not yet read back over the value it replaced', () => {
    expect(view(stored, pending)).toEqual([
      ['r>a', 'r', 1],
      ['r>b', 's', 2],
    ]);
  });

  it('lets go of a write once it reads back, or somebody else’s value arrives — and does not take it up again', () => {
    const p = pending.map((e) => ({ ...e }));
    // a read back; b was changed elsewhere to 5.
    expect(view([edge('r', 'a', 1), edge('r', 'b', 5)], p)).toEqual([
      ['r>a', 'r', 1],
      ['r>b', 'r', 5],
    ]);
    // b back at the value the write replaced: the write is settled, the stored value is drawn.
    expect(view([edge('r', 'a', 2), edge('r', 'b', 1)], p)).toEqual([
      ['r>a', 'r', 2],
      ['r>b', 'r', 1],
    ]);
  });

  it('acornPendingAdd keeps the writes still unsettled, replaced by a newer one for the same line', () => {
    const p = pending.map((e) => ({ ...e }));
    const add = [{ id: 'r>a', was: { parent: 'r', siblingOrder: 1 }, now: { parent: 'r', siblingOrder: 0 } }];
    expect(call('acornPendingAdd', { connections: stored, pending: p, add })).toEqual([p[1], add[0]]);
    // Settled ones are dropped.
    expect(
      call('acornPendingAdd', { connections: [edge('r', 'a', 1), edge('r', 'b', 9)], pending: p, add: [] }),
    ).toEqual([]);
  });

  it('without `add`, acornPendingAdd is the writes still waiting — none for a write of the value already there', () => {
    const p = pending.map((e) => ({ ...e }));
    expect(call('acornPendingAdd', { connections: stored, pending: p })).toEqual(p);
    const noop = [{ id: 'r>a', was: { parent: 'r', siblingOrder: 2 }, now: { parent: 'r', siblingOrder: 2 } }];
    expect(call('acornPendingAdd', { connections: stored, pending: noop })).toEqual([]);
  });
});

describe('acornWaiting', () => {
  it('is true while a whole-field history is unsettled, false once it reads back or is overtaken', () => {
    const written = call('acornWritten', { stored: 'a', working: 'b', written: [] });
    expect(call('acornWaiting', { stored: 'a', written })).toBe(true);
    expect(call('acornWaiting', { stored: 'b', written })).toBe(false);
    expect(call('acornWaiting', { stored: 'a', written })).toBe(false);
    expect(call('acornWaiting', { stored: 'a', written: [] })).toBe(false);
  });
});
