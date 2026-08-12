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
 * The 'reveal' effect in a config, if it has one.
 *
 * Only the first counts. Two reveals would be two conflicting values for one grid track, and
 * silently honouring whichever came last is worse than the author noticing nothing happened.
 */
export function revealEffect(config: TransitionConfig): TransitionEffect | undefined {
  return toEffects(config).find((e) => e.type === 'reveal');
}

/**
 * Which grid track a reveal animates.
 *
 * The technique: the animating element is a grid whose single track goes `0fr` → `1fr`, and the
 * content inside it is clipped. `1fr` on a single-track grid resolves to the content's natural
 * size, so this eases to `auto` — the thing a plain `height` transition famously cannot do.
 *
 * The alternative, a `max-height` guessed high enough to clear the content, is wrong in a way that
 * is easy to miss: the easing curve is applied to the guess rather than to the real height, so most
 * of the duration is spent traversing space that isn't there, and the whole thing breaks silently
 * the day some content exceeds the guess. (`interpolate-size: allow-keywords` will eventually make
 * `height: auto` animate directly, but it is not cross-browser baseline yet.)
 */
export function revealTrackProperty(effect: TransitionEffect): 'grid-template-rows' | 'grid-template-columns' {
  return effect.axis === 'inline' ? 'grid-template-columns' : 'grid-template-rows';
}

/**
 * CSS transition shorthand string for the given config.
 * Each effect maps to its own CSS property with independent timing:
 *   - 'fade'   → opacity
 *   - 'slide'  → transform
 *   - 'scale'  → transform
 *   - 'reveal' → grid-template-rows / -columns
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
    } else if (effect.type === 'reveal') {
      parts.push(`${revealTrackProperty(effect)} ${duration}ms ${easing}`);
    }
  }
  return parts.join(', ');
}

/**
 * How long a config takes to finish, in ms — the **longest** effect, not the first one.
 *
 * Used to decide when an exiting node may unmount. Reading it off the first effect (which is what
 * this replaced) meant `[{ fade, 200 }, { slide, 700 }]` tore the element out of the DOM 200ms in,
 * cutting the slide at under a third of its length. Composition is the whole point of the array
 * form, so the array has to be what decides.
 */
export function transitionSpan(config: TransitionConfig): number {
  return toEffects(config).reduce((longest, e) => Math.max(longest, e.duration ?? 300), 0);
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
