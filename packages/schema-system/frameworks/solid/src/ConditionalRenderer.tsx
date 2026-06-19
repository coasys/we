import type { TransitionConfig } from '@we/schema-shared';
import { resolveProp } from '@we/schema-shared';
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';

import { buildTransitionCSS, hiddenOpacity, hiddenTransform } from './transitionUtils';
import type { RendererOutput, SchemaNode } from './types';

type ConditionalRendererProps = {
  node: SchemaNode;
  stores: Record<string, unknown>;
  context: Record<string, unknown>;
  renderNode: (node?: SchemaNode, nodeContext?: Record<string, unknown>) => RendererOutput;
};

export function ConditionalRenderer({ node, stores, context, renderNode }: ConditionalRendererProps): RendererOutput {
  const enterTransition = node.props?.enterTransition as TransitionConfig | undefined;
  const exitTransition = node.props?.exitTransition as TransitionConfig | undefined;
  const hasTransitions = enterTransition || exitTransition;

  const conditionMet = createMemo(() => {
    const condition = resolveProp(node.props?.condition, stores, context, createMemo);
    return typeof condition === 'function' ? condition() : condition;
  });

  // If no transitions, use standard Show component
  if (!hasTransitions) {
    return (
      <Show when={conditionMet()} fallback={renderNode(node.props?.else as SchemaNode | undefined)}>
        {renderNode(node.props?.then as SchemaNode | undefined)}
      </Show>
    );
  }

  const effectiveCondition = createMemo(() => !!conditionMet());

  const startVisible = effectiveCondition();
  const initialHiddenTransform = enterTransition ? hiddenTransform(enterTransition) : '';
  const initialHiddenOpacity = enterTransition ? hiddenOpacity(enterTransition) : 0;

  const [isVisible, setIsVisible] = createSignal(startVisible);
  const [shouldRender, setShouldRender] = createSignal(startVisible);
  const [opacity, setOpacity] = createSignal(startVisible ? 1 : initialHiddenOpacity);
  const [transform, setTransform] = createSignal(startVisible ? '' : initialHiddenTransform);

  // Mutable timer refs — must live outside createEffect so they can be cancelled
  // when the condition reverses mid-transition. onCleanup inside setTimeout is a
  // no-op (not in a reactive context), so we cancel manually on enter and unmount.
  let exitTimerOuter: ReturnType<typeof setTimeout> | undefined;
  let exitTimerInner: ReturnType<typeof setTimeout> | undefined;

  const cancelExitTimers = () => {
    clearTimeout(exitTimerOuter);
    clearTimeout(exitTimerInner);
    exitTimerOuter = undefined;
    exitTimerInner = undefined;
  };

  onCleanup(cancelExitTimers);

  // ── Condition change → animate in / out ──────────────────────────────────────
  createEffect(() => {
    const newCondition = effectiveCondition();

    if (newCondition && !isVisible()) {
      cancelExitTimers(); // cancel any in-progress exit before re-entering
      setShouldRender(true);
      setIsVisible(true);

      if (enterTransition) {
        setOpacity(hiddenOpacity(enterTransition));
        setTransform(hiddenTransform(enterTransition));
        requestAnimationFrame(() => {
          const firstEffect = Array.isArray(enterTransition) ? enterTransition[0] : enterTransition;
          setTimeout(() => {
            setOpacity(1);
            setTransform('');
          }, firstEffect?.delay ?? 0);
        });
      } else {
        setOpacity(1);
        setTransform('');
      }
    } else if (!newCondition && isVisible()) {
      setIsVisible(false);

      if (exitTransition) {
        const firstEffect = Array.isArray(exitTransition) ? exitTransition[0] : exitTransition;
        const duration = firstEffect?.duration ?? 300;
        const delay = firstEffect?.delay ?? 0;

        exitTimerOuter = setTimeout(() => {
          setOpacity(hiddenOpacity(exitTransition));
          setTransform(hiddenTransform(exitTransition));

          exitTimerInner = setTimeout(() => setShouldRender(false), duration);
        }, delay);
      } else {
        setShouldRender(false);
        setOpacity(initialHiddenOpacity);
        setTransform(initialHiddenTransform);
      }
    }
  });

  // ── CSS transition string ─────────────────────────────────────────────────────
  const transitionCSS = createMemo(() => {
    const current = isVisible();
    const config = current ? (enterTransition ?? exitTransition) : (exitTransition ?? enterTransition);
    return config ? buildTransitionCSS(config) : '';
  });

  // ── Overlay / positioning helpers (unchanged) ─────────────────────────────────
  const isOverlayComponent = (tagName: string): boolean => {
    if (!tagName?.startsWith('we-')) return false;
    const ComponentClass = customElements.get(tagName);
    if (!ComponentClass) return false;
    return 'isOverlay' in ComponentClass && ComponentClass.isOverlay === true;
  };

  const contentNode = node.props?.then as SchemaNode | undefined;
  const contentProps = contentNode?.props || {};
  const contentType = String(contentNode?.type || '');
  const isOverlay = isOverlayComponent(contentType);
  const hasPosition = contentProps.position;
  const hasZIndex = contentProps['z-index'] || contentProps.zIndex;

  // ── Wrapper style ─────────────────────────────────────────────────────────────
  const wrapperStyle = createMemo(() => {
    const style: Record<string, string | number> = {
      opacity: opacity(),
      transition: transitionCSS(),
      // The wrapper is a pure animation container — never capture pointer events.
      // The content inside handles its own interactions.
      'pointer-events': 'none',
    };

    const t = transform();
    if (t) style.transform = t;

    if (isOverlay) {
      if (hasZIndex) style['z-index'] = String(contentProps['z-index'] || contentProps.zIndex);
      return style;
    }

    if (hasPosition || hasZIndex) {
      style.position = String(contentProps.position || 'relative');
      if (hasZIndex) style['z-index'] = String(contentProps['z-index'] || contentProps.zIndex);
      style.width = '100%';
      style.height = '100%';
      return style;
    }

    return style;
  });

  return (
    <Show when={shouldRender()} fallback={renderNode(node.props?.else as SchemaNode | undefined)}>
      <div style={wrapperStyle()}>
        <div style={{ 'pointer-events': 'auto' }}>{renderNode(contentNode)}</div>
      </div>
    </Show>
  );
}
