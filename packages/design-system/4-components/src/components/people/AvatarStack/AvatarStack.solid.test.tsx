/**
 * What a stack of faces claims about how many people there are.
 *
 * Every case here is a behaviour the component's own comments record as having gone wrong once, and
 * none of them had a test. They share a shape: the stack draws fewer faces than it was handed, and
 * the interesting question is always whether the number it reports is still true.
 *
 * Rendered rather than unit-tested because the dedupe and the cap are memos over props — extracting
 * them would test arithmetic that was never in doubt and skip the part that breaks, which is a memo
 * that stops following its input.
 */
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { AvatarStack } from './AvatarStack.solid';
import type { AvatarInfo } from './AvatarStack.types';

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
});

function mount(props: Parameters<typeof AvatarStack>[0]) {
  host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <AvatarStack {...props} />, host);
  return {
    faces: () => host!.querySelectorAll('we-avatar').length,
    overflow: () => {
      // The chip is the only child that is not a face wrapper, and it renders "+N".
      const text = host!.textContent ?? '';
      const match = text.match(/\+(\d+)/);
      return match ? Number(match[1]) : 0;
    },
  };
}

const did = (n: number): AvatarInfo => ({ hash: `did:key:z${n}`, initials: `A${n}` });

describe('a stack draws each person once', () => {
  it('folds repeats of the same person together', () => {
    // Participant lists come from add-only relations: every agent transcribing a call appends, with
    // no coordination, so a two-person call routinely carries each of them several times.
    const stack = mount({ avatars: [did(1), did(2), did(1), did(1), did(2)] });
    expect(stack.faces()).toBe(2);
    expect(stack.overflow()).toBe(0);
  });

  it('identifies by hash before anything else, so one agent is one face', () => {
    const same = [
      { hash: 'did:key:z1', initials: 'AA', image: '/a.png' },
      { hash: 'did:key:z1', initials: 'BB', image: '/b.png' },
    ];
    expect(mount({ avatars: same }).faces()).toBe(1);
  });

  it('counts entries with nothing to identify them separately', () => {
    // A stack of unidentified faces should still show how many there are, rather than folding every
    // blank into one.
    expect(mount({ avatars: [{}, {}, {}] }).faces()).toBe(3);
  });
});

describe('the cap counts people, and says how many it is hiding', () => {
  it('shows the overflow count rather than dropping people in silence', () => {
    // The regression this exists for: `max` once dropped everyone past it with no chip, so a
    // twelve-person call drew five faces and read as a five-person call.
    const stack = mount({ avatars: Array.from({ length: 12 }, (_, i) => did(i)), max: 5 });
    expect(stack.faces()).toBe(5);
    expect(stack.overflow()).toBe(7);
  });

  it('caps after deduping, so the cap counts people rather than links', () => {
    // Eight links, three people, max 2 → one hidden person, not six hidden links.
    const avatars = [did(1), did(1), did(2), did(2), did(2), did(3), did(1), did(3)];
    const stack = mount({ avatars, max: 2 });
    expect(stack.faces()).toBe(2);
    expect(stack.overflow()).toBe(1);
  });

  it('shows no chip when everyone fits', () => {
    const stack = mount({ avatars: [did(1), did(2)], max: 5 });
    expect(stack.faces()).toBe(2);
    expect(stack.overflow()).toBe(0);
  });

  it('draws only the chip when the cap is zero', () => {
    const stack = mount({ avatars: [did(1), did(2), did(3)], max: 0 });
    expect(stack.faces()).toBe(0);
    expect(stack.overflow()).toBe(3);
  });

  it('survives being handed nothing', () => {
    const stack = mount({ avatars: [] });
    expect(stack.faces()).toBe(0);
    expect(stack.overflow()).toBe(0);
  });
});

describe('a ring is a claim, so it is only made when somebody asks', () => {
  const face = (i: number) =>
    host!.querySelectorAll('we-avatar')[i] as HTMLElement & { ringColor?: string; edgeColor?: string };

  it('paints none by default', () => {
    // It once defaulted to `neutral-0`, which is the surface colour only on a `neutral-0` surface —
    // and the neutral scale inverts under the dark themes, so it landed as a black band.
    mount({ avatars: [did(1)] });
    expect(face(0).ringColor).toBeFalsy();
    expect(face(0).edgeColor).toBeFalsy();
  });

  it('hands each face its own tone, drawn inside it by the primitive', () => {
    mount({ avatars: [{ hash: 'a', tone: 'warning' }, { hash: 'b' }] });
    expect(face(0).ringColor).toBe('warning');
    expect(face(1).ringColor).toBeFalsy();
  });

  it('separates overlapping faces in the colour the caller says is behind them', () => {
    mount({ avatars: [{ hash: 'a' }, { hash: 'b' }], edge: 'var(--we-role-surface)' });
    expect(face(0).edgeColor).toBe('var(--we-role-surface)');
    expect(face(1).edgeColor).toBe('var(--we-role-surface)');
  });
});

describe('the first face is on top', () => {
  it('stacks each face under the one before it, and the count under them all', () => {
    // The lists come ordered by importance, so the first face is the one that has to be whole.
    const people = ['a', 'b', 'c', 'd'].map((hash) => ({ hash }));
    mount({ avatars: people, max: 3 });

    const row = host!.firstElementChild as HTMLElement;
    const layers = Array.from(row.children).map((child) => Number((child as HTMLElement).style.zIndex));

    expect(layers).toEqual([4, 3, 2, 1]);
    expect(row.style.isolation).toBe('isolate');
  });
});
