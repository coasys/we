import type { TransitionConfig } from '@we/schema-shared';
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';

import {
  buildTransitionCSS,
  hiddenOpacity,
  hiddenTransform,
  pulseAnimationCSS,
  revealEffect,
  revealTrackProperty,
  scrollRootMargin,
} from './transitionUtils';
import type { RendererOutput, SchemaNode } from './types';

type AnimateRendererProps = {
  node: SchemaNode;
  stores: Record<string, unknown>;
  context: Record<string, unknown>;
  renderNode: (node?: SchemaNode, nodeContext?: Record<string, unknown>) => RendererOutput;
};

/**
 * Renderer for `$animate` schema nodes.
 *
 * The child is always mounted in the DOM — `$animate` never controls DOM presence,
 * only visual state (opacity + transform). Transitions are triggered by:
 *
 *  - `props.scrollReveal` — fire enter transition when element scrolls into viewport
 *  - `props.scrollLeave`  — fire exit transition when element scrolls out of viewport
 *  - `props.scrollPast`   — fire enter/exit transitions keyed to a sentinel element's
 *                           viewport visibility (enter fires when sentinel leaves,
 *                           exit fires when sentinel returns). Use for sticky headers.
 *  - Neither set          — fire enter animation on mount
 *
 * Transition effects are composed as arrays:
 *   enterTransition: [{ type: 'fade', duration: 400 }, { type: 'slide', ... }]
 *
 * For condition-driven mount/unmount animations, use `$if` instead.
 */
export function AnimateRenderer({ node, renderNode }: AnimateRendererProps): RendererOutput {
  const enterTransition = node.props?.enterTransition as TransitionConfig | undefined;
  const exitTransition = node.props?.exitTransition as TransitionConfig | undefined;

  // No animations configured — transparent pass-through
  if (!enterTransition && !exitTransition) {
    return <>{renderNode(node.children?.[0] as SchemaNode | undefined)}</>;
  }

  // Scroll triggers live on the $animate node props, not inside the transition config
  const scrollReveal = node.props?.scrollReveal as true | number | undefined;
  const scrollLeave = node.props?.scrollLeave as true | number | undefined;
  const scrollPast = node.props?.scrollPast as string | undefined;
  const hasSelfScrollTrigger = scrollReveal !== undefined || scrollLeave !== undefined;

  // Start in the hidden state; transitions will reveal / hide the element
  const initOpacity = enterTransition ? hiddenOpacity(enterTransition) : 1;
  const initTransform = enterTransition ? hiddenTransform(enterTransition) : '';

  const [opacity, setOpacity] = createSignal(initOpacity);
  const [transform, setTransform] = createSignal(initTransform);
  const [transitionCSS, setTransitionCSS] = createSignal('');
  /*
    Reveal — the size axis. Same grid technique as `$if`'s (see ConditionalRenderer), and the reason
    it is worth having here too: `$animate` keeps its child mounted, so a section can open and close
    in place without its content — a scroll position, a half-typed field — being destroyed on the
    way. `$if` is the right tool when the content genuinely should not exist while closed.
  */
  const enterReveal = enterTransition ? revealEffect(enterTransition) : undefined;
  const exitReveal = exitTransition ? revealEffect(exitTransition) : undefined;
  const hasReveal = enterReveal ?? exitReveal;
  const [open, setOpen] = createSignal(!enterReveal);
  // 'pulse' is a persistent loop, not a one-shot state transition like fade/slide/scale —
  // it starts once entered and keeps running until exit, rather than settling into a
  // final state. Starts empty (not pulsing) like opacity/transform start hidden — actual
  // triggering (whichever scroll mode, or immediate on mount) happens via animateIn below.
  const [animationCSS, setAnimationCSS] = createSignal('');

  const animateIn = (config: TransitionConfig) => {
    setTransitionCSS(buildTransitionCSS(config));
    setAnimationCSS(pulseAnimationCSS(config) ?? '');
    // Snap to hidden state (in case called after animateOut)
    setOpacity(hiddenOpacity(config));
    setTransform(hiddenTransform(config));
    if (revealEffect(config)) setOpen(false);
    requestAnimationFrame(() => {
      const firstEffect = Array.isArray(config) ? config[0] : config;
      setTimeout(() => {
        setOpacity(1);
        setTransform('');
        setOpen(true);
      }, firstEffect?.delay ?? 0);
    });
  };

  const animateOut = (config: TransitionConfig) => {
    setTransitionCSS(buildTransitionCSS(config));
    setAnimationCSS('');
    const firstEffect = Array.isArray(config) ? config[0] : config;
    setTimeout(() => {
      setOpacity(hiddenOpacity(config));
      setTransform(hiddenTransform(config));
      if (revealEffect(config)) setOpen(false);
    }, firstEffect?.delay ?? 0);
  };

  let wrapperRef: HTMLDivElement | undefined;

  if (scrollPast) {
    // Sentinel-based trigger: observe a separate element by DOM id.
    // enterTransition fires when the sentinel leaves the viewport (user scrolled past it).
    // exitTransition fires when the sentinel returns (user scrolled back up).
    createEffect(() => {
      const sentinel = document.getElementById(scrollPast);
      if (!sentinel) return;

      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry.isIntersecting && enterTransition) {
            animateIn(enterTransition);
          } else if (entry.isIntersecting && exitTransition) {
            animateOut(exitTransition);
          }
        },
        { threshold: 0 },
      );

      observer.observe(sentinel);
      onCleanup(() => observer.disconnect());
    });
  } else if (hasSelfScrollTrigger) {
    // Bidirectional scroll observer — does not disconnect after first intersection
    createEffect(() => {
      if (!wrapperRef) return;

      // Use scrollReveal margin if set, otherwise fall back to scrollLeave margin
      const margin =
        scrollReveal !== undefined
          ? scrollRootMargin(scrollReveal)
          : scrollLeave !== undefined
            ? scrollRootMargin(scrollLeave)
            : '0px';

      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry.isIntersecting && enterTransition) {
            animateIn(enterTransition);
          } else if (!entry.isIntersecting && scrollLeave !== undefined && exitTransition) {
            animateOut(exitTransition);
          }
        },
        { rootMargin: margin, threshold: 0 },
      );

      observer.observe(wrapperRef);
      onCleanup(() => observer.disconnect());
    });
  } else {
    // No scroll trigger: fire enter animation on mount
    createEffect(() => {
      if (enterTransition) animateIn(enterTransition);
    });
  }

  const wrapperStyle = createMemo(() => {
    const style: Record<string, string | number> = {
      opacity: opacity(),
      transition: transitionCSS(),
    };
    const t = transform();
    if (t) style.transform = t;
    const a = animationCSS();
    if (a) style.animation = a;
    if (hasReveal) {
      style.display = 'grid';
      style[revealTrackProperty(hasReveal)] = open() ? '1fr' : '0fr';
    }
    return style;
  });

  // Clip for the reveal. `min-*: 0` overrides a grid item's automatic minimum size, which is its
  // content — without it the track can never go below that and nothing appears to animate.
  const innerStyle = createMemo<Record<string, string> | undefined>(() =>
    hasReveal
      ? { overflow: 'hidden', [(hasReveal.axis ?? 'block') === 'inline' ? 'min-width' : 'min-height']: '0' }
      : undefined,
  );

  return (
    <div ref={wrapperRef} style={wrapperStyle()}>
      <Show when={hasReveal} fallback={renderNode(node.children?.[0] as SchemaNode | undefined)}>
        <div style={innerStyle()}>{renderNode(node.children?.[0] as SchemaNode | undefined)}</div>
      </Show>
    </div>
  );
}
