import type { TransitionConfig } from '@we/schema-shared';
import { resolveProp } from '@we/schema-shared';
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';

import type { RendererOutput, SchemaNode } from './types';

type ConditionalRendererProps = {
  node: SchemaNode;
  stores: Record<string, unknown>;
  context: Record<string, unknown>;
  renderNode: (node?: SchemaNode, nodeContext?: Record<string, unknown>) => RendererOutput;
};

export function ConditionalRenderer({ node, stores, context, renderNode }: ConditionalRendererProps): RendererOutput {
  // Get transition configs from props (can be dynamic via prop resolution)
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

  // With transitions, we need to manage opacity and delayed unmounting
  const [isVisible, setIsVisible] = createSignal(conditionMet());
  const [shouldRender, setShouldRender] = createSignal(conditionMet());
  const [opacity, setOpacity] = createSignal(conditionMet() ? 1 : 0);

  // Watch for condition changes and handle transitions
  createEffect(() => {
    const newCondition = conditionMet();

    if (newCondition && !isVisible()) {
      // Condition became true - mount and fade in
      setShouldRender(true);
      setIsVisible(true);

      if (enterTransition) {
        // Start with opacity 0, then fade in on next frame
        setOpacity(0);
        requestAnimationFrame(() => {
          setTimeout(() => setOpacity(1), enterTransition.delay ?? 0);
        });
      } else {
        setOpacity(1);
      }
    } else if (!newCondition && isVisible()) {
      // Condition became false - fade out then unmount
      setIsVisible(false);

      if (exitTransition) {
        const duration = exitTransition.duration ?? 300;
        const delay = exitTransition.delay ?? 0;

        setTimeout(() => {
          setOpacity(0);

          // Unmount after transition completes
          const timer = setTimeout(() => {
            setShouldRender(false);
          }, duration);

          onCleanup(() => clearTimeout(timer));
        }, delay);
      } else {
        setShouldRender(false);
        setOpacity(0);
      }
    }
  });

  // Build transition CSS based on config
  const getTransitionCSS = (config: TransitionConfig | undefined): string => {
    if (!config) return '';
    const duration = config.duration ?? 300;
    const easing = config.easing ?? 'ease';
    return `opacity ${duration}ms ${easing}`;
  };

  const transitionCSS = createMemo(() => {
    const current = isVisible();
    if (current && enterTransition) return getTransitionCSS(enterTransition);
    if (!current && exitTransition) return getTransitionCSS(exitTransition);
    // Fallback: use whichever config exists
    return getTransitionCSS(exitTransition ?? enterTransition);
  });

  // Helper to check if a web component extends OverlayElement
  // Uses static property marker since class names get minified in production
  const isOverlayComponent = (tagName: string): boolean => {
    if (!tagName?.startsWith('we-')) return false;

    const ComponentClass = customElements.get(tagName);
    if (!ComponentClass) return false;

    // Check for static isOverlay marker property (minification-safe)
    return 'isOverlay' in ComponentClass && ComponentClass.isOverlay === true;
  };

  // Get content node to check for positioning props
  const contentNode = node.props?.then as SchemaNode | undefined;
  const contentProps = contentNode?.props || {};
  const contentType = String(contentNode?.type || '');

  // Check if content is a self-positioning overlay component
  const isOverlay = isOverlayComponent(contentType);

  // Check if content has position or z-index props
  const hasPosition = contentProps.position;
  const hasZIndex = contentProps['z-index'] || contentProps.zIndex;

  // Build wrapper style - use a memo to make it reactive
  const wrapperStyle = createMemo(() => {
    const style: Record<string, string | number> = {
      opacity: opacity(),
      transition: transitionCSS(),
    };

    // If content is an overlay component, don't interfere with its positioning
    // But copy z-index to wrapper for proper stacking during transitions
    if (isOverlay) {
      // Copy z-index from overlay if present (for proper stacking during fade)
      if (hasZIndex) {
        const zIndexValue = String(contentProps['z-index'] || contentProps.zIndex);
        style['z-index'] = zIndexValue;
      }
      // Let overlay handle its own positioning, wrapper just manages opacity & z-index
      return style;
    }

    // If content has position or z-index, copy them to wrapper to maintain stacking behavior
    if (hasPosition || hasZIndex) {
      // Copy position (default to relative if only z-index is set)
      const positionValue = String(contentProps.position || 'relative');
      style.position = positionValue;

      // Copy z-index (normalize from both camelCase and kebab-case)
      if (hasZIndex) {
        const zIndexValue = String(contentProps['z-index'] || contentProps.zIndex);
        style['z-index'] = zIndexValue;
      }

      // Make wrapper fill available space to not disrupt layout
      style.width = '100%';
      style.height = '100%';
      return style;
    }

    // For everything else (non-overlay, non-positioned), use layout-neutral wrapper.
    // Note: display:contents removes the box from the tree and breaks CSS transitions.
    // A plain div participates in flex/grid layouts as an item and supports opacity transitions.
    return style;
  });

  return (
    <Show when={shouldRender()} fallback={renderNode(node.props?.else as SchemaNode | undefined)}>
      <div style={wrapperStyle()}>{renderNode(contentNode)}</div>
    </Show>
  );
}
