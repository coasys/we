/**
 * A focus held in the middle while the arrangement around it settles — see `focusCentre`.
 *
 * Choosing something on a map often moves it: the press opens it, a tree lays itself out again around
 * what it opened into, and a card centred where it *was* ends up off to one side, or off screen. So
 * the camera follows the card for as long as the graph keeps moving, and lets go once it has been
 * still for a moment — a change arriving after that is somebody else's write, not the settling, and
 * must not yank the camera back. Somebody panning or zooming lets go at once (`stop`).
 *
 * ## The card is anchored; the map moves around it
 *
 * What eases is where the card is *on screen* — its distance from the middle, a critically damped
 * spring that starts from rest and comes in without overshooting. The camera is whatever puts the card
 * there: every frame it measures where the card is drawn now and pans by exactly enough. So a layout
 * moving the card — the kinds beside it opening and closing, the card opening into its uses — moves
 * the camera with it, and the card does not move on screen at all; once it has arrived it is held in
 * the middle while the map settles around it.
 *
 * Twice before this aimed the camera at a point instead: at the card, then at where the card would
 * come to rest. Either way the camera moved on one curve and the drawn card on another (the layout's
 * travel, re-aimed each time the forest shifted), and the difference was the card shaking from side
 * to side. Measured from where the card is drawn, there is no second curve. The correction runs in the
 * same tick as the layout's own move (`moved`), so it is never a frame behind.
 *
 * ## A new focus lets go of the old one
 *
 * `release` stops following without stopping the camera: it brakes, keeping the speed it had, until
 * the next card is there to follow. Until then it went on following the old card — which, when the
 * kind it was in closed, travelled up into its parent, and the camera went up with it before crossing
 * to the new one. Under reduced motion the card is put in the middle at once.
 */
export interface FocusFollow {
  /** Start following a node, and glide it to the middle — from whatever speed the camera has. */
  start(id: string): void;
  /** Stop following, and brake to a stop: the focus is changing, and what comes next is not there yet. */
  release(): void;
  /** The graph moved: hold the node where it is on screen, unless it has been still long enough to let go. Call it in the same tick as the move. */
  moved(): void;
  /** Let go — somebody took the camera. */
  stop(): void;
}

/** How long the graph must be still before the focus is settled and the camera let go. */
export const FOLLOW_QUIET_MS = 600;
/** The longest a camera follows a focus, whatever keeps moving. */
export const FOLLOW_MAX_MS = 4000;
/**
 * How long the glide takes, roughly: the spring's smoothing time. Most of a move is over in about
 * this long, and the rest eases in.
 */
export const GLIDE_MS = 200;

/**
 * One step of a critically damped spring along one axis — the camera's speed, and how far to move —
 * towards a target `gap` away. The closed form of the spring, approximated to stay stable at any frame
 * length (the form game engines call smooth damp).
 */
export function springStep(gap: number, speed: number, dt: number, smoothMs = GLIDE_MS) {
  const omega = 2 / smoothMs;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = -gap;
  const temp = (speed + omega * change) * dt;
  return { speed: (speed - omega * temp) * decay, move: gap + (change + temp) * decay };
}

export function createFocusFollow(deps: {
  /** How far the camera must pan, in screen pixels, to put a node *as drawn now* in the middle — or nothing. */
  offset: (id: string) => { dx: number; dy: number } | undefined;
  /** Pan the camera by this much. */
  pan: (dx: number, dy: number) => void;
  /** Run on the next frame. */
  frame?: (step: () => void) => void;
  /** Whether the reader asked for less movement. */
  reduced?: () => boolean;
  now?: () => number;
}): FocusFollow {
  const now = deps.now ?? Date.now;
  const frame = deps.frame ?? ((step) => requestAnimationFrame(() => step()));
  const reduced = deps.reduced ?? (() => false);
  /** What is followed: a node, or nothing while braking after `release`. */
  let following: { id?: string; quietUntil: number; giveUpAt: number } | undefined;
  /** Where the card should be on screen, as its distance from the middle — what the spring eases. */
  let aim = { x: 0, y: 0 };
  /** How fast that distance is closing, in screen pixels a millisecond — the camera's own speed. */
  let speed = { x: 0, y: 0 };
  let scheduled = false;
  let last = 0;

  const rest = () => {
    following = undefined;
    speed = { x: 0, y: 0 };
  };
  const still = () => Math.hypot(speed.x, speed.y) * 16 < 0.5;

  const glide = () => {
    if (!following) return;
    const t = now();
    if (t > following.giveUpAt) return rest();
    const dt = Math.min(Math.max(t - last, 1), 64);
    last = t;
    const gap = following.id ? deps.offset(following.id) : undefined;

    // Braking: the camera coasts on the speed it had and comes to a stop.
    if (!gap) {
      if (reduced()) return rest();
      const x = springStep(0, speed.x, dt);
      const y = springStep(0, speed.y, dt);
      speed = { x: x.speed, y: y.speed };
      if (still()) {
        if (!following.id) following = undefined;
        speed = { x: 0, y: 0 };
        return;
      }
      deps.pan(x.move, y.move);
      return schedule();
    }

    // Where the card should be now: the spring's next step towards the middle, or the middle itself.
    if (reduced()) {
      aim = { x: 0, y: 0 };
      speed = { x: 0, y: 0 };
    } else {
      const x = springStep(aim.x, speed.x, dt);
      const y = springStep(aim.y, speed.y, dt);
      aim = { x: aim.x - x.move, y: aim.y - y.move };
      speed = { x: x.speed, y: y.speed };
      if (Math.abs(aim.x) < 0.5 && Math.abs(aim.y) < 0.5 && still()) {
        aim = { x: 0, y: 0 };
        speed = { x: 0, y: 0 };
      }
    }
    // Whatever puts it there, however the layout has moved it since the last frame.
    const dx = gap.dx - aim.x;
    const dy = gap.dy - aim.y;
    if (Math.abs(dx) >= 0.01 || Math.abs(dy) >= 0.01) deps.pan(dx, dy);
    if (aim.x || aim.y) schedule();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    frame(() => {
      scheduled = false;
      glide();
    });
  };

  return {
    start(id) {
      const t = now();
      following = { id, quietUntil: t + FOLLOW_QUIET_MS, giveUpAt: t + FOLLOW_MAX_MS };
      // From where the card is drawn now, at the speed the camera already has.
      const gap = deps.offset(id);
      aim = reduced() || !gap ? { x: 0, y: 0 } : { x: gap.dx, y: gap.dy };
      // A frame's worth of glide on the first step, rather than the whole gap from a stale clock.
      if (!scheduled) last = t - 16;
      schedule();
    },
    release() {
      if (!following) return;
      following = { ...following, id: undefined };
      schedule();
    },
    moved() {
      if (!following?.id) return;
      const t = now();
      if (t > following.quietUntil || t > following.giveUpAt) return rest();
      following.quietUntil = t + FOLLOW_QUIET_MS;
      // Now, in the tick that moved it, so the card is held rather than caught up with a frame late.
      glide();
    },
    stop: rest,
  };
}
