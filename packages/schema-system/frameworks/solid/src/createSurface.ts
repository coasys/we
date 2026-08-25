import { readTier, SURFACE_ATTR, SURFACE_TIER_ATTR, tierSentinelStyles } from '@we/schema-shared';
import { onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';

/** What a template reads off `$surface`. */
export interface SurfaceState {
  /** Content-box inline size in px — the same box the container query evaluated. */
  width: number;
  /** `base` | `sm` | `md` | `lg`, as decided by CSS. */
  tier: string;
}

export interface Surface {
  /** A Solid store — pass it straight into a render context as the `$surface` value. */
  surface: SurfaceState;
  /** `ref` for the element that declares the container. */
  outerRef: (el: HTMLElement) => void;
  /** `ref` for the tier sentinel. */
  tierRef: (el: HTMLElement) => void;
  /** Spread onto the surface element, alongside `surfaceStyles()`. */
  outerAttrs: Record<string, string>;
  /** Spread onto a bare `div` placed inside the surface — carries its own geometry. */
  tierAttrs: Record<string, unknown>;
}

/**
 * The measuring half of a surface, separated from any particular markup.
 *
 * Two places need it and they have different shapes: the `$surface` node renders its own box, while
 * the host's own surfaces are existing elements that already carry a background, a theme attribute
 * and a ref of their own — wrapping those to make them measurable would add a layout box for no
 * reason and put the scroll container in the wrong place. So the pieces are handed out separately
 * and each caller attaches them to what it already has.
 *
 * See `@we/design-utils`' surface module for why there is a sentinel and why the tier is read from
 * CSS rather than computed here.
 */
export function createSurface(): Surface {
  const [surface, setSurface] = createStore<SurfaceState>({ width: 0, tier: 'base' });
  let tierEl: HTMLElement | undefined;

  return {
    surface,
    outerRef: (el: HTMLElement) => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver((entries) => {
        const box = entries[0]?.contentBoxSize?.[0];
        const width = box ? box.inlineSize : el.clientWidth;
        const tier = readTier(tierEl);
        // Guarded, because a resize fires far more often than a tier changes: a panel being dragged
        // would otherwise invalidate every memo that read this store on every frame.
        if (surface.width !== width || surface.tier !== tier) setSurface({ width, tier });
      });
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    },
    tierRef: (el: HTMLElement) => {
      tierEl = el;
    },
    outerAttrs: { [SURFACE_ATTR]: '' },
    tierAttrs: { [SURFACE_TIER_ATTR]: '', 'aria-hidden': 'true', style: tierSentinelStyles() },
  };
}
