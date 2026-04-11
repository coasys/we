import type { LocalFieldMeta, LocalStateField, QueryDescriptor, ValidationRule } from '@we/schema-shared';
import {
  hasToken,
  REACTIVE_ACCESSOR,
  resolveProp,
  resolveQueryProp,
  themeToStyle,
  validateField,
} from '@we/schema-shared';
import { batch, createEffect, createMemo, createSignal, For, JSX, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';

import { ConditionalRenderer } from './ConditionalRenderer';
import type { RendererOutput, RenderProps, SchemaNode } from './types';

const MAX_UNWRAP_DEPTH = 10;

/**
 * Recursively unwrap reactive accessors (marked with REACTIVE_ACCESSOR) inside
 * complex prop values so that components receive plain data instead of leaked
 * signal functions. Event handlers and other plain functions pass through
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
    // Don't deconstruct non-plain objects (File, Blob, Date, DOM nodes, etc.)
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = deepUnwrap(v, depth + 1);
    }
    return result;
  }
  return value;
}

/** Check if a prop key is an event handler name (e.g. onClick, onInput, onKeyDown) */
function isEventProp(key: string): boolean {
  return key.length > 2 && key.startsWith('on') && key[2] === key[2].toUpperCase();
}

/**
 * Compose an array of handler values into a single sequential handler.
 * Non-function entries (e.g. undefined from $if without else) are skipped.
 */
function composeHandlers(handlers: unknown[]): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    for (const fn of handlers) {
      if (typeof fn === 'function') fn(...args);
    }
  };
}

/**
 * Create a reactive signal that subscribes to a $query and updates with results.
 * Must be called within a Solid reactive owner (component or createRoot).
 */
function createQuerySignal(
  descriptor: QueryDescriptor,
  stores: unknown,
  getModel: (name: string) => unknown,
): () => unknown[] {
  const [items, setItems] = createSignal<unknown[]>([]);
  const ModelClass = getModel(descriptor.model) as Record<string, (...args: unknown[]) => unknown>;

  createEffect(() => {
    let p: unknown = null;
    if (descriptor.perspectiveStore) {
      const parts = descriptor.perspectiveStore.split('.');
      let target: unknown = stores;
      for (const part of parts) target = (target as Record<string, unknown>)?.[part];
      p = typeof target === 'function' ? (target as () => unknown)() : target;
    } else {
      const perspective = ((stores as Record<string, unknown>).spaceStore as Record<string, unknown> | undefined)
        ?.perspective;
      p = typeof perspective === 'function' ? (perspective as () => unknown)() : null;
    }
    if (!p) {
      setItems([]);
      return;
    }

    if (descriptor.subscribe) {
      const builder = ModelClass.query(p, descriptor.params) as {
        subscribe: (cb: (results: unknown[]) => void) => Promise<unknown[]>;
        dispose: () => void;
      };
      builder.subscribe((results) => setItems(results));
      onCleanup(() => builder.dispose());
    } else {
      (ModelClass.findAll(p, descriptor.params) as Promise<unknown[]>).then(setItems);
    }
  });

  return items;
}

/** Detect values with no schema tokens — can be passed through without reactive tracking. */
function isStaticValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return !value.startsWith('$') || value.length <= 1;
  if (typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.every(isStaticValue);
  return !Object.keys(value).some((k) => k.startsWith('$')) && Object.values(value).every(isStaticValue);
}

