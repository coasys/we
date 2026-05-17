import type { LocalFieldMeta, LocalStateField, MapProp, QueryDescriptor, ValidationRule } from '@we/schema-shared';
import {
  hasToken,
  REACTIVE_ACCESSOR,
  resolveProp,
  resolveQueryProp,
  themeToStyle,
  validateField,
} from '@we/schema-shared';
import { batch, createEffect, createMemo, createSignal, For, JSX, onCleanup, Show } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
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
 * Recursively scan a raw prop value for { $map: { items: { $query: ... } } } patterns.
 * For each found, create a reactive query signal and substitute it in place.
 * This "hoists" signal creation to component-init time (before any createMemo/createEffect),
 * ensuring the subscription lifecycle is managed correctly even when the $map+$query is
 * nested inside a complex structure like planetLayers[0].options.locations.
 *
 * Must be called during component setup, not inside a createMemo or createEffect.
 */
function hoistMapQuerySignals(value: unknown, stores: unknown, getModel: (name: string) => unknown): unknown {
  if (!value || typeof value !== 'object') return value;

  // Found $map with $query items — replace items with a live reactive signal
  if (hasToken(value, '$map', 'object')) {
    const mapSpec = (value as { $map: MapProp }).$map;
    if (hasToken(mapSpec.items, '$query', 'object')) {
      const descriptor = resolveQueryProp(mapSpec.items);
      const signal = createQuerySignal(descriptor, stores, getModel);
      return { $map: { ...mapSpec, items: signal } };
    }
    return value;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item) => {
      const h = hoistMapQuerySignals(item, stores, getModel);
      if (h !== item) changed = true;
      return h;
    });
    return changed ? mapped : value;
  }

  // Plain object — recurse into all values
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const h = hoistMapQuerySignals(v, stores, getModel);
    result[k] = h;
    if (h !== v) changed = true;
  }
  return changed ? result : value;
}

/**
 * Deep-walk query params and evaluate any $store/$local tokens to their current values.
 * Scoped to descriptor.params only — never touches the broader schema tree.
 * Must be called inside a Solid createEffect so that signal reads register as
 * reactive dependencies automatically, triggering re-runs when store values change.
 */
