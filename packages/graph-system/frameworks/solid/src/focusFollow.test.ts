/**
 * A focus kept in the middle while a map settles around it — see `focusFollow.ts`. Driven here with a
 * camera of plain numbers and frames run by hand, since the real camera needs a measured canvas,
 * which a test has not got.
 */
import { describe, expect, it } from 'vitest';

import { createFocusFollow, FOLLOW_MAX_MS, FOLLOW_QUIET_MS } from './focusFollow';

/** A card at `card` on a canvas whose middle the camera is panned to `camera`; frames run by `step`. */
function follower(reduced = false) {
  let t = 0;
  const card = { x: 300, y: -200 };
  const camera = { x: 0, y: 0 };
  let pending: (() => void) | undefined;
  const follow = createFocusFollow({
    offset: () => ({ dx: card.x - camera.x, dy: card.y - camera.y }),
    pan: (dx, dy) => {
      camera.x += dx;
      camera.y += dy;
    },
    frame: (step) => {
      pending = step;
    },
    reduced: () => reduced,
    now: () => t,
  });
  const step = (frames = 1) => {
    for (let i = 0; i < frames && pending; i++) {
      t += 16;
      const run = pending;
      pending = undefined;
      run();
    }
  };
  return { follow, card, camera, step, wait: (ms: number) => (t += ms), idle: () => !pending };
}

describe('a focus followed while the map settles', () => {
  it('glides the card to the middle rather than jumping there', () => {
    const { follow, camera, step } = follower();
    follow.start('card');
    step();
    // Partway after a frame: a glide, not a jump.
    expect(camera.x).toBeGreaterThan(0);
    expect(camera.x).toBeLessThan(300);
    step(60);
    expect(camera.x).toBeCloseTo(300, 0);
    expect(camera.y).toBeCloseTo(-200, 0);
  });

  it('jumps for somebody who asked for less movement', () => {
    const { follow, camera, step } = follower(true);
    follow.start('card');
    step();
    expect(camera).toEqual({ x: 300, y: -200 });
  });

  it('follows the card wherever the layout moves it while the map settles', () => {
    const { follow, card, camera, step } = follower();
    follow.start('card');
    step(10);
    // The layout moves the card while the camera is still on its way to it.
    card.x = 700;
    follow.moved();
    step(60);
    expect(camera.x).toBeCloseTo(700, 0);
  });

  it('lets go once the map has been still, so a later write does not pull the camera back', () => {
    const { follow, card, camera, step, wait } = follower();
    follow.start('card');
    step(60);
    wait(FOLLOW_QUIET_MS + 1);
    card.x = 900;
    follow.moved();
    step(60);
    expect(camera.x).toBeCloseTo(300, 0);
  });

  it('lets go when somebody moves the canvas, and after the longest a settle can take', () => {
    const stopped = follower();
    stopped.follow.start('card');
    stopped.follow.stop();
    stopped.step(60);
    expect(stopped.camera.x).toBe(0);

    const busy = follower();
    busy.follow.start('card');
    busy.wait(FOLLOW_MAX_MS + 1);
    busy.step();
    expect(busy.camera.x).toBe(0);
  });

  it('stops asking for frames once the card is in the middle', () => {
    const { follow, step, idle } = follower();
    follow.start('card');
    step(200);
    expect(idle()).toBe(true);
  });
});
