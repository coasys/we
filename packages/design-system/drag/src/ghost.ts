import { mountOverlay, POPOVER_RESETS } from './topLayer';
import type { GhostSpec } from './types';

/** What the caller holds while a drag is in flight. */
export interface Ghost {
  el: HTMLElement;
  /** Put the ghost's top-left corner here, in client coordinates. */
  moveTo(left: number, top: number): void;
  destroy(): void;
}

/**
 * The thing that follows the pointer.
 *
 * One implementation, in the top layer, from design tokens. Before this there were two, and they
 * did not look alike: a cloned card with a hand-written box shadow in one place, and in the other
 * the browser's default drag image — which is the element the gesture began on, so dragging a
 * paragraph showed a dots icon.
 */
export function createGhost(spec: GhostSpec): Ghost {
  const el = spec.kind === 'clone' ? cloneGhost(spec.source, spec.rect) : chipGhost(spec.label, spec.icon, spec.count);
  mountOverlay(el);
  return {
    el,
    moveTo(left, top) {
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    },
    destroy() {
      el.remove();
    },
  };
}

/** A copy of what is being moved, at the size it already has. For a reorder. */
function cloneGhost(source: HTMLElement, rect: DOMRect): HTMLElement {
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.style.cssText = [
    `position:fixed`,
    `left:${rect.left}px`,
    `top:${rect.top}px`,
    `width:${rect.width}px`,
    `height:${rect.height}px`,
    `pointer-events:none`,
    `opacity:0.85`,
    `z-index:9999`,
    `box-shadow:0 4px 16px color-mix(in srgb, var(--we-role-shadow-color) 20%, transparent)`,
    `border-radius:6px`,
    `margin:0`,
    // Transparent rather than unset: the UA's own `[popover]` background would otherwise paint an
    // opaque card behind the clone once it is promoted.
    `background:transparent`,
    ...POPOVER_RESETS,
  ].join(';');
  return ghost;
}

/**
 * Icon, label, and a count when several things are held.
 *
 * Built from the payload rather than cloned, which is what makes it work at all for a card holding
 * an image or a block input: `cloneNode(true)` does not copy shadow roots, so a clone of one of
 * those is an empty box.
 */
function chipGhost(label: string, icon: string | undefined, count: number | undefined): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-we-drag-ghost', '');
  el.style.cssText = [
    `position:fixed`,
    `left:0`,
    `top:0`,
    `display:flex`,
    `align-items:center`,
    `gap:var(--we-space-200,6px)`,
    `max-width:280px`,
    `padding:var(--we-space-200,6px) var(--we-space-300,10px)`,
    `pointer-events:none`,
    `z-index:9999`,
    `font-size:var(--we-font-size-200,14px)`,
    `line-height:1.2`,
    `white-space:nowrap`,
    `background:var(--we-role-surface-raised,#fff)`,
    `color:var(--we-role-text,#111)`,
    `border-radius:var(--we-radius-300,8px)`,
    `box-shadow:0 4px 16px color-mix(in srgb, var(--we-role-shadow-color) 25%, transparent)`,
    // The border is what stops the chip disappearing into a surface of the same colour, which is
    // the common case: it is dragged over cards.
    `outline:1px solid var(--we-role-border,#e5e5e5)`,
    ...POPOVER_RESETS,
  ].join(';');

  if (icon) {
    const glyph = document.createElement('we-icon');
    glyph.setAttribute('name', icon);
    glyph.setAttribute('size', 'sm');
    el.appendChild(glyph);
  }

  const text = document.createElement('span');
  text.textContent = label || 'Item';
  text.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
  el.appendChild(text);

  if (count && count > 1) {
    const badge = document.createElement('span');
    badge.textContent = String(count);
    badge.style.cssText = [
      `flex:0 0 auto`,
      `min-width:1.4em`,
      `text-align:center`,
      `padding:0 var(--we-space-100,4px)`,
      `border-radius:var(--we-radius-pill,999px)`,
      `background:var(--we-role-accent,#3b82f6)`,
      `color:var(--we-role-on-accent,#fff)`,
      `font-size:var(--we-font-size-100,12px)`,
    ].join(';');
    el.appendChild(badge);
  }

  return el;
}
