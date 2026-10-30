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

  /*
    Choosing a definition beside kinds that are opening and closing moves the card while the camera is
    on its way to it. The camera was aimed at a point — the card, then where it would rest — and moved
    on its own curve while the card moved on the layout's, and the card shook from side to side. Its
    place on screen is what eases now: the layout moving it is taken up by the camera at once.
  */
  it('eases the card in on screen, untouched by the layout moving it on the way', () => {
    const { follow, card, camera, step } = follower();
    const onScreen: number[] = [];
    const frames = (n: number, move?: () => void) => {
      for (let i = 0; i < n; i++) {
        move?.();
        follow.moved();
        step();
        onScreen.push(card.x - camera.x);
      }
    };
    follow.start('card');
    frames(4);
    // The layout carries the card one way and then the other while it comes in.
    frames(6, () => (card.x += 40));
    frames(6, () => (card.x -= 70));
    frames(80);
    // On screen it only ever closes on the middle — never back out, never across it.
    for (let i = 1; i < onScreen.length; i++) {
      expect(Math.abs(onScreen[i])).toBeLessThanOrEqual(Math.abs(onScreen[i - 1]) + 1e-6);
      expect(onScreen[i]).toBeGreaterThanOrEqual(-1e-6);
    }
    expect(camera.x).toBeCloseTo(card.x, 0);
    // From rest: it sets off gently rather than with its largest step.
    expect(300 - onScreen[0]).toBeLessThan(onScreen[0] - onScreen[1] + 300 - onScreen[0]);
  });

  it('holds the card in the middle while the map settles around it', () => {
    const { follow, card, camera, step } = follower();
    follow.start('card');
    // The map still settling, so it is still held.
    for (let i = 0; i < 80; i++) {
      follow.moved();
      step();
    }
    for (const x of [340, 410, 380, 520]) {
      card.x = x;
      follow.moved();
      // In the same tick, before a frame is drawn.
      expect(card.x - camera.x).toBeCloseTo(0, 6);
    }
  });

  /*
    The camera went on following the old card until the new one was there — and the old card, its
    kind closing, travelled up into its parent, so the camera went up before it went across.
  */
  it('lets go of the old card when the focus changes, braking rather than following it away', () => {
    const { follow, card, camera, step, idle } = follower();
    follow.start('card');
    step(8);
    const moving = camera.x;
    follow.release();
    // The old card folds away upwards.
    card.y = -900;
    follow.moved();
    step(120);
    // It carried on a little the way it was going, then stopped; it never went after the card.
    expect(camera.x).toBeGreaterThan(moving);
    expect(camera.y).toBeGreaterThan(-300);
    expect(idle()).toBe(true);
  });

  it('stops asking for frames once the card is in the middle', () => {
    const { follow, step, idle } = follower();
    follow.start('card');
    step(200);
    expect(idle()).toBe(true);
  });
});
