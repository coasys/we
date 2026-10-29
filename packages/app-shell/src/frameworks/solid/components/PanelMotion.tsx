/**
 * Panels move between boxes rather than jumping to them — between places, and within a lane.
 *
 * A frame over the window eases between the boxes the geometry gives it with a CSS transition on its
 * own `top`/`left`/`width`/`height`. A frame in a lane cannot: the lane lays it out, so nothing about
 * its box is a property that changes — and a panel moving between places is a *new* frame element
 * where it lands, with no previous box at all. So this remembers where every panel's frame was drawn
 * and, when the arrangement changes, plays each frame from its old box to its new one (FLIP: first,
 * last, invert, play) with a transform — a card dropped into a lane, a section broken out of the page,
 * lane-mates making room for a newcomer.
 *
 * Not for a panel joining or leaving a seat (`settling`), which lands where it is dropped as a tab
 * always has. Not while a drag or a resize is live (the frame must follow the hand, and the one being dragged is
 * remembered all the way so its landing starts from where it was let go), not for a lane easing into
 * or out of its strip (the lane eases its own thickness), not across a change of the
 * window's size (everything moves at once, and easing that is a lurch), not for a frame floating over
 * the window whose own transition already eases it, and not at all for a reader who asked for less
 * motion.
 */
import { DOCK_FRAME_ATTR } from '@shared/registries/dockRegistry';
import { createEffect, onCleanup } from 'solid-js';

import { useShellStore } from '../stores/ShellStore';

/** As long as a frame's own transition (`300`) at the default animation speed. */
const MOTION_MS = 300;
/** A box that moved less than this did not move. */
const STILL_PX = 1;

interface Seen {
  el: Element;
  rect: DOMRect;
  /** Easing into or out of its lane's strip — which the lane animates itself, by its thickness. */
  stowing: boolean;
}

