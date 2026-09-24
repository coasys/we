/**
 * Synthetic cursors, for measuring what a room full of them costs before there is a room.
 *
 * ## What it is for, and what it is not
 *
 * Two numbers about this feature are unknown and cannot be reasoned out: what the executor does when
 * ten peers each publish a dozen times a second, and whether the eighteen-second first-send stall the
 * ephemeral adapter documents applies to this channel. Both need a measurement, and a measurement needs
 * ten people. This is the substitute.
 *
 * It fakes at the **decoration** layer, which is the opposite of what would be useful for judging the
 * transport: nothing here publishes or receives, so it says nothing at all about throughput. What it
 * does exercise is everything downstream of "there are N cursors on screen" — the mark keying, the
 * transition, the counter-scale against the camera, the overlay's scroll repositioning, and whether
 * twelve eased elements moving at once is smooth. That is the half a person can judge by looking, and
 * the half no unit test can answer.
 *
 * The transport half is measured the other way round: turn these on to fill the screen, then watch the
 * publish rate the ladder picks in a trace. `cursorIntervalMs` is the number being tuned, and this is
 * what makes its effect visible.
 *
 * ## Turning it on
 *
 * A `−  N  +` trio appears beside the cursor toggle in a development build. Deliberately not a console
 * incantation: the loop this exists for is changing the count and watching the screen, and leaving the
 * app to do it breaks exactly that loop. Being on screen is also what stops it being silently left on.
 *
 * ## The count does not survive a reload, and that is the opposite of the call module
 *
 * `devPeers` keeps its count in `localStorage`, deliberately, so it survives the reloads a developer
 * does while iterating on the call stage. The same choice here was a trap, because the control and the
 * marks do not live in the same place: the `−  N  +` is in the call bar, and the cursors draw over
 * whatever is on screen. So a count of three survived a reload, three cursors appeared at login, and
 * there was no control anywhere to remove them until somebody started a call.
 *
 * In memory, a reload is the way out. The cost is re-pressing `+` after one, which is cheap — cursor
 * rendering is judged live rather than across reloads, so there is nothing to carry over.
 *
 * ## Why it cannot reach production
 *
 * `import.meta.env.DEV` decides whether any of it exists — read once at module scope, so a production
 * build contributes no node and carries no callable action rather than an inert one. And
 * `devToolsEnabled` is the live switch, so somebody checking what a user sees loses these along with
 * every other developer affordance.
 */
import type { LiveAnchor, LiveDecoration } from '@we/module-shared';
import { devToolsEnabled } from '@we/module-shared';

/** More than this is a stray keypress rather than a test. */
const MAX = 24;

/** True in a development build. Cast rather than `vite/client` types — see `devCursorsAvailable`. */
const DEV_BUILD = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

/**
 * Whether any of this exists at all.
 *
 * Read once, at module scope, so the definition can decide whether to contribute the controls and the
 * actions — a decision made when the module is defined rather than per render.
 *
 * The **build flag only**, deliberately. `we.devTools` is a live switch, and folding it in here would
 * have a module-scope read decide at boot what a switch is expected to change on the press: the
 * controls would vanish when it was thrown off and never come back.
 *
 * Cast rather than `vite/client` types, because a feature module must not take a build tool as a
 * dependency — one may be loaded into a host that uses none. The cast is erased, and what a bundler
 * sees is `import.meta.env?.DEV`.
 */
export const devCursorsAvailable = DEV_BUILD;

/** Whether they should be showing right now — the switch, re-read rather than remembered. */
function visible(): boolean {
  return devToolsEnabled(DEV_BUILD);
}

/** The count for this page, in memory — see the note above on why it does not persist. */
let count = 0;

export function readDevCursorCount(): number {
  return visible() ? count : 0;
}

/** Set the count, clamped. Returns what it became. */
export function writeDevCursorCount(next: number): number {
  count = clampCount(next);
  return count;
}

function clampCount(raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), MAX) : 0;
}

/**
 * Where a synthetic cursor is at step `step`, given the frame this agent is looking at.
 *
 * **Moving**, on circles of different radii and speeds, because the whole point is watching several
 * eased elements travel at once — a still cursor exercises the transition not at all, and a set of them
 * moving in step would hide the thing most likely to be wrong, which is one mark's transform being
 * applied to another. Each takes a different period so they visibly separate.
 *
 * ## A step counter, not a clock
 *
 * This took `Date.now()`, which made the position a function of *when it was asked* rather than of how
 * far the animation had got — so every unrelated recompute moved every cursor. Recomputes are not rare:
 * the marks are rebuilt whenever anything they read changes, and one of those is the content box, which
 * changes on every pointer move while a panel is being dragged. The marks then moved at pointer rate
 * while their 90ms easing restarted from wherever it had reached, which reads as jitter in place with no
 * progress at all until the drag ends.
 *
 * Driven by a counter, a recompute with the same step returns the identical position, so the transform
 * string does not change and nothing restarts. The animation advances only when the tick does.
 *
 * In the surface this agent is on, so they land wherever real ones would: world units on a canvas,
 * fractions of the content box otherwise. A fraction is kept inside 0.1–0.9 so none of them sits under
 * the chrome at an edge.
 */
export function devCursorAnchors(count: number, surface: string, kind: LiveAnchor['kind'], step: number): LiveAnchor[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => {
    // Radians per tick, a little different per cursor so they separate rather than travel in formation.
    // At the tick's 100ms, the slowest takes about four seconds to come round.
    const phase = step * (0.16 - index * 0.012) + index;
    const wobble = { x: Math.cos(phase), y: Math.sin(phase) };
    if (kind === 'world') {
      const radius = 90 + index * 26;
      return { surface, kind: 'world' as const, x: wobble.x * radius, y: wobble.y * radius };
    }
    const spread = 0.12 + (index % 5) * 0.06;
    return {
      surface,
      kind: 'viewport' as const,
      x: 0.5 + wobble.x * spread,
      y: 0.5 + wobble.y * spread,
    };
  });
}

/**
 * The synthetic marks to append, drawn exactly as a real cursor is.
 *
 * Deliberately the *same* node a real one gets, with a made-up hue per index rather than a face: if
 * these were drawn with something simpler they would be a test of something the app does not do. An
 * explicit `color` is what the primitive offers for a mark that stands for something other than a
 * person, and a fake cursor is precisely that.
 */
export function devCursorMarks(anchors: LiveAnchor[]): LiveDecoration[] {
  return anchors.map((at, index) => ({
    id: `fake-cursor-${index}`,
    at,
    ease: true,
    node: {
      type: 'we-live-cursor',
      props: {
        name: `Fake ${index + 1}`,
        hash: `fake-cursor-${index}`,
        color: `oklch(0.62 0.16 ${(index * 67) % 360})`,
      },
    },
  }));
}