export function RenderSchema({ node, stores, registry, context = {}, children }: RenderProps): RendererOutput {
  if (!node) return null;

  // Create local state signals when $localState is declared on this node
  let effectiveContext = context;
  if (node.$localState) {
    const accessors: Record<string, () => unknown> = {};
    const setters: Record<string, (v: unknown) => void> = {};
    const metaEntries: Record<string, LocalFieldMeta> = {};
    const scopeFields: string[] = [];

    for (const [name, field] of Object.entries(node.$localState as Record<string, LocalStateField>)) {
      const [get, set] = createSignal(field.initial);
      accessors[name] = get;
      setters[name] = set;
      scopeFields.push(name);

      const [touched, setTouched] = createSignal(false);
      const rules: ValidationRule[] = field.validate ?? [];

      // Derived memo: evaluate validation rules against current value.
      // For cross-field rules (match), reads other field accessors — Solid tracks these automatically.
      const errors = createMemo(() => {
        const val = get();
        return validateField(val, rules, (otherField) => {
          // Look up in merged accessors (parent + current scope)
          const parentLocal = (context.$local as Record<string, () => unknown>) ?? {};
          const accessor = accessors[otherField] ?? parentLocal[otherField];
          return accessor ? accessor() : undefined;
        });
      });

      const initial = field.initial;
      metaEntries[name] = {
        initial,
        rules,
        touched,
        setTouched,
        errors,
        reset: () => {
          set(initial as never);
          setTouched(false);
        },
      };
    }

    effectiveContext = {
      ...context,
      $local: { ...((context.$local as Record<string, unknown>) ?? {}), ...accessors },
      $localSetters: { ...((context.$localSetters as Record<string, unknown>) ?? {}), ...setters },
      $localMeta: { ...((context.$localMeta as Record<string, unknown>) ?? {}), ...metaEntries },
      $localScopeFields: scopeFields,
    };
  }

  function renderNode(node?: SchemaNode, nodeContext?: Record<string, unknown>) {
    return (
      <RenderSchema
        node={node ?? null}
        stores={stores}
        registry={registry}
        context={nodeContext ?? effectiveContext}
        children={children}
      />
    );
  }

  function renderChildren(nodes: SchemaNode['children']): RendererOutput {
    if (!nodes) return undefined;
    return (
      <For each={nodes} fallback={null}>
        {(child) => {
          // If the child is a string, check for $-prefixed context references
          if (typeof child === 'string') {
            if (child.startsWith('$') && child.length > 1) {
              const resolved = resolveProp(child, stores, effectiveContext, createMemo);
              return (
                <>
                  {() => {
                    const v =
                      typeof resolved === 'function' && REACTIVE_ACCESSOR in resolved
                        ? (resolved as unknown as () => unknown)()
                        : resolved;
                    return v != null ? String(v) : '';
                  }}
                </>
              );
            }
            return child;
          }
          // Resolve operator tokens ($concat, $store, etc.) placed directly in children.
          // Schema nodes (have `type` or `children`) are NOT operator tokens even when
          // they carry $-prefixed keys like $localState.
          if (
            child &&
            typeof child === 'object' &&
            !('type' in child) &&
            !('children' in child) &&
            Object.keys(child).some((k) => k.startsWith('$'))
          ) {
            // $if in children with component then/else → use ConditionalRenderer
            // Only use ConditionalRenderer when then/else are SchemaNode objects;
            // when they're primitives (strings, numbers), fall through to resolveProp.
            if ('$if' in child) {
              const ifSpec = (child as Record<string, unknown>).$if as Record<string, unknown>;
              const thenVal = ifSpec.then;
              const elseVal = ifSpec.else;
              const thenIsNode = thenVal && typeof thenVal === 'object' && 'type' in thenVal;
              const elseIsNode = elseVal && typeof elseVal === 'object' && 'type' in elseVal;
              if (thenIsNode || elseIsNode) {
                const condNode: SchemaNode = { type: '$if', props: ifSpec } as SchemaNode;
                return (
                  <ConditionalRenderer
                    node={condNode}
                    stores={stores}
                    context={effectiveContext}
                    renderNode={renderNode}
                  />
                );
              }
            }
            const resolved = resolveProp(child as unknown, stores, effectiveContext, createMemo);
            return (
              <>
                {() => {
                  const v =
                    typeof resolved === 'function' && REACTIVE_ACCESSOR in resolved
                      ? (resolved as unknown as () => unknown)()
                      : resolved;
                  return v != null ? String(v) : '';
                }}
              </>
            );
          }
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
      return (
        <div style={style} data-we-theme={node.theme.themeName}>
          {fragment}
        </div>
      );
    }
    return fragment;
  }

  // Render routed children at $routes token
  if (node.type === '$routes') return children ?? null;

  // Handle conditional rendering
  if (node.type === '$if') {
    return <ConditionalRenderer node={node} stores={stores} context={effectiveContext} renderNode={renderNode} />;
  }

  // Handle each loops
  if (node.type === '$each') {
    // Get the schema used to render each item
    const itemSchema = node.children?.[0] as SchemaNode | undefined;

    // Resolve the items used for iteration — $query needs a reactive subscription,
    // everything else goes through the standard resolveProp path.
    let itemsArray: () => unknown[];

    const rawItems = node.props?.items;
    if (hasToken(rawItems, '$query', 'object')) {
      const descriptor = resolveQueryProp(rawItems);
      const getModel = (stores as Record<string, unknown>).$getModel as ((name: string) => unknown) | undefined;
      if (!getModel) {
        console.warn('Schema $query: $getModel not found in stores. Did you wire the model registry?');
        itemsArray = () => [];
      } else {
        itemsArray = createQuerySignal(descriptor, stores, getModel);
      }
    } else {
      const resolvedItems = resolveProp(rawItems, stores, effectiveContext, createMemo);
      itemsArray = createMemo(() => {
        const items = typeof resolvedItems === 'function' ? resolvedItems() : resolvedItems;
        return Array.isArray(items) ? items : [];
      });
    }

    // Return a list of the rendered items
    return (
      <For each={itemsArray()}>
        {(item) => renderNode(itemSchema, { ...effectiveContext, [String(node.props?.as ?? 'item')]: item })}
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
  // isolating its reactive dependencies. Static props still read from
  // the store reactively so that updateSchema mutations are tracked.
  // resolveProp is called INSIDE the memo so that plain-value resolvers
  // ($not, $eq, $ne, $and, $or) correctly track signal dependencies.
  const propMemos: Record<string, () => unknown> = {};
  for (const [key, rawValue] of Object.entries(node.props ?? {})) {
    if (isStaticValue(rawValue)) {
      // Read from the store node so Solid tracks changes from updateSchema.
      const k = key;
      propMemos[key] = createMemo(() => (node.props as Record<string, unknown>)?.[k]);
    } else if (hasToken(rawValue, '$query', 'object')) {
      // $query: set up reactive subscription via createSignal + createEffect
      // instead of createMemo — subscriptions are side effects, not derivations.
      const descriptor = resolveQueryProp(rawValue);
      const getModel = (stores as Record<string, unknown>).$getModel as ((name: string) => unknown) | undefined;
      if (!getModel) {
        console.warn('Schema $query: $getModel not found in stores. Did you wire the model registry?');
        propMemos[key] = () => [];
      } else {
        propMemos[key] = createQuerySignal(descriptor, stores, getModel);
      }
    } else {
      const raw = rawValue;
      propMemos[key] = createMemo(() => {
        const resolved = resolveProp(raw, stores, effectiveContext, createMemo);
        return deepUnwrap(resolved);
      });
    }
  }

  const slotProp = node.slot ? { slot: node.slot } : {};
  const themeStyle = createMemo(() => (node.theme ? { display: 'contents', ...themeToStyle(node.theme) } : undefined));
  const themeAttr = createMemo(() => node.theme?.themeName);

  // Render: web components use per-prop property effects, Solid/HTML use reactive spread
  if (isWebComponent) {
    // All props delivered via per-prop effects (DOM property assignment).
    // Event handlers stay in the JSX spread so Solid's event delegation works correctly.
    let hostRef: (HTMLElement & Record<string, unknown>) | undefined;

    for (const [key, memo] of Object.entries(propMemos)) {
      if (isEventProp(key)) continue;
      createEffect(() => {
        if (hostRef) hostRef[key] = memo();
      });
    }

    // Track dynamically added props for web components
    createEffect(() => {
      const currentProps = node.props as Record<string, unknown> | undefined;
      if (!currentProps || !hostRef) return;
      for (const key of Object.keys(currentProps)) {
        if (!(key in propMemos) && !isEventProp(key)) {
          hostRef[key] = currentProps[key];
        }
      }
    });

    const eventAttrs = createMemo(() => {
      const attrs: Record<string, unknown> = {};
      for (const [key, memo] of Object.entries(propMemos)) {
        if (isEventProp(key)) {
          const val = memo();
          attrs[key] = Array.isArray(val) ? composeHandlers(val) : val;
        }
      }
      return attrs;
    });

    const wcElement = (
      <Dynamic ref={hostRef} component={component()} {...eventAttrs()} {...slotProp} {...slotElements}>
        {renderChildren(node.children)}
      </Dynamic>
    );

    return (
      <div style={themeStyle() ?? { display: 'contents' }} data-we-theme={themeAttr()}>
        {wcElement}
      </div>
    );
  }

  // Solid components / HTML elements: all props via reactive spread (standard Solid pattern)
  const reactiveAttrs = createMemo(() => {
    const attrs: Record<string, unknown> = {};
    for (const [key, memo] of Object.entries(propMemos)) {
      const val = memo();
      attrs[key] = isEventProp(key) && Array.isArray(val) ? composeHandlers(val) : val;
    }
    // Pick up props added dynamically via updateSchema that had no memo at mount time
    const currentProps = node.props as Record<string, unknown> | undefined;
    if (currentProps) {
      for (const key of Object.keys(currentProps)) {
        if (!(key in propMemos)) {
          attrs[key] = currentProps[key];
        }
      }
    }
    return attrs;
  });

  const solidElement = (
    <Dynamic component={component()} {...reactiveAttrs()} {...slotProp} {...slotElements}>
      {renderChildren(node.children)}
    </Dynamic>
  );

  return (
    <div style={themeStyle() ?? { display: 'contents' }} data-we-theme={themeAttr()}>
      {solidElement}
    </div>
  );
}
