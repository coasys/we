/**
 * Colours as an engine paints them: four numbers.
 *
 * A style rule resolves to CSS — a role, a scale position, a `color-mix()` between two of them — and
 * neither engine can paint CSS. Cesium wants a `Color`, deck.gl an `[r, g, b, a]`. So the value is
 * handed to the browser, which is the only thing that knows what `var(--we-role-accent)` is under the
 * theme on screen, and read back as a pixel.
 *
 * Probed inside the globe's own element rather than the document, because a space's theme can be
 * scoped to the template: the same role is a different colour there than in the app's chrome.
 */
import { colorValueCss } from '@we/design-utils';

/** Red, green, blue and alpha, each 0–1. */
export type Rgba = readonly [number, number, number, number];

const TRANSPARENT: Rgba = [0, 0, 0, 0];

/** Variables whose values change when the theme does, read to know when the cache is stale. */
const THEME_PROBES = ['--we-role-page', '--we-role-accent', '--we-color-primary-500', '--we-color-neutral-500'];

export interface ColorResolver {
  /** A colour as a style rule writes it, as four numbers under the theme on screen. */
  rgba(value: string | undefined, fallback?: string): Rgba;
  /** Forget what was resolved. Called when the globe goes. */
  dispose(): void;
}

/**
 * Resolves through the DOM: the value set as a probe's `color`, read back as computed, painted into
 * one canvas pixel. The canvas step is what turns every form a browser may compute (`rgb()`,
 * `oklch()`, `color(srgb …)`) into the same four bytes.
 */
export function createColorResolver(host: HTMLElement): ColorResolver {
  const document = host.ownerDocument;
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.appendChild(probe);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  const cache = new Map<string, Rgba>();
  let signature = '';
  let checkedAt = -Infinity;

  const themeSignature = () => {
    const computed = getComputedStyle(probe);
    return THEME_PROBES.map((name) => computed.getPropertyValue(name)).join('|');
  };

  const paint = (css: string): Rgba => {
    probe.style.color = '';
    probe.style.color = css;
    // Unset means the browser refused the value; say so rather than painting the inherited colour.
    if (!probe.style.color || !context) return TRANSPARENT;
    const computed = getComputedStyle(probe).color;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = computed;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255, a / 255];
  };

  return {
    rgba(value, fallback = 'primary-500') {
      const css = colorValueCss(value, fallback);
      if (!css) return TRANSPARENT;
      // Checked at most once per batch: a layer of five thousand pins resolves its colours in one go,
      // and reading the theme for each would cost more than the colours.
      const now = performance.now();
      if (now - checkedAt > 100) {
        checkedAt = now;
        const current = themeSignature();
        if (current !== signature) {
          cache.clear();
          signature = current;
        }
      }
      let rgba = cache.get(css);
      if (!rgba) {
        rgba = paint(css);
        cache.set(css, rgba);
      }
      return rgba;
    },
    dispose() {
      probe.remove();
      cache.clear();
    },
  };
}

/** `opacity` applied to a colour's own alpha, which a `color-mix` or an `rgba()` may already carry. */
export function withOpacity(rgba: Rgba, opacity: number | undefined): Rgba {
  if (opacity === undefined) return rgba;
  return [rgba[0], rgba[1], rgba[2], rgba[3] * Math.min(1, Math.max(0, opacity))];
}
