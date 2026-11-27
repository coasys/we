import { describe, expect, it } from 'vitest';

import { describeReactivityGuarantees } from './guarantees';
import { createTestReactivity } from './port';

describeReactivityGuarantees('the test port', createTestReactivity);
describeReactivityGuarantees('the test port, siblings reversed', () => createTestReactivity({ order: 'reverse' }));
describeReactivityGuarantees('the test port, siblings in creation order, equal writes skipped', () =>
  createTestReactivity({ order: 'creation', equalWritesWake: false }),
);

describe('the test port, where the port leaves room', () => {
  const siblings = (p: ReturnType<typeof createTestReactivity>) => {
    const log: number[] = [];
    const [a, setA] = p.signal(0);
    p.root(() => {
      for (let i = 0; i < 8; i++) p.effect(() => a() > 0 && log.push(i));
    });
    setA(1);
    return log;
  };

  it('runs sibling effects in reverse when asked', () => {
    expect(siblings(createTestReactivity({ order: 'reverse' }))).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('shuffles sibling effects by its seed: the same seed, the same order', () => {
    const first = siblings(createTestReactivity({ seed: 7 }));
    expect([...first].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(siblings(createTestReactivity({ seed: 7 }))).toEqual(first);
    expect(siblings(createTestReactivity({ seed: 8 }))).not.toEqual(first);
  });

  it('never runs siblings in the order they were woken, whatever the seed', () => {
    for (let seed = 0; seed < 50; seed++) {
      const p = createTestReactivity({ seed });
      const log: number[] = [];
      const [a, setA] = p.signal(0);
      p.root(() => {
        p.effect(() => a() > 0 && log.push(0));
        p.effect(() => a() > 0 && log.push(1));
      });
      setA(1);
      expect(log).toEqual([1, 0]);
    }
  });

  it('wakes a reader on an equal write, unless told not to', () => {
    for (const [equalWritesWake, runs] of [
      [true, 2],
      [false, 1],
    ] as const) {
      const p = createTestReactivity({ equalWritesWake });
      let count = 0;
      const [a, setA] = p.signal(1);
      p.root(() => p.effect(() => (a(), count++)));
      setA(1);
      expect(count).toBe(runs);
    }
  });

  it('refuses an effect that settles only because an equal write is skipped', () => {
    const p = createTestReactivity();
    const [n, setN] = p.signal(0);
    expect(() => p.root(() => p.effect(() => setN(Math.min(n() + 1, 3))))).toThrow(/keeps waking itself/);
  });
});

describe('the test port, where it differs from Solid on purpose', () => {
  it('runs an effect created outside a batch straight away, not at the end of its root', () => {
    const p = createTestReactivity();
    const log: number[] = [];
    const [a] = p.signal(1);
    p.root(() => {
      p.effect(() => log.push(a()));
      expect(log).toEqual([1]);
    });
  });
});

describe('the test port, as an implementation', () => {
  it('does not re-run an effect when a memo it reads recomputes to the same value', () => {
    const p = createTestReactivity();
    const log: boolean[] = [];
    const [a, setA] = p.signal(1);
    p.root(() => {
      const positive = p.memo(() => a() > 0);
      p.effect(() => log.push(positive()));
    });
    setA(2);
    expect(log).toEqual([true]);
    setA(-1);
    expect(log).toEqual([true, false]);
  });

  it('forgets a dependency a re-run no longer reads', () => {
    const p = createTestReactivity();
    const log: string[] = [];
    const [which, setWhich] = p.signal<'a' | 'b'>('a');
    const [a, setA] = p.signal('a1');
    const [b] = p.signal('b1');
    p.root(() => p.effect(() => log.push(which() === 'a' ? a() : b())));
    setWhich('b');
    setA('a2');
    expect(log).toEqual(['a1', 'b1']);
  });

  it('refuses an effect that keeps waking itself rather than hanging', () => {
    const p = createTestReactivity();
    const [n, setN] = p.signal(0);
    expect(() => p.root(() => p.effect(() => setN(n() + 1)))).toThrow(/keeps waking itself/);
  });

  it('isolates one port from another', () => {
    const first = createTestReactivity();
    const second = createTestReactivity();
    const log: number[] = [];
    const [a, setA] = first.signal(1);
    second.root(() => second.effect(() => log.push(a())));
    setA(2);
    expect(log).toEqual([1]);
  });
});
