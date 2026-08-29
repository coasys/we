import { mountOverlay, POPOVER_RESETS } from './topLayer';
import type { GhostRenderer, GhostSpec } from './types';

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
let renderer: GhostRenderer | null = null;

/**
 * Register the host's card renderer, for `node` ghosts. Returns the unregistration.
 *
 * One at a time, and the last one wins — there is one drag session per window, so there is one
 * answer to "what does a record look like here". A host registers it once at start-up.
 *
 * Kept beside the chip rather than replacing it: this package has to work with no host, since the
 * sortable and the editor both drive it directly, and a package that could not draw its own ghost
 * would be one more thing every consumer had to wire up before anything worked.
 */
export function setGhostRenderer(fn: GhostRenderer | null): () => void {
  renderer = fn;
  return () => {
    if (renderer === fn) renderer = null;
  };
}

export function createGhost(spec: GhostSpec): Ghost {
  const el = buildGhost(spec);
  mountOverlay(el);
  let disposed = false;
  return {
    el,
    moveTo(left, top) {
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      // A rendered ghost may own a framework root; the renderer hangs its teardown here so this
      // needs no knowledge of which framework drew it.
      (el as HTMLElement & { _weDispose?: () => void })._weDispose?.();
      el.remove();
    },
  };
}

function buildGhost(spec: GhostSpec): HTMLElement {
  if (spec.kind === 'clone') return cloneGhost(spec.source, spec.rect);
  if (spec.kind === 'node') {
    const drawn = renderer?.(spec.items) ?? null;
    if (drawn) return positionGhost(drawn);
    // Declined, or no host — the payload always carries a label, so there is always a chip.
    const [first] = spec.items;
    return chipGhost(first?.label ?? 'Item', first?.icon, spec.items.length);
  }
  return chipGhost(spec.label, spec.icon, spec.count);
}

/**
 * The parts of a ghost that are the session's business rather than the renderer's: where it sits,
 * that it cannot be pointed at, and that the UA's `[popover]` chrome does not paint behind it.
 *
 * Applied after the renderer so a host cannot accidentally take the pointer with its own card.
 */
function positionGhost(el: HTMLElement): HTMLElement {
  el.setAttribute('data-we-drag-ghost', '');
  for (const rule of [
    'position:fixed',
    'left:0',
    'top:0',
    'pointer-events:none',
    'z-index:9999',
    /*
      The UA paints `[popover]` on an opaque `canvas` background, and this element is promoted to
      the top layer to clear modals. Without this a rendered card sits on a filled rectangle, which
      shows at every corner the card rounds off — the "darker square behind the edges".

      `cloneGhost` has always carried the same line for the same reason; the chip paints its own
      background so it never noticed.
    */
    'background:transparent',
    ...POPOVER_RESETS,
  ]) {
    const at = rule.indexOf(':');
    el.style.setProperty(rule.slice(0, at), rule.slice(at + 1));
  }
  return el;
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
