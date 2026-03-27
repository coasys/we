import { REACTIVE_ACCESSOR, resolveProp, themeToStyle } from '@we/schema-shared';
import { batch, createEffect, createMemo, For, JSX } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';

import { ConditionalRenderer } from './ConditionalRenderer';
import type { RendererOutput, RenderProps, SchemaNode } from './types';

const MAX_UNWRAP_DEPTH = 10;

/**
 * Recursively unwrap reactive accessors (marked with REACTIVE_ACCESSOR) inside
 * complex prop values so that components receive plain data instead of leaked
 * signal functions.  Event handlers and other plain functions pass through
 * untouched.
 *
 * Called inside tracked computations (createMemo / createEffect), so calling
 * accessors here registers them as dependencies — reactivity is preserved
 * without wrapping each value in its own memo.
 */
function deepUnwrap(value: unknown, depth = 0): unknown {
  if (depth > MAX_UNWRAP_DEPTH) return value;
  if (typeof value === 'function' && REACTIVE_ACCESSOR in value) {
    return deepUnwrap((value as unknown as () => unknown)(), depth + 1);
  }
  if (typeof value === 'function') return value;
  if (Array.isArray(value)) {
    return value.map((item) => deepUnwrap(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = deepUnwrap(v, depth + 1);
    }
    return result;
  }
  return value;
}

/** Detect values with no schema tokens — can be passed through without reactive tracking. */
function isStaticValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.every(isStaticValue);
  return !Object.keys(value).some((k) => k.startsWith('$')) && Object.values(value).every(isStaticValue);
}

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

  // If no type is provided, render children in a JSX fragment (with optional theme wrapper)
  if (!node.type) {
    const fragment = <>{renderChildren(node.children)}</>;
    if (node.theme) {
      const style = { display: 'contents' as const, ...themeToStyle(node.theme) };
      return <div style={style}>{fragment}</div>;
    }
    return fragment;
  }

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

  // Resolve component: registry entry > native HTML/custom element > error
  // Convention: PascalCase = registry component, hyphenated = web component, lowercase = HTML element
  const isHtmlElement = /^[a-z][a-z0-9]*$/.test(node.type ?? '');
  const isWebComponent = node.type?.includes('-') ?? false;
  const component = createMemo(
    () => registry[node.type ?? ''] ?? (isHtmlElement || isWebComponent ? node.type : undefined),
  );
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

  // --- Per-prop resolution (fine-grained reactivity) ---
  // Create per-prop memos — each prop resolves independently,
  // isolating its reactive dependencies. Static props bypass resolution entirely.
  // resolveProp is called INSIDE the memo so that plain-value resolvers
  // ($not, $eq, $ne, $and, $or) correctly track signal dependencies.
  const propMemos: Record<string, () => unknown> = {};
  for (const [key, rawValue] of Object.entries(node.props ?? {})) {
    if (isStaticValue(rawValue)) {
      const value = rawValue;
      propMemos[key] = () => value;
    } else {
      const raw = rawValue;
      propMemos[key] = createMemo(() => {
        const resolved = resolveProp(raw, stores, context, createMemo);
        if (typeof resolved === 'function' && REACTIVE_ACCESSOR in resolved) {
          // Web components can't call accessors — eagerly unwrap
          if (isWebComponent) {
            return deepUnwrap((resolved as unknown as () => unknown)());
          }
          // Solid components: pass accessor through — component calls it in its own reactive scope
          return resolved;
        }
        return deepUnwrap(resolved);
      });
    }
  }

  const slotProp = node.slot ? { slot: node.slot } : {};
  const themeStyle = node.theme ? { display: 'contents', ...themeToStyle(node.theme) } : undefined;

  // Render: web components use per-prop property effects, Solid/HTML use reactive spread
  if (isWebComponent) {
    // All props delivered via per-prop effects (DOM property assignment).
    // Event handlers stay in the JSX spread so Solid's event delegation works correctly.
    let hostRef: (HTMLElement & Record<string, unknown>) | undefined;

    for (const [key, memo] of Object.entries(propMemos)) {
      if (key.length > 2 && key.startsWith('on') && key[2] === key[2].toUpperCase()) continue;
      createEffect(() => {
        if (hostRef) hostRef[key] = memo();
      });
    }

    const eventAttrs = createMemo(() => {
      const attrs: Record<string, unknown> = {};
      for (const [key, memo] of Object.entries(propMemos)) {
        if (key.length > 2 && key.startsWith('on') && key[2] === key[2].toUpperCase()) {
          attrs[key] = memo();
        }
      }
      return attrs;
    });

    const wcElement = (
      <Dynamic ref={hostRef} component={component()} {...eventAttrs()} {...slotProp} {...slotElements}>
        {renderChildren(node.children)}
      </Dynamic>
    );

    return themeStyle ? <div style={themeStyle}>{wcElement}</div> : wcElement;
  }

  // Solid components / HTML elements: all props via reactive spread (standard Solid pattern)
  const reactiveAttrs = createMemo(() => {
    const attrs: Record<string, unknown> = {};
    for (const [key, memo] of Object.entries(propMemos)) {
      attrs[key] = memo();
    }
    return attrs;
  });

  const solidElement = (
    <Dynamic component={component()} {...reactiveAttrs()} {...slotProp} {...slotElements}>
      {renderChildren(node.children)}
    </Dynamic>
  );

  return themeStyle ? <div style={themeStyle}>{solidElement}</div> : solidElement;
}
