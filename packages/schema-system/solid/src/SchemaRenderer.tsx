import { batch, createEffect, createMemo, createSignal, For, JSX, onCleanup, Show } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';

import { resolveProp, resolveProps, splitProps } from '../../shared/propResolvers';
import type { TransitionConfig } from '../../shared/types';
import type { RendererOutput, RenderProps, SchemaNode } from './types';

export function RenderSchema({ node, stores, registry, context = {}, children }: RenderProps): RendererOutput {
  if (!node) return null;

  function renderNode(node?: SchemaNode, nodeContext?: Record<string, unknown>) {
    return (
      <RenderSchema
        node={node ?? null}
        stores={stores}
        registry={registry}
        context={nodeContext ?? context}
        children={children}
      />
    );
  }

  function renderChildren(nodes: (SchemaNode | string)[] | undefined): RendererOutput {
    if (!nodes) return undefined;
    return (
      <For each={nodes} fallback={null}>
        {(child) => {
          // If the child is a string (i.e when passing text to <we-text>), return it directly
          if (typeof child === 'string') return child;
          // Otherwise render the child node
          return renderNode(child as SchemaNode);
        }}
      </For>
    );
  }

  // If no type is provided, render children in a JSX fragment
  if (!node.type) return <>{renderChildren(node.children)}</>;

  // Render routed children at $routes token
  if (node.type === '$routes') return children ?? null;

  // Handle conditional rendering
  if (node.type === '$if') {
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

    const transitionCSS = exitTransition
      ? getTransitionCSS(exitTransition)
      : enterTransition
        ? getTransitionCSS(enterTransition)
        : '';

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
        transition: transitionCSS,
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

      // For everything else (non-overlay, non-positioned), use layout-neutral wrapper
      style.display = 'contents';
      return style;
    });

    return (
      <Show when={shouldRender()} fallback={renderNode(node.props?.else as SchemaNode | undefined)}>
        <div style={wrapperStyle()}>{renderNode(contentNode)}</div>
      </Show>
    );
  }

  // Handle for-each loops
  if (node.type === '$forEach') {
    // Get the schema used to render each item
    const itemSchema = node.children?.[0] as SchemaNode | undefined;

    // Resolve the items used for iteration
    const resolvedItems = resolveProp(node.props?.items, stores, context, createMemo);
    const itemsArray = createMemo(() => {
      const items = typeof resolvedItems === 'function' ? resolvedItems() : resolvedItems;
      return Array.isArray(items) ? items : [];
    });

    // Return a list of the rendered items
    return (
      <For each={itemsArray()}>
        {(item) => renderNode(itemSchema, { ...context, [String(node.props?.as ?? 'item')]: item })}
      </For>
    );
  }

  // Get the component from the registry
  const component = createMemo(() => registry[node.type ?? '']);
  if (!component()) throw new Error(`Schema node has unknown type "${node.type}".`);

  // Prepare the slot elements in a reactive store
  const [slotElements, setSlotElements] = createStore<Record<string, JSX.Element>>(
    Object.fromEntries(Object.entries(node.slots ?? {}).map(([key, slot]) => [key, renderNode(slot)])),
  );

  // Watch for added or removed slots via their keys and update the store (otherwise Solid won't track them)
  let previousSlotKeys = Object.keys(node.slots ?? {});
  createEffect(() => {
    if (node.slots) {
      // Track changes to slot keys
      const newSlotKeys = Object.keys(node.slots);

      // Update changed slots in a single batch
      batch(() => {
        setSlotElements(
          produce((draft) => {
            // Remove slots that no longer exist
            for (const oldKey of previousSlotKeys) {
              if (!newSlotKeys.includes(oldKey)) delete draft[oldKey];
            }
            // Add new slots
            for (const newKey of newSlotKeys) {
              if (!previousSlotKeys.includes(newKey)) draft[newKey] = renderNode((node.slots ?? {})[newKey]);
            }
          }),
        );
      });

      // Store the new slot keys for the next comparison
      previousSlotKeys = newSlotKeys;
    }
  });

  // Split resolved props into safe and complex props
  let hostRef: (HTMLElement & Record<string, unknown>) | undefined;
  const split = createMemo(() => splitProps(resolveProps(node.props, stores, context, createMemo)));

  // Design system props that need special handling for web components (camelCase properties)
  const designSystemCamelCaseProps = new Set([
    'zIndex',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'pointerEvents',
  ]);

  // Handle safe props with reactivity
  const isWebComponent = node.type?.startsWith('we-');
  const reactiveAttrs = createMemo(() => {
    const attrs: Record<string, unknown> = {};
    const { safeProps, complexProps } = split();

    // For Solid components, include complex props directly
    if (!isWebComponent) {
      Object.assign(attrs, complexProps);
    }

    for (const [k, v] of Object.entries(safeProps)) {
      const isSignal = typeof v === 'function' && v.name.includes('readSignal');

      // Skip design system camelCase props for web components - they'll be set as properties instead
      if (isWebComponent && designSystemCamelCaseProps.has(k)) {
        continue;
      }

      // Unwrap signal accessors for web components
      if (isWebComponent && isSignal) attrs[k] = v();
      // Pass through for Solid components, event handlers, and all other values
      else attrs[k] = v;
    }
    return attrs;
  });

  // Handle complex props AND design system camelCase props with reactivity (web components only)
  createEffect(() => {
    if (!hostRef || !isWebComponent) return;
    const { safeProps, complexProps } = split();

    // Set complex props as properties
    for (const [k, v] of Object.entries(complexProps)) {
      // Unwrap signal accessors for web components
      const isSignal = typeof v === 'function' && v.name.includes('readSignal');
      hostRef[k] = isWebComponent && isSignal ? v() : v;
    }

    // Set design system camelCase props as properties (not attributes)
    for (const [k, v] of Object.entries(safeProps)) {
      if (designSystemCamelCaseProps.has(k)) {
        const isSignal = typeof v === 'function' && v.name.includes('readSignal');
        hostRef[k] = isWebComponent && isSignal ? v() : v;
      }
    }
  });

  const slotProp = node.slot ? { slot: node.slot } : {};

  // Return the component with merged props, slots, and children
  return (
    <Dynamic ref={hostRef} component={component()} {...reactiveAttrs()} {...slotProp} {...slotElements}>
      {renderChildren(node.children)}
    </Dynamic>
  );
}
