/**
 * A focus held in the middle while the arrangement around it settles — see `focusCentre`.
 *
 * Choosing something on a map often moves it: the press opens it, a tree lays itself out again around
 * what it opened into, and a card centred where it *was* ends up off to one side, or off screen. So
 * the camera follows the card for as long as the graph keeps moving, and lets go once it has been
 * still for a moment — a change arriving after that is somebody else's write, not the settling, and
 * must not yank the camera back. Somebody panning or zooming lets go at once (`stop`).
 */
export interface FocusFollow {
  /** Start following a node, and centre it now. */
  start(id: string): void;
  /** The graph moved: centre the node again, unless it has been still long enough to let go. */
  moved(): void;
  /** Let go — somebody took the camera. */
  stop(): void;
}

/** How long the graph must be still before the focus is settled and the camera let go. */
export const FOLLOW_QUIET_MS = 600;
/** The longest a camera follows a focus, whatever keeps moving. */
export const FOLLOW_MAX_MS = 4000;

export function createFocusFollow(deps: {
  /** Where a node is now, or nothing. */
  position: (id: string) => { x: number; y: number } | undefined;
  /** Centre the camera on a world point. */
  centre: (at: { x: number; y: number }) => void;
  now?: () => number;
}): FocusFollow {
  const now = deps.now ?? Date.now;
  let following: { id: string; quietUntil: number; giveUpAt: number } | undefined;
  const centre = () => {
    const at = following && deps.position(following.id);
    if (at) deps.centre(at);
  };
  return {
    start(id) {
      const t = now();
      following = { id, quietUntil: t + FOLLOW_QUIET_MS, giveUpAt: t + FOLLOW_MAX_MS };
      centre();
    },
    moved() {
      if (!following) return;
      const t = now();
      if (t > following.quietUntil || t > following.giveUpAt) {
        following = undefined;
        return;
      }
      following.quietUntil = t + FOLLOW_QUIET_MS;
      centre();
    },
    stop() {
      following = undefined;
    },
  };
}
