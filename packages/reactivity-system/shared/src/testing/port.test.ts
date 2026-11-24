import { describe, expect, it } from 'vitest';

import { describeReactivityGuarantees } from './guarantees';
import { createTestReactivity } from './port';

describeReactivityGuarantees('the test port', createTestReactivity);

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
