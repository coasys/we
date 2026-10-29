/**
 * A focus held in the middle while the arrangement around it settles — see `focusCentre`.
 *
 * Choosing something on a map often moves it: the press opens it, a tree lays itself out again around
 * what it opened into, and a card centred where it *was* ends up off to one side, or off screen. So
 * the camera follows the card for as long as the graph keeps moving, and lets go once it has been
 * still for a moment — a change arriving after that is somebody else's write, not the settling, and
 * must not yank the camera back. Somebody panning or zooming lets go at once (`stop`).
 *
 * ## A glide with momentum
 *
 * The camera is a critically damped spring pulled towards the card: it carries a speed, starts from
 * rest, and eases in without overshooting. The point it is pulled to is not fixed — the card is itself
 * travelling while the layout settles, and its resting place moves as what is around it opens and
 * closes — so the camera bends towards each new place without losing the speed it had.
 *
 * It closed a share of the remaining gap each frame, which has no speed to keep: it set off at full
 * speed, and each time the resting place moved it turned towards the new one at once. Choosing a
 * definition in another kind of Social DNA moves that place three times — the kind opens, the
 * definition arrives, it opens into its uses — and each one was a kink in the camera's path.
 * Under reduced motion it closes the whole gap at once.
 *
 * ## A new focus lets go of the old one
 *
 * `release` stops following without stopping the camera: it brakes, keeping the speed it had, until
 * the next card is there to follow. Until then it went on following the old card — which, when the
 * kind it was in closed, travelled up into its parent, and the camera went up with it before crossing
 * to the new one.
 */
export interface FocusFollow {
  /** Start following a node, and glide it to the middle — from whatever speed the camera has. */
  start(id: string): void;
  /** Stop following, and brake to a stop: the focus is changing, and what comes next is not there yet. */
  release(): void;
  /** The graph moved: keep gliding after the node, unless it has been still long enough to let go. */
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
  /** How far the camera must pan, in screen pixels, to put a node in the middle — or nothing. */
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
  /** The camera's speed, in screen pixels a millisecond. */
  let speed = { x: 0, y: 0 };
  let scheduled = false;
  let last = 0;

  const rest = () => {
    following = undefined;
    speed = { x: 0, y: 0 };
  };

  const glide = () => {
    scheduled = false;
    if (!following) return;
    const t = now();
    if (t > following.giveUpAt) return rest();
    // Braking is following a target where the camera already is; a node gone is braked from too.
    const gap = (following.id ? deps.offset(following.id) : undefined) ?? { dx: 0, dy: 0 };
    if (reduced()) {
      if (Math.abs(gap.dx) >= 0.5 || Math.abs(gap.dy) >= 0.5) deps.pan(gap.dx, gap.dy);
      speed = { x: 0, y: 0 };
      if (!following.id) following = undefined;
      return;
    }
    const dt = Math.min(Math.max(t - last, 1), 64);
    last = t;
    const x = springStep(gap.dx, speed.x, dt);
    const y = springStep(gap.dy, speed.y, dt);
    speed = { x: x.speed, y: y.speed };
    const settled = Math.abs(gap.dx) < 0.5 && Math.abs(gap.dy) < 0.5 && Math.hypot(speed.x, speed.y) * 16 < 0.5;
    if (settled) {
      // The last fraction of a pixel, so it comes to rest in the middle rather than beside it.
      if (following.id && (gap.dx || gap.dy)) deps.pan(gap.dx, gap.dy);
      speed = { x: 0, y: 0 };
      if (!following.id) following = undefined;
      return;
    }
    deps.pan(x.move, y.move);
    schedule();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    frame(glide);
  };

  return {
    start(id) {
      const t = now();
      following = { id, quietUntil: t + FOLLOW_QUIET_MS, giveUpAt: t + FOLLOW_MAX_MS };
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
      schedule();
    },
    stop: rest,
  };
}
