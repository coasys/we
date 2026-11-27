import { describeReactivityGuarantees } from '@we/reactivity/testing';
import { describe, expect, it } from 'vitest';

import { createVueReactivity } from './support/vueReactivity';

// The third engine passes the whole suite, or the store tests run under it prove nothing.
describeReactivityGuarantees('Vue', createVueReactivity);

describe('the Vue port, where it adds to Vue', () => {
  it('stops an effect made inside another when the outer one runs again', () => {
    const p = createVueReactivity();
    const log: string[] = [];
    const [outer, setOuter] = p.signal(1);
    const [inner, setInner] = p.signal('a');
    const dispose = p.root(() =>
      p.effect(() => {
        const run = outer();
        p.effect(() => log.push(`${run}:${inner()}`));
      }),
    );
    setOuter(2);
    setInner('b');
    expect(log).toEqual(['1:a', '2:a', '2:b']);
    dispose();
  });

  it('runs an effect woken inside another once that one has finished, not inside its write', () => {
    const p = createVueReactivity();
    const log: string[] = [];
    const [a, setA] = p.signal(0);
    const [b, setB] = p.signal(0);
    const dispose = p.root(() => {
      p.effect(() => {
        setB(a());
        log.push(`wrote ${a()}`);
      });
      p.effect(() => log.push(`read ${b()}`));
    });
    setA(1);
    expect(log).toEqual(['wrote 0', 'read 0', 'wrote 1', 'read 1']);
    dispose();
  });
});
