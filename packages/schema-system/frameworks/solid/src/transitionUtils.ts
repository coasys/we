import type { TransitionConfig, TransitionEffect } from '@we/schema-shared';

function toEffects(config: TransitionConfig): TransitionEffect[] {
  return Array.isArray(config) ? config : [config];
}

function hiddenTransformForEffect(effect: TransitionEffect): string {
  if (effect.type === 'slide') {
    const dist = effect.distance ?? '40px';
    const dir = effect.direction ?? 'up';
    if (dir === 'left') return `translateX(-${dist})`;
    if (dir === 'right') return `translateX(${dist})`;
    if (dir === 'up') return `translateY(-${dist})`;
    if (dir === 'down') return `translateY(${dist})`;
  }
  if (effect.type === 'scale') {
    const scale = effect.distance ?? '0.95';
    return `scale(${scale})`;
  }
  return '';
}

/**
 * CSS transform for the hidden state — derived from any slide/scale effects in the config.
 * Returns '' if the config has no slide/scale effects.
 */
export function hiddenTransform(config: TransitionConfig): string {
  return toEffects(config).reduce<string>((acc, e) => acc || hiddenTransformForEffect(e), '');
}

/**
 * Hidden opacity — 0 only if the config includes a 'fade' effect, otherwise 1.
 * With the composable model, 'slide' and 'scale' do not implicitly animate opacity.
 */
export function hiddenOpacity(config: TransitionConfig): number {
  return toEffects(config).some((e) => e.type === 'fade') ? 0 : 1;
}

/**
 * CSS transition shorthand string for the given config.
 * Each effect maps to its own CSS property with independent timing:
 *   - 'fade'  → opacity
 *   - 'slide' → transform
 *   - 'scale' → transform
 */
export function buildTransitionCSS(config: TransitionConfig): string {
  const parts: string[] = [];
  for (const effect of toEffects(config)) {
    const duration = effect.duration ?? 300;
    const easing = effect.easing ?? 'ease';
    if (effect.type === 'fade') {
      parts.push(`opacity ${duration}ms ${easing}`);
    } else if (effect.type === 'slide' || effect.type === 'scale') {
      parts.push(`transform ${duration}ms ${easing}`);
    }
  }
  return parts.join(', ');
}

/**
 * CSS `animation` shorthand for a config's 'pulse' effect, or undefined if it has none.
 * References the `we-pulse` @keyframes rule defined in the DS interop stylesheet
 * (app-framework's dsInterop.ts) — this only builds the property value, the keyframes
 * themselves live in that shared, always-loaded stylesheet.
 */
export function pulseAnimationCSS(config: TransitionConfig): string | undefined {
  const effect = toEffects(config).find((e) => e.type === 'pulse');
  if (!effect) return undefined;
  const duration = effect.duration ?? 1200;
  const easing = effect.easing ?? 'ease-in-out';
  return `we-pulse ${duration}ms ${easing} infinite`;
}

/**
 * IntersectionObserver rootMargin derived from a scroll offset value.
 * true  → fire at the natural viewport boundary (0px margin)
 * +n    → fire n px before the element reaches the viewport
 * -n    → fire n px after the element has entered the viewport
 */
export function scrollRootMargin(offset: true | number): string {
  return offset === true ? '0px' : `0px 0px ${offset}px 0px`;
}
