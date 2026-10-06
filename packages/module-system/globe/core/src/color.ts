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

/**
 * What a theme sets, read to tell whether it has changed: the inputs every colour is computed from —
 * each hue, the saturation, the lightness range and which way the ramp runs — and two roles, which a
 * theme may pin outright. A theme that changes none of these changes no colour a layer can paint.
 */
const THEME_INPUTS = [
  '--we-color-primary-hue',
  '--we-color-success-hue',
  '--we-color-warning-hue',
  '--we-color-danger-hue',
  '--we-color-neutral-hue',
  '--we-color-saturation',
  '--we-color-neutral-saturation',
  '--we-color-lightness-floor',
  '--we-color-lightness-ceiling',
  '--we-color-ramp-direction',
  '--we-color-ramp-offset',
  '--we-role-page',
  '--we-role-accent',
];

export interface ColorResolver {
  /** A colour as a style rule writes it, as four numbers under the theme on screen. */
  rgba(value: string | undefined, fallback?: string): Rgba;
  /**
   * Call `listener` when the theme over the globe changes, so a layer can paint its colours again.
   * Nothing else would tell it: a theme switch changes no layer's options, so no update arrives.
   * Returns the unsubscribe.
   */
  onThemeChange(listener: () => void): () => void;
  /** Stop watching and forget what was resolved. Called when the globe goes. */
  dispose(): void;
}

/**
 * Resolves through the DOM: the value set as a probe's `color`, read back as computed, painted into
 * one canvas pixel. The canvas step is what turns every form a browser may compute (`rgb()`,
 * `oklch()`, `color(srgb …)`) into the same four bytes.
 *
 * A theme is applied by writing variables onto an element above the globe — the document root, or a
 * template's own scope — and by injecting a stylesheet. So the ancestors' `style`, `class` and
 * `data-we-theme` are watched, and the head's stylesheets; on any of those the theme's inputs are
 * read again, and only a change to them clears the cache and tells the layers.
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
  const listeners = new Set<() => void>();

  const themeSignature = () => {
    const computed = getComputedStyle(probe);
    return THEME_INPUTS.map((name) => computed.getPropertyValue(name).trim()).join('|');
  };
  let signature = themeSignature();

  // Checked once a frame however many writes a theme switch makes: one applies dozens of variables.
  let pending = 0;
  const check = () => {
    pending = 0;
    const current = themeSignature();
    if (current === signature) return;
    signature = current;
    cache.clear();
    for (const listener of [...listeners]) listener();
  };
  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(check);
  };

  const observer = new MutationObserver(schedule);
  for (let element: Element | null = host; element; element = element.parentElement) {
    observer.observe(element, { attributes: true, attributeFilter: ['style', 'class', 'data-we-theme'] });
  }
  if (document.head) observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  // The OS switching between light and dark moves a theme that follows it.
  const scheme = document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  scheme?.addEventListener?.('change', schedule);

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
      let rgba = cache.get(css);
      if (!rgba) {
        rgba = paint(css);
        cache.set(css, rgba);
      }
      return rgba;
    },
    onThemeChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      observer.disconnect();
      scheme?.removeEventListener?.('change', schedule);
      if (pending) cancelAnimationFrame(pending);
      listeners.clear();
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
