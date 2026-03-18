import { DESIGN_SYSTEM_CAMEL_CASE_PROPS } from '@we/design-types';
import { REACTIVE_ACCESSOR, resolveProp, resolveProps, splitProps } from '@we/schema-shared';
import { batch, createEffect, createMemo, For, JSX } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';

import { ConditionalRenderer } from './ConditionalRenderer';
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
    return <ConditionalRenderer node={node} stores={stores} context={context} renderNode={renderNode} />;
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

  // Resolve component: registry entry > native HTML element (lowercase) > error
  // Convention: PascalCase = registry component, we-* = web component, lowercase = HTML element
  const isHtmlElement = /^[a-z][a-z0-9]*$/.test(node.type ?? '');
  const component = createMemo(() => registry[node.type ?? ''] ?? (isHtmlElement ? node.type : undefined));
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
  const designSystemCamelCaseProps = DESIGN_SYSTEM_CAMEL_CASE_PROPS;

  // Handle safe props with reactivity
  const isWebComponent = node.type?.startsWith('we-');
  const needsPropertyHandling = isWebComponent; // Only web components need ref-based property setting
  const reactiveAttrs = createMemo(() => {
    const attrs: Record<string, unknown> = {};
    const { safeProps, complexProps } = split();

    // For Solid components and HTML elements, include complex props directly
    if (!isWebComponent) {
      Object.assign(attrs, complexProps);
    }

    for (const [k, v] of Object.entries(safeProps)) {
      const isReactiveAccessor = typeof v === 'function' && REACTIVE_ACCESSOR in v;

      // Skip design system camelCase props for web components - they'll be set as properties instead
      if (isWebComponent && designSystemCamelCaseProps.has(k)) {
        continue;
      }

      // Unwrap reactive accessors for web components
      if (isWebComponent && isReactiveAccessor) attrs[k] = v();
      // Pass through for Solid components, event handlers, and all other values
      else attrs[k] = v;
    }
    return attrs;
  });

  // Handle complex props AND design system camelCase props with reactivity (web components only)
  createEffect(() => {
    if (!hostRef || !needsPropertyHandling) return;
    const { safeProps, complexProps } = split();

    // Set complex props as properties
    for (const [k, v] of Object.entries(complexProps)) {
      // Unwrap reactive accessors for web components
      const isReactiveAccessor = typeof v === 'function' && REACTIVE_ACCESSOR in v;
      hostRef[k] = isWebComponent && isReactiveAccessor ? v() : v;
    }

    // Set design system camelCase props as properties (not attributes)
    for (const [k, v] of Object.entries(safeProps)) {
      if (designSystemCamelCaseProps.has(k)) {
        const isReactiveAccessor = typeof v === 'function' && REACTIVE_ACCESSOR in v;
        hostRef[k] = isWebComponent && isReactiveAccessor ? v() : v;
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
