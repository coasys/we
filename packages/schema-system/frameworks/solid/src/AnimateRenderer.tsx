import type { TransitionConfig } from '@we/schema-shared';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

import { buildTransitionCSS, hiddenOpacity, hiddenTransform, scrollRootMargin } from './transitionUtils';
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
  const hasScrollTrigger = scrollReveal !== undefined || scrollLeave !== undefined;

  // Start in the hidden state; transitions will reveal / hide the element
  const initOpacity = enterTransition ? hiddenOpacity(enterTransition) : 1;
  const initTransform = enterTransition ? hiddenTransform(enterTransition) : '';

  const [opacity, setOpacity] = createSignal(initOpacity);
  const [transform, setTransform] = createSignal(initTransform);
  const [transitionCSS, setTransitionCSS] = createSignal('');

  const animateIn = (config: TransitionConfig) => {
    setTransitionCSS(buildTransitionCSS(config));
    // Snap to hidden state (in case called after animateOut)
    setOpacity(hiddenOpacity(config));
    setTransform(hiddenTransform(config));
    requestAnimationFrame(() => {
      const firstEffect = Array.isArray(config) ? config[0] : config;
      setTimeout(() => {
        setOpacity(1);
        setTransform('');
      }, firstEffect?.delay ?? 0);
    });
  };

  const animateOut = (config: TransitionConfig) => {
    setTransitionCSS(buildTransitionCSS(config));
    const firstEffect = Array.isArray(config) ? config[0] : config;
    setTimeout(() => {
      setOpacity(hiddenOpacity(config));
      setTransform(hiddenTransform(config));
    }, firstEffect?.delay ?? 0);
  };

  let wrapperRef: HTMLDivElement | undefined;

  if (hasScrollTrigger) {
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
    return style;
  });

  return (
    <div ref={wrapperRef} style={wrapperStyle()}>
      {renderNode(node.children?.[0] as SchemaNode | undefined)}
    </div>
  );
}
