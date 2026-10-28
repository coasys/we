/**
 * A focus kept in the middle while a map settles around it — see `focusFollow.ts`. The camera itself
 * needs a measured canvas, which a test has not got, so what is pinned is the decision: when to
 * centre again, and when to let go.
 */
import { describe, expect, it } from 'vitest';

import { createFocusFollow, FOLLOW_MAX_MS, FOLLOW_QUIET_MS } from './focusFollow';

function follower() {
  let t = 0;
  const at = new Map<string, { x: number; y: number }>([['card', { x: 0, y: 0 }]]);
  const centred: { x: number; y: number }[] = [];
  const follow = createFocusFollow({ position: (id) => at.get(id), centre: (p) => centred.push(p), now: () => t });
  return {
    follow,
    centred,
    move: (x: number, y: number) => at.set('card', { x, y }),
    wait: (ms: number) => (t += ms),
  };
}

describe('a focus followed while the map settles', () => {
  it('centres the card at once, and again wherever the layout moves it', () => {
    const { follow, centred, move, wait } = follower();
    follow.start('card');
    expect(centred).toEqual([{ x: 0, y: 0 }]);
    // The press opened it, and the tree laid itself out again around what it opened into.
    wait(100);
    move(400, 120);
    follow.moved();
    expect(centred.at(-1)).toEqual({ x: 400, y: 120 });
  });

  it('lets go once the map has been still, so a later write does not pull the camera back', () => {
    const { follow, centred, move, wait } = follower();
    follow.start('card');
    wait(FOLLOW_QUIET_MS + 1);
    move(900, 0);
    follow.moved();
    expect(centred).toHaveLength(1);
  });

  it('lets go when somebody moves the canvas, and after the longest a settle can take', () => {
    const stopped = follower();
    stopped.follow.start('card');
    stopped.follow.stop();
    stopped.follow.moved();
    expect(stopped.centred).toHaveLength(1);

    const busy = follower();
    busy.follow.start('card');
    for (let i = 0; i < FOLLOW_MAX_MS / 100 + 2; i++) {
      busy.wait(100);
      busy.follow.moved();
    }
    expect(busy.centred.length).toBeLessThanOrEqual(FOLLOW_MAX_MS / 100 + 1);
    const before = busy.centred.length;
    busy.wait(100);
    busy.follow.moved();
    expect(busy.centred).toHaveLength(before);
  });
});
