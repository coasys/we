/**
 * A focus held in the middle while the arrangement around it settles — see `focusCentre`.
 *
 * Choosing something on a map often moves it: the press opens it, a tree lays itself out again around
 * what it opened into, and a card centred where it *was* ends up off to one side, or off screen. So
 * the camera follows the card for as long as the graph keeps moving, and lets go once it has been
 * still for a moment — a change arriving after that is somebody else's write, not the settling, and
 * must not yank the camera back. Somebody panning or zooming lets go at once (`stop`).
 *
 * ## A glide, not a jump
 *
 * The camera eases towards the card, closing a share of the distance left on every frame, rather
 * than being animated to a point. The point is not fixed: the card is itself travelling while the
 * layout settles, so a tween aimed at where it was would arrive somewhere wrong and have to start
 * again. Closing a share of whatever the gap is *now* follows a moving card for nothing, and reads
 * as one movement that slows as it arrives. Under reduced motion it closes the whole gap at once.
 */
export interface FocusFollow {
  /** Start following a node, and glide it to the middle. */
  start(id: string): void;
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
 * How quickly the glide closes the gap: the time it takes to cover about two thirds of it. Most of
 * a move is over in a quarter of a second, and the last few pixels ease in.
 */
export const GLIDE_MS = 110;

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
  let following: { id: string; quietUntil: number; giveUpAt: number } | undefined;
  let scheduled = false;
  let last = 0;

  const glide = () => {
    scheduled = false;
    if (!following) return;
    const t = now();
    if (t > following.giveUpAt) {
      following = undefined;
      return;
    }
    const gap = deps.offset(following.id);
    if (!gap) return;
    const share = reduced() ? 1 : 1 - Math.exp(-Math.max(t - last, 1) / GLIDE_MS);
    last = t;
    if (Math.abs(gap.dx) < 0.5 && Math.abs(gap.dy) < 0.5) return;
    deps.pan(gap.dx * share, gap.dy * share);
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
      last = t - 16;
      schedule();
    },
    moved() {
      if (!following) return;
      const t = now();
      if (t > following.quietUntil || t > following.giveUpAt) {
        following = undefined;
        return;
      }
      following.quietUntil = t + FOLLOW_QUIET_MS;
      schedule();
    },
    stop() {
      following = undefined;
    },
  };
}