function deepResolveTokens(
  params: unknown,
  stores: Record<string, unknown>,
  context: Record<string, unknown>,
): unknown {
  if (params === null || params === undefined) return params;
  if (typeof params !== 'object') return params;
  if (Array.isArray(params)) return params.map((item) => deepResolveTokens(item, stores, context));

  const obj = params as Record<string, unknown>;
  const hasTokenKey = Object.keys(obj).some((k) => k.startsWith('$'));
  if (hasTokenKey) {
    const resolved = resolveProp(obj, stores, context);
    // Unwrap reactive accessors — calling them here registers deps in the enclosing createEffect
    if (typeof resolved === 'function' && REACTIVE_ACCESSOR in (resolved as object)) {
      return (resolved as () => unknown)();
    }
    return resolved;
  }

  // Plain object — recurse into values
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = deepResolveTokens(v, stores, context);
  }
  return result;
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
  context: Record<string, unknown> = {},
): () => unknown[] {
  const [items, setItems] = createStore<unknown[]>([]);
  const readItems = () => items;
  const getModelForPerspective = (stores as Record<string, unknown>).$getModelForPerspective as
    | ((name: string, uuid?: string) => unknown)
    | undefined;

  createEffect(() => {
    let p: unknown = null;
    if (descriptor.perspective) {
      const parts = descriptor.perspective.split('.');
      let target: unknown = stores;
      for (const part of parts) target = (target as Record<string, unknown>)?.[part];
      p = typeof target === 'function' ? (target as () => unknown)() : target;
    } else {
      const currentPerspective = ((stores as Record<string, unknown>).adamStore as Record<string, unknown> | undefined)
        ?.currentPerspective;
      p = typeof currentPerspective === 'function' ? (currentPerspective as () => unknown)() : null;
    }
    if (!p) {
      setItems(reconcile([]));
      return;
    }

    // UUID-aware model lookup: prefer perspective-specific dynamic model, fall back to global registry
    const perspectiveUuid = (p as Record<string, unknown>).uuid as string | undefined;
    const dynamicCls = getModelForPerspective ? getModelForPerspective(descriptor.model, perspectiveUuid) : undefined;
    let ModelClass: Record<string, (...args: unknown[]) => unknown>;
    try {
      ModelClass = (dynamicCls ?? getModel(descriptor.model)) as Record<string, (...args: unknown[]) => unknown>;
    } catch {
      const onError = (stores as Record<string, unknown>).$onError as ((msg: string) => void) | undefined;
      onError?.(`Model "${descriptor.model}" is not available in this perspective`);
      setItems(reconcile([]));
      return;
    }

    const resolvedParams = deepResolveTokens(descriptor.params, stores as Record<string, unknown>, context) as Record<
      string,
      unknown
    >;
    const resolvedInclude =
      descriptor.include !== undefined
        ? (deepResolveTokens(descriptor.include, stores as Record<string, unknown>, context) as Record<
            string,
            boolean | Record<string, unknown>
          >)
        : undefined;
    const queryOptions = {
      ...resolvedParams,
      ...(resolvedInclude !== undefined && { include: resolvedInclude }),
    };

    // AD4M model instances expose `id` as a prototype getter, not an own enumerable
    // property, so Solid's reconcile({ key: 'id' }) cannot find it for keyed diffing.
    // Without normalisation, every subscription update destroys and recreates all
    // <For> entries (reconcile treats them as new), causing visible DOM flashes.
    const normalise = (results: unknown[]): unknown[] =>
      results.map((r) => {
        const rec = r as Record<string, unknown>;
        return { id: rec.id, ...rec };
      });

    if (descriptor.subscribe) {
      const builder = ModelClass.query(p, queryOptions) as {
        subscribe: (cb: (results: unknown[]) => void) => Promise<unknown[]>;
        dispose: () => void;
      };
      builder
        .subscribe((results) => {
          setItems(reconcile(normalise(results), { key: 'id', merge: true }));
        })
        .then((initial) => {
          setItems(reconcile(normalise(initial), { key: 'id', merge: true }));
        });
      onCleanup(() => builder.dispose());
    } else {
      (ModelClass.findAll(p, queryOptions) as Promise<unknown[]>).then((results) => {
        setItems(reconcile(normalise(results), { key: 'id', merge: true }));
      });
    }
  });

  return readItems;
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
      const [get, set] = createSignal<unknown>(field.initial);
      accessors[name] = get;
      // Function-type fields: Solid treats setter(fn) as a functional update (calls fn(prev)).
      // Wrap the setter so that storing a function value works correctly.
      setters[name] = field.type === 'function' ? (v) => set(() => v as never) : (set as (v: unknown) => void);
      scopeFields.push(name);

      const [touched, setTouched] = createSignal(false);
      const rules: ValidationRule[] = field.validate ?? [];

      // Derived memo: evaluate validation rules against current value.
      // For cross-field rules (match), reads other field accessors — Solid tracks these automatically.
      const errors = createMemo(() => {
        const val = get();
        return validateField(val, rules, (otherField: string) => {
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
              return (
                <>
                  {() => {
                    // Call resolveProp INSIDE the reactive expression so that plain
                    // context property reads (e.g. '$profile.bio' → item.bio on a
                    // Solid store proxy) are tracked as fine-grained dependencies.
                    const resolved = resolveProp(child, stores, effectiveContext, createMemo);
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
        itemsArray = createQuerySignal(descriptor, stores, getModel, effectiveContext);
      }
    } else {
      itemsArray = createMemo(() => {
        // Read from store proxy INSIDE the memo so Solid tracks mutations from updateSchema/patching
        const currentItems = (node.props as Record<string, unknown>)?.items;
        const resolvedItems = resolveProp(currentItems, stores, effectiveContext, createMemo);
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

  // Handle singleton query rendering — like $each but for exactly one item.
  // Uses a dedicated createStore<Record<string,unknown>> for the item so subscription
  // updates mutate the store proxy in-place (fine-grained reactivity) rather than
  // replacing an array element, which avoids DOM destruction and preserves focus.
  // Acts as a scope provider: all children are rendered with the resolved item in scope.
  if (node.type === '$single') {
    const asKey = String(node.props?.as ?? 'item');
    const [hasItem, setHasItem] = createSignal(false);
    const [item, setItem] = createStore<Record<string, unknown>>({});

    const rawItems = node.props?.item;
    if (hasToken(rawItems, '$query', 'object')) {
      const descriptor = resolveQueryProp(rawItems);
      const getModelFn = (stores as Record<string, unknown>).$getModel as ((name: string) => unknown) | undefined;
      const getModelForPerspective = (stores as Record<string, unknown>).$getModelForPerspective as
        | ((name: string, uuid?: string) => unknown)
        | undefined;

      if (!getModelFn) {
        console.warn('Schema $single: $getModel not found in stores. Did you wire the model registry?');
      } else {
        createEffect(() => {
          let p: unknown = null;
          if (descriptor.perspective) {
            const parts = descriptor.perspective.split('.');
            let target: unknown = stores;
            for (const part of parts) target = (target as Record<string, unknown>)?.[part];
            p = typeof target === 'function' ? (target as () => unknown)() : target;
          } else {
            const cp = ((stores as Record<string, unknown>).adamStore as Record<string, unknown> | undefined)
              ?.currentPerspective;
            p = typeof cp === 'function' ? (cp as () => unknown)() : null;
          }
          if (!p) {
            setHasItem(false);
            return;
          }

          const perspectiveUuid = (p as Record<string, unknown>).uuid as string | undefined;
          const dynamicCls = getModelForPerspective
            ? getModelForPerspective(descriptor.model, perspectiveUuid)
            : undefined;
          let ModelClass: Record<string, (...args: unknown[]) => unknown>;
          try {
            ModelClass = (dynamicCls ?? getModelFn(descriptor.model)) as Record<
              string,
              (...args: unknown[]) => unknown
            >;
          } catch {
            const onError = (stores as Record<string, unknown>).$onError as ((msg: string) => void) | undefined;
            onError?.(`Model "${descriptor.model}" is not available in this perspective`);
            setHasItem(false);
            return;
          }

          const resolvedParams = deepResolveTokens(
            descriptor.params,
            stores as Record<string, unknown>,
            effectiveContext,
          ) as Record<string, unknown>;
          const resolvedInclude =
            descriptor.include !== undefined
              ? (deepResolveTokens(descriptor.include, stores as Record<string, unknown>, effectiveContext) as Record<
                  string,
                  boolean | Record<string, unknown>
                >)
              : undefined;
          const queryOptions = {
            ...resolvedParams,
            ...(resolvedInclude !== undefined && { include: resolvedInclude }),
          };

          const handleResults = (results: unknown[]) => {
            if (results.length === 0) {
              setHasItem(false);
            } else {
              const r0 = results[0] as Record<string, unknown>;
              // AD4M model instances expose `id` as a prototype getter, not an own enumerable
              // property, so plain spread / Object.keys misses it. Explicitly read it first
              // so the store proxy has a stable id for $profile.id action args.
              const plain: Record<string, unknown> = { id: r0.id, ...r0 };
              setItem(reconcile(plain, { merge: true }));
              setHasItem(true);
            }
          };

          if (descriptor.subscribe) {
            const builder = ModelClass.query(p, queryOptions) as {
              subscribe: (cb: (results: unknown[]) => void) => Promise<unknown[]>;
              dispose: () => void;
            };
            builder.subscribe(handleResults).then(handleResults);
            onCleanup(() => builder.dispose());
          } else {
            (ModelClass.findAll(p, queryOptions) as Promise<unknown[]>).then(handleResults);
          }
        });
      }
    }

    const childContext = { ...effectiveContext, [asKey]: item };
    return (
      <Show when={hasItem()}>
        <For each={node.children as SchemaNode[]}>{(child) => renderNode(child, childContext)}</For>
      </Show>
    );
  }

  // Resolve component: registry entry > native HTML/custom element > error
  // Convention: PascalCase = registry component, hyphenated = web component, lowercase = HTML element
  const component = createMemo(() => {
    const t = node.type ?? '';
    // $-prefixed types ($routes, $if, $each) are handled by early returns above.
    // During reactive updates (node.type changed via store mutation), guard here
    // so Dynamic never receives an invalid tag name like "$routes".
    if (t.startsWith('$')) return undefined;
    const isHtml = /^[a-z][a-z0-9]*$/.test(t);
    const isWc = t.includes('-');
    return registry[t] ?? (isHtml || isWc ? t : undefined);
  });
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
      // If the value transitions from static to token (e.g. via AI patching),
      // resolve it through the full prop pipeline instead of returning the raw token.
      const k = key;
      propMemos[key] = createMemo(() => {
        const current = (node.props as Record<string, unknown>)?.[k];
        if (!isStaticValue(current)) {
          return deepUnwrap(resolveProp(current, stores, effectiveContext, createMemo));
        }
        return current;
      });
    } else if (hasToken(rawValue, '$query', 'object')) {
      // $query: set up reactive subscription via createSignal + createEffect
      // instead of createMemo — subscriptions are side effects, not derivations.
      const descriptor = resolveQueryProp(rawValue);
      const getModel = (stores as Record<string, unknown>).$getModel as ((name: string) => unknown) | undefined;
      if (!getModel) {
        console.warn('Schema $query: $getModel not found in stores. Did you wire the model registry?');
        propMemos[key] = () => [];
      } else {
        propMemos[key] = createQuerySignal(descriptor, stores, getModel, effectiveContext);
      }
    } else if (
      hasToken(rawValue, '$map', 'object') &&
      hasToken((rawValue as { $map: MapProp }).$map.items, '$query', 'object')
    ) {
      // $map with $query items: wire a reactive subscription for the items source,
      // then pass the live signal into resolveMapProp so it re-maps on every update.
      const mapSpec = (rawValue as { $map: MapProp }).$map;
      const descriptor = resolveQueryProp(mapSpec.items);
      const getModel = (stores as Record<string, unknown>).$getModel as ((name: string) => unknown) | undefined;
      if (!getModel) {
        console.warn('Schema $query: $getModel not found in stores. Did you wire the model registry?');
        propMemos[key] = () => [];
      } else {
        const itemsSignal = createQuerySignal(descriptor, stores, getModel, effectiveContext);
        propMemos[key] = createMemo(() =>
          deepUnwrap(resolveProp({ $map: { ...mapSpec, items: itemsSignal } }, stores, effectiveContext, createMemo)),
        );
      }
    } else {
      const getModel = (stores as Record<string, unknown>).$getModel as ((name: string) => unknown) | undefined;
      const raw = getModel ? hoistMapQuerySignals(rawValue, stores, getModel) : rawValue;
      propMemos[key] = createMemo(() => {
        const resolved = resolveProp(raw, stores, effectiveContext, createMemo);
        return deepUnwrap(resolved);
      });
    }
  }

  const slotProp = node.slot ? { slot: node.slot } : {};
  const themeStyle = createMemo(() => (node.theme ? { display: 'contents', ...themeToStyle(node.theme) } : undefined));
  const themeAttr = createMemo(() => node.theme?.themeName);
  const isWebComponent = node.type?.includes('-') ?? false;

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
          const resolved = resolveProp(currentProps[key], stores, effectiveContext, createMemo);
          hostRef[key] = deepUnwrap(resolved);
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
          const resolved = resolveProp(currentProps[key], stores, effectiveContext, createMemo);
          attrs[key] = deepUnwrap(resolved);
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
