import { mountOverlay, POPOVER_RESETS } from './topLayer';

/**
 * How thick the drop line is, in pixels.
 *
 * Named because the geometry depends on it twice — the line's own size, and the half of it the line
 * is offset by to sit centred on the edge it marks — and the two drifting apart is invisible until
 * somebody looks closely at where a drop would land.
 *
 * One number, in one place, because this drifted: the same line was 4px `primary-400` in the block
 * editor and 2px `primary-500` in the sortable, from two unrelated pieces of code.
 */
export const DROP_LINE_THICKNESS = 4;

export interface DropLine {
  el: HTMLElement;
  /** Draw it across this box, in client coordinates. */
  place(box: { left: number; top: number; width: number; height: number }): void;
  hide(): void;
  destroy(): void;
}

/** The line marking where a drop would land. */
export function createDropLine(): DropLine {
  const el = document.createElement('div');
  el.setAttribute('data-we-drop-line', '');
  el.style.cssText = [
    `position:fixed`,
    `pointer-events:none`,
    `z-index:9998`,
    `background:var(--we-role-accent,#3b82f6)`,
    `border-radius:2px`,
    `opacity:0`,
    ...POPOVER_RESETS,
  ].join(';');
  mountOverlay(el);

  return {
    el,
    place(box) {
      Object.assign(el.style, {
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        opacity: '1',
      });
    },
    hide() {
      el.style.opacity = '0';
    },
    destroy() {
      el.remove();
    },
  };
}
