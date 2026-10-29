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
 * Not while a drag or a resize is live (the frame must follow the hand, and the one being dragged is
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
  let viewport = '';
  let frame: number | undefined;
  onCleanup(() => frame !== undefined && cancelAnimationFrame(frame));

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

    // After the DOM has the new arrangement laid out — read once, in the frame it is painted.
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const size = `${window.innerWidth}x${window.innerHeight}`;
      const resized = size !== viewport;
      viewport = size;

      for (const el of document.querySelectorAll<HTMLElement>(`[${DOCK_FRAME_ATTR}]`)) {
        const id = el.getAttribute(DOCK_FRAME_ATTR) ?? '';
        const rect = el.getBoundingClientRect();
        const before = seen.get(id);
        const box = geometry[id];
        const stowing = Boolean(box?.stowed || box?.layoutWidth || box?.contentsFaded);
        seen.set(id, { el, rect, stowing });
        if (resizing || resized || !before || reduced() || id === moving || stowing || before.stowing) continue;
        if (rect.width === 0 || rect.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;

        // A frame that stayed over the window eases itself; one that arrived, or is laid out by a lane, does not.
        const arrived = before.el !== el;
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

        // A panel travelling is not one arriving: no fade-in where it lands (`we-dock-in`), only the move.
        if (arrived)
          for (const animation of el.getAnimations())
            if (animation instanceof CSSAnimation && animation.animationName === 'we-dock-in') animation.cancel();
        el.animate(
          [
            { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
            { transformOrigin: 'top left', transform: 'none' },
          ],
          { duration: MOTION_MS, easing: 'ease' },
        );
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