export function PanelMotion() {
  const shellStore = useShellStore();
  const seen = new Map<string, Seen>();
  /*
    The box each frame is heading for while it plays — what it is measured as until it gets there. A
    box read mid-animation includes the transform, so the next recount saw the frame "move" from
    there to where it already was and played it a second time, a second or so after the first.
  */
  const playing = new WeakMap<Element, { animation: Animation; to: DOMRect }>();
  /*
    Panels that joined or left a seat — see `settling`. They land rather than travel, as a tab always
    has: the drag was the animation. Held until the next measurement, because `settling` is true for
    one frame and the recount that clears it can arrive before the measurement does.
  */
  const landing = new Set<string>();
  let viewport = '';
  let frame: number | undefined;
  onCleanup(() => frame !== undefined && cancelAnimationFrame(frame));

  /*
    A frame that changes size by itself — content arriving late, a lane dragged wider — has not moved.
    Remembered as it settles, so the next change to the arrangement starts from where it really is:
    otherwise a panel whose content loaded after it opened played, on the next recount, from the size
    it opened at — vanishing and sliding in again. Not while a measurement is pending, whose whole
    point is the box from *before* the change that scheduled it; and not for a frame mid-animation.
  */
  const resized =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          if (frame !== undefined) return;
          for (const el of document.querySelectorAll<HTMLElement>(`[${DOCK_FRAME_ATTR}]`)) {
            const id = el.getAttribute(DOCK_FRAME_ATTR) ?? '';
            const known = seen.get(id);
            if (!known || known.el !== el || playing.get(el)?.animation.playState === 'running') continue;
            seen.set(id, { ...known, rect: el.getBoundingClientRect() });
          }
        });
  onCleanup(() => resized?.disconnect());

  /*
    And as a transition settles — a lane sliding open or shut moves its frames without resizing them,
    so a box read mid-slide was remembered as where the panel rested.
  */
  const settled = () => {
    if (frame !== undefined || typeof document === 'undefined') return;
    for (const el of document.querySelectorAll<HTMLElement>(`[${DOCK_FRAME_ATTR}]`)) {
      const id = el.getAttribute(DOCK_FRAME_ATTR) ?? '';
      const known = seen.get(id);
      if (!known || known.el !== el || playing.get(el)?.animation.playState === 'running') continue;
      seen.set(id, { ...known, rect: el.getBoundingClientRect() });
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('transitionend', settled);
    onCleanup(() => document.removeEventListener('transitionend', settled));
  }

  /*
    What the arrangement is — which panel is where, in which lane and seat, which tab is in front —
    and nothing that changes without it. Only a change to this plays anything: the shell recounts its
    geometry for many reasons (every few seconds, in the app), and a recount that moved nothing must
    not replay a panel from wherever it was last measured.
  */
  let arrangement = '';
  /*
    A change to it not yet played. Owed until a pass is free to play it: a drop writes where the panel
    lands while the drag is still live, and the recount that ends the drag changes nothing further.
  */
  let owed = false;
  const arrangementOf = (geometry: ReturnType<typeof shellStore.dockGeometry>) =>
    JSON.stringify([
      Object.entries(geometry).map(([id, box]) => [
        id,
        box.edge,
        box.snap,
        box.home,
        box.inLane,
        box.hidden,
        box.floating,
        box.maximised,
        box.collapsed,
        box.stowed,
        (box.tabs ?? []).map((tab) => tab.id),
      ]),
      shellStore.laneSections(),
      Object.values(shellStore.edgeLanes().lanes).map((lanes) =>
        lanes.map((lane) => [lane.key, lane.thickness, lane.seats.map((seat) => [seat.key, seat.base, seat.grow])]),
      ),
    ]);

  // The reader's system setting, or the app's own (`data-we-motion`), as the frame's fade-in honours.
  const reduced = () =>
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true ||
      document.documentElement.dataset.weMotion === 'reduced');

  createEffect(() => {
    // Whatever changes the arrangement: every box, which panel is where, how they are framed.
    const geometry = shellStore.dockGeometry();
    shellStore.laneSections();
    shellStore.edgeLanes();
    const resizing = shellStore.dockResizing();
    const moving = shellStore.movingDock();
    if (typeof document === 'undefined') return;
    const now = arrangementOf(geometry);
    if (now !== arrangement) owed = true;
    arrangement = now;
    for (const [id, box] of Object.entries(geometry)) if (box.settling) landing.add(id);

    // After the DOM has the new arrangement laid out — read once, in the frame it is painted.
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const rearranged = owed && !resizing;
      if (!resizing) owed = false;
      const size = `${window.innerWidth}x${window.innerHeight}`;
      const windowResized = size !== viewport;
      viewport = size;

      for (const el of document.querySelectorAll<HTMLElement>(`[${DOCK_FRAME_ATTR}]`)) {
        const id = el.getAttribute(DOCK_FRAME_ATTR) ?? '';
        resized?.observe(el);
        const going = playing.get(el);
        const rect = going?.animation.playState === 'running' ? going.to : el.getBoundingClientRect();
        const before = seen.get(id);
        const box = geometry[id];
        const stowing = Boolean(box?.stowed || box?.layoutWidth || box?.contentsFaded);
        seen.set(id, { el, rect, stowing });
        const landed = landing.delete(id);
        if (
          !rearranged ||
          resizing ||
          windowResized ||
          !before ||
          reduced() ||
          id === moving ||
          stowing ||
          before.stowing
        )
          continue;
        if (rect.width === 0 || rect.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;

        // A frame that stayed over the window eases itself; one that arrived, or is laid out by a lane, does not.
        const arrived = before.el !== el;
        // A panel moving between places is not one opening: no fade-in where it lands (`we-dock-in`).
        if (arrived)
          for (const animation of el.getAnimations())
            if (animation instanceof CSSAnimation && animation.animationName === 'we-dock-in') animation.cancel();
        if (landed) continue;
        if (!arrived && !box?.inLane && !box?.home) continue;

        const dx = before.rect.left - rect.left;
        const dy = before.rect.top - rect.top;
        const sx = before.rect.width / rect.width;
        const sy = before.rect.height / rect.height;
        const still =
          Math.abs(dx) < STILL_PX &&
          Math.abs(dy) < STILL_PX &&
          Math.abs(before.rect.width - rect.width) < STILL_PX &&
          Math.abs(before.rect.height - rect.height) < STILL_PX;
        if (still || !Number.isFinite(sx) || !Number.isFinite(sy) || before.rect.width === 0) continue;

        const animation = el.animate(
          [
            { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
            { transformOrigin: 'top left', transform: 'none' },
          ],
          { duration: MOTION_MS, easing: 'ease' },
        );
        playing.set(el, { animation, to: rect });
      }
      // Forget what is gone, so a panel opened again later does not fly in from where it closed.
      const present = new Set(
        [...document.querySelectorAll(`[${DOCK_FRAME_ATTR}]`)].map((el) => el.getAttribute(DOCK_FRAME_ATTR)),
      );
      for (const id of seen.keys()) if (!present.has(id)) seen.delete(id);
    });
  });

  return null;
}

export default PanelMotion;
