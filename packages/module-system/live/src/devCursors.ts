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
 * ## Why it cannot reach production
 *
 * The same three gates the call module's synthetic participants use, for the same reasons.
 * `import.meta.env.DEV` decides whether any of it exists — read once at module scope, so a production
 * build contributes no node and carries no callable action rather than an inert one. `localStorage` is
 * where the count lives, so it survives the reloads a developer does while iterating and no shipped
 * build sets it. And `devToolsEnabled` is the live switch, so somebody checking what a user sees loses
 * these along with every other developer affordance.
 */
import type { LiveAnchor, LiveDecoration } from '@we/module-shared';
import { devToolsEnabled } from '@we/module-shared';

const STORAGE_KEY = 'we.live.fakeCursors';

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

export function readDevCursorCount(): number {
  if (!visible() || typeof localStorage === 'undefined') return 0;
  return clampCount(Number(localStorage.getItem(STORAGE_KEY)));
}

/** Remember the count across the reloads a developer does while iterating. */
export function writeDevCursorCount(count: number): number {
  const next = clampCount(count);
  if (!devCursorsAvailable || typeof localStorage === 'undefined') return next;
  if (next === 0) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, String(next));
  return next;
}

function clampCount(raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), MAX) : 0;
}

/**
 * Where a synthetic cursor is at this moment, given the frame this agent is looking at.
 *
 * **Moving**, on circles of different radii and speeds, because the whole point is watching several
 * eased elements travel at once — a still cursor exercises the transition not at all, and a set of them
 * moving in step would hide the thing most likely to be wrong, which is one mark's transform being
 * applied to another. Each takes a different period so they visibly separate.
 *
 * In the surface this agent is on, so they land wherever real ones would: world units on a canvas,
 * fractions of the content box otherwise. A fraction is kept inside 0.1–0.9 so none of them sits under
 * the chrome at an edge.
 */
export function devCursorAnchors(count: number, surface: string, kind: LiveAnchor['kind'], now: number): LiveAnchor[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => {
    const phase = now / (1_400 + index * 260) + index;
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
