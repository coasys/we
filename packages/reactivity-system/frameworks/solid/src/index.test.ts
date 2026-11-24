import { DEFAULT_HOSTS, describeReactivityGuarantees } from '@we/reactivity/testing';
import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';

import { solidReactivity } from './index';

describeReactivityGuarantees('Solid', () => solidReactivity, {
  ...DEFAULT_HOSTS,
  // The host every store is built from today: inside a component, while the tree is rendering.
  'a mounted component tree': (_port, build) => {
    const container = document.createElement('div');
    return render(() => {
      build();
      return null;
    }, container);
  },
});

describe('Solid, where the port leaves room', () => {
  it('holds an effect created in a root to the end of the root, which the port does not promise', () => {
    const log: number[] = [];
    const [a] = solidReactivity.signal(1);
    const dispose = solidReactivity.root(() => {
      solidReactivity.effect(() => log.push(a()));
      expect(log).toEqual([]);
    });
    expect(log).toEqual([1]);
    dispose();
  });

  it('defers the effects of a root made while another is being built to the outer root’s end', () => {
    const log: number[] = [];
    const [a] = solidReactivity.signal(1);
    let inner = () => {};
    const outer = solidReactivity.root(() => {
      inner = solidReactivity.root(() => solidReactivity.effect(() => log.push(a())));
      // The inner root has returned and its effect has still not run: "the outermost root" in the
      // first guarantee is this case.
      expect(log).toEqual([]);
    });
    expect(log).toEqual([1]);
    inner();
    outer();
  });
});
