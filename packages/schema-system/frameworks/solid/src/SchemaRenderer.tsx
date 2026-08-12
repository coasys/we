import type { FlatQuery, ModelClass, QueryAdapter, RendererStores } from '@we/backend-shared';
import { compileQuery } from '@we/backend-shared';
import type {
  LocalFieldMeta,
  LocalStateField,
  MapProp,
  QueryDescriptor,
  QueryStateField,
  ValidationRule,
} from '@we/schema-shared';
import {
  deepUnwrap,
  hasToken,
  noMemo,
  pruneUnresolvedWhere,
  REACTIVE_ACCESSOR,
  resolveProp,
  resolveQueryProp,
  themeToStyle,
  validateField,
} from '@we/schema-shared';
import { batch, createEffect, createMemo, createSignal, For, JSX, onCleanup, Show } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';

import { AnimateRenderer } from './AnimateRenderer';
import { ConditionalRenderer } from './ConditionalRenderer';
import type { RendererOutput, RenderProps, SchemaNode } from './types';
import { useVisualEditor } from './VisualEditorContext';

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
function hoistMapQuerySignals(value: unknown, stores: RendererStores, context: Record<string, unknown> = {}): unknown {
  if (!value || typeof value !== 'object') return value;

  // Found $map with $query items — replace items with a live reactive signal
  if (hasToken(value, '$map', 'object')) {
    const mapSpec = (value as { $map: MapProp }).$map;
    if (hasToken(mapSpec.items, '$query', 'object')) {
      const descriptor = resolveQueryProp(mapSpec.items);
      const signal = createQuerySignal(descriptor, stores, context);
      return { $map: { ...mapSpec, items: signal } };
    }
    return value;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item) => {
      const h = hoistMapQuerySignals(item, stores, context);
      if (h !== item) changed = true;
      return h;
    });
    return changed ? mapped : value;
  }

  // Plain object — recurse into all values
  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const h = hoistMapQuerySignals(v, stores, context);
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
  if (typeof params !== 'object') {
    // Bare context-ref strings (e.g. "$item.id") aren't objects, so the $-token branch
    // below never sees them. resolveProp already knows how to resolve these — delegate
    // instead of returning the raw, unresolved "$..." string (e.g. into a $query.parent.id).
    if (typeof params === 'string' && params.startsWith('$') && params.length > 1) {
      return deepUnwrap(resolveProp(params, stores, context));
    }
    return params;
  }
  if (Array.isArray(params)) return params.map((item) => deepResolveTokens(item, stores, context));

  const obj = params as Record<string, unknown>;
  const hasTokenKey = Object.keys(obj).some((k) => k.startsWith('$'));
  if (hasTokenKey) {
    const resolved = resolveProp(obj, stores, context);
    // Unwrap reactive accessors — calling them here registers deps in the enclosing createEffect.
    // Must be a deep unwrap: resolvers like $if delegate their branch to the generic dispatcher,
    // which embeds unwrapped accessor functions at arbitrary nesting depth (e.g. a $local inside
    // a $if's `then` branch), not just at the top level.
    return deepUnwrap(resolved);
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
/** Degradations already reported, keyed `entity:feature` — a reactive re-run must not respam. */
const warnedDegradations = new Set<string>();

/**
 * Report a query failure through the host's `$onError` (a toast, in the AD4M app), falling back to
 * `console.error` when no reporter is injected.
 *
 * Every backend call must terminate in this, including the subscribe path: a rejection left
 * uncaught — or rethrown from inside a `catch` — becomes an unhandled promise rejection, which
 * makes "does the user learn the query failed?" depend on global handlers rather than on this
 * layer. Reporting the same failure on each re-run is fine; the toast service collapses repeats.
 */
function reportQueryError(stores: RendererStores, entity: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const onError = stores.$onError;
  const text = `Query on "${entity}" failed: ${message}`;
  if (onError) onError(text);
  else console.error('[query]', text, err);
}

/** True for the abort we cause ourselves when an effect re-runs — expected, never reported. */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** Reporter passed to {@link routeQueryThroughIR}; its messages are already user-facing. */
function irErrorReporter(stores: RendererStores): (msg: string) => void {
  return (msg) => {
    const onError = stores.$onError;
    if (onError) onError(msg);
    else console.error('[query-ir]', msg);
  };
}

/**
 * Route the (already token-resolved) query through the neutral `QueryIR` and the injected backend
 * adapter before it reaches the backend. `compileQuery` (DSL→IR) is neutral; the backend-specific
 * plan + lowering come from the injected `$queryAdapter`, so this function knows nothing about AD4M.
 *
 * **Fails loud.** When the IR can't express the query, when the adapter reports a blocking capability
 * gap, or on any error, this reports through `onError` and returns `null` — the caller then renders
 * nothing rather than silently reverting to the raw backend path. That silent revert only ever worked
 * because AD4M happens to be *both* the query dialect and the backend; against any other backend it
 * would hand over a dialect the adapter never agreed to read, so it hid real gaps instead of
 * surfacing them. A genuine capability gap is surfaced here (and, better, at author time by the
 * capability validator) — never papered over.
 *
 * The one exception is a **`degraded`** gap: the backend runs the query and returns correct rows but
 * silently ignores one feature (a known backend *defect* — see `Disposition`). Failing loud there
 * would block a working screen over a backend bug, so it proceeds and warns once instead. That is a
 * narrow, adapter-declared waiver, not a return to the blanket fallback: the adapter has to name the
 * feature, and it stays greppable so it can be removed when the backend is fixed.
 */
function routeQueryThroughIR(
  entity: string,
  options: Record<string, unknown>,
  adapter: QueryAdapter,
  onError: (msg: string) => void,
): Record<string, unknown> | null {
  try {
    const { ir, unsupported } = compileQuery({ entity, ...options } as FlatQuery);
    if (unsupported.length > 0) {
      onError(`Query on "${entity}" uses features the query IR cannot express: ${unsupported.join(', ')}`);
      return null;
    }
    const plan = adapter.plan(ir);
    const blocking = plan.gaps.filter((g) => g.disposition !== 'degraded');
    if (blocking.length > 0) {
      onError(
        `Query on "${entity}" needs capabilities this backend does not support: ` +
          blocking.map((g) => g.feature).join(', '),
      );
      return null;
    }
    // A `degraded` gap means the backend runs this and returns correct rows, but silently ignores
    // the named feature — a known backend defect, not a capability gap. Proceed, but say so once so
    // the waiver never becomes invisible again. Warn (not `onError`): the results are usable, and a
    // reactive re-run must not raise an error toast on every render.
    for (const gap of plan.gaps) {
      const key = `${entity}:${gap.feature}`;
      if (warnedDegradations.has(key)) continue;
      warnedDegradations.add(key);
      console.warn(`[query] "${entity}" runs with a degraded feature — ${gap.feature}: ${gap.note}`);
    }
    return adapter.lower(ir) as Record<string, unknown>;
  } catch (err) {
    onError(`Query on "${entity}" could not be compiled: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function createQuerySignal(
  descriptor: QueryDescriptor,
  stores: RendererStores,
  context: Record<string, unknown> = {},
): (() => unknown[]) & { loaded: () => boolean } {
  const [items, setItems] = createStore<unknown[]>([]);
  // False until the first result set (or error) arrives, then true for good —
  // a re-run (filter change, dataset switch) keeps showing the old rows until
  // the new ones reconcile, rather than flashing a placeholder.
  const [loaded, setLoaded] = createSignal(false);
  const readItems = () => items;

  createEffect(() => {
    // Read the data bindings INSIDE the effect: the host exposes them as getters
    // over a memo of the backend ports, so these reads are reactive. A query
    // mounted before the backend connects (a reload straight into a data route)
    // re-runs and subscribes when the bindings land — previously it was stranded
    // with an empty result until a route change happened to remount it.
    const getModel = stores.$getModel;
    const getModelForPerspective = stores.$getModelForPerspective;
    if (!getModel) {
      setItems(reconcile([]));
      return;
    }
    let p: unknown = null;
    if (descriptor.dataset) {
      const parts = descriptor.dataset.split('.');
      let target: unknown = stores;
      for (const part of parts) target = (target as Record<string, unknown>)?.[part];
      p = typeof target === 'function' ? (target as () => unknown)() : target;
      // A host store may expose datasets as `DatasetRef`s (described fields + the backend's own
      // handle). Data consumers take the handle; both shapes are contract types, so unwrap here
      // rather than making every template know which one a given store hands back.
      if (p && typeof p === 'object' && 'handle' in p) p = (p as { handle: unknown }).handle;
    } else {
      // The host injects the backend-neutral $currentDataset() (AD4M's currentPerspective, another
      // backend's equivalent) — no AD4M store reference in the renderer.
      const currentDataset = stores.$currentDataset;
      p = typeof currentDataset === 'function' ? currentDataset() : null;
    }
    if (!p) {
      setItems(reconcile([]));
      return;
    }

    // Dataset-scoped model lookup: prefer a dataset-specific dynamic model, fall back to the global
    // registry.
    // The dataset stays opaque here: the host derives whatever key its per-dataset model registry
    // needs, since only it knows the concrete handle type.
    const dynamicCls = getModelForPerspective ? getModelForPerspective(descriptor.entity, p) : undefined;
    let Model: ModelClass;
    try {
      Model = dynamicCls ?? getModel(descriptor.entity);
    } catch {
      const onError = stores.$onError;
      onError?.(`Model "${descriptor.entity}" is not available in this perspective`);
      setItems(reconcile([]));
      return;
    }

    const resolvedParams = deepResolveTokens(descriptor.params, stores, context) as Record<string, unknown>;
    // An unresolved reference in a filter (a $store that hasn't loaded) must drop
    // the condition, not ship an empty one the backend cannot parse.
    if (resolvedParams.where && typeof resolvedParams.where === 'object') {
      const prunedWhere = pruneUnresolvedWhere(resolvedParams.where as Record<string, unknown>);
      if (prunedWhere === undefined) delete resolvedParams.where;
      else resolvedParams.where = prunedWhere;
    }
    const resolvedInclude =
      descriptor.include !== undefined
        ? (deepResolveTokens(descriptor.include, stores, context) as Record<string, boolean | Record<string, unknown>>)
        : undefined;
    let queryOptions: Record<string, unknown> = {
      ...resolvedParams,
      ...(resolvedInclude !== undefined && { include: resolvedInclude }),
    };
    // Route through the QueryIR when enabled. `$useQueryIR` is a reactive accessor (default from
    // `seed.features.useQueryIR`, live-toggled on the Queries test page); reading it *here*, inside the
    // effect, makes the query re-run when it flips — so toggling re-routes without a reload.
    const irFlag = stores.$useQueryIR;
    const useQueryIR = typeof irFlag === 'function' ? (irFlag as () => unknown)() === true : irFlag === true;
    const queryAdapter = stores.$queryAdapter;
    if (useQueryIR && queryAdapter) {
      // Fail loud: an IR/adapter gap renders nothing and reports, rather than silently reverting to the
      // raw backend path (which only ever worked because AD4M is both the dialect and the backend).
      const lowered = routeQueryThroughIR(descriptor.entity, queryOptions, queryAdapter, irErrorReporter(stores));
      if (lowered === null) {
        setItems(reconcile([]));
        return;
      }
      queryOptions = lowered;
    }

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
      const builder = Model.query(p, queryOptions) as {
        subscribe: (cb: (results: unknown[]) => void) => Promise<unknown[]>;
        dispose: () => void;
      };
      builder
        .subscribe((results) => {
          setItems(reconcile(normalise(results), { key: 'id', merge: true }));
          setLoaded(true);
        })
        .then((initial) => {
          setItems(reconcile(normalise(initial), { key: 'id', merge: true }));
          setLoaded(true);
        })
        .catch((err) => {
          setItems(reconcile([]));
          setLoaded(true);
          reportQueryError(stores, descriptor.entity, err);
        });
      onCleanup(() => builder.dispose());
    } else {
      // The effect re-runs when any reactive dep changes — perspective swap,
      // resolved params, etc.  When that happens (or the component unmounts)
      // the previous findAll may still be in flight against a slow query.
      // An AbortController scoped to this iteration tells the executor to
      // drop the JSON reply for the stale query instead of paying its
      // serialise + WebSocket + deserialise cost.
      //
      // ad4m's `Ad4mModel.findAll` accepts `options?: { signal?: AbortSignal }`
      // as the 3rd argument and forwards it through `perspective.modelQuery`
      // to the executor's `request.cancel` machinery.
      const controller = new AbortController();
      onCleanup(() => controller.abort());
      (Model.findAll(p, queryOptions, { signal: controller.signal }) as Promise<unknown[]>)
        .then((results) => {
          if (controller.signal.aborted) return;
          setItems(reconcile(normalise(results), { key: 'id', merge: true }));
          setLoaded(true);
        })
        .catch((err) => {
          // AbortError = a newer effect run or unmount cancelled this query.
          // Silently drop — no UI state to update, the new run handles it.
          if (isAbort(err)) return;
          setItems(reconcile([]));
          setLoaded(true);
          reportQueryError(stores, descriptor.entity, err);
        });
    }
  });

  return Object.assign(readItems, { loaded });
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

  const visualEditor = useVisualEditor();

  // Create local state signals when $localState is declared on this node
  let effectiveContext = context;
  if (node.$localState) {
    const accessors: Record<string, () => unknown> = {};
    const setters: Record<string, (v: unknown) => void> = {};
    const metaEntries: Record<string, LocalFieldMeta> = {};
    const scopeFields: string[] = [];

    // Evaluate an `initial` value: if it's an expression, resolve it once against the current
    // stores + parent context. Otherwise use it as a literal. Called both at mount and inside
    // reset() so that reset re-reads the current store value.
    //
    // Expression means either an object token (`{ $store: … }`) or a `$`-prefixed **string** — a
    // context reference like `'$space.name'`, which every other position in a schema accepts. Only
    // objects were resolved here, so a form seeded from a `$each` item silently rendered the string
    // `$space.name` in its input: no error, and the field looked filled in.
    //
    // A `$`-string that matches no context key or store global comes back unchanged (the
    // dispatcher's final pass-through), so a literal that merely starts with `$` is unaffected.
    const resolveInitial = (raw: unknown): unknown => {
      const isExpression =
        (typeof raw === 'string' && raw.startsWith('$') && raw.length > 1) ||
        (raw !== null &&
          typeof raw === 'object' &&
          !Array.isArray(raw) &&
          Object.keys(raw).some((k) => k.startsWith('$')));
      if (!isExpression) return raw;

      const resolved = resolveProp(raw, stores, context);
      if (typeof resolved === 'function' && REACTIVE_ACCESSOR in (resolved as object)) {
        return (resolved as () => unknown)();
      }
      return resolved;
    };

    for (const [name, field] of Object.entries(node.$localState as Record<string, LocalStateField>)) {
      const rawInitial = field.initial;

      // Device persistence: an explicit key opts the field into localStorage, so
      // settings like a list's content type survive a reload. The stored value
      // wins over `initial` on mount; writes go through the setter; $resetLocal
      // clears the stored copy (see meta.reset below). Files and functions have
      // no JSON form and are ignored.
      const persistKey =
        typeof field.persist === 'string' &&
        field.type !== 'file' &&
        field.type !== 'function' &&
        typeof localStorage !== 'undefined'
          ? `we-local:${field.persist}`
          : null;

      // URL mirroring: view state (content type, sort, filters) syncs with a query
      // parameter through the host's $routeParams binding, so a shared link
      // reproduces the view. Serialized as plain text for strings, JSON otherwise.
      const syncSpec =
        field.syncParam && field.type !== 'file' && field.type !== 'function'
          ? typeof field.syncParam === 'string'
            ? { name: field.syncParam, push: false }
            : { name: field.syncParam.name, push: field.syncParam.push ?? false }
          : null;
      const routeParams = stores.$routeParams as
        | {
            get(name: string): string | undefined;
            set(name: string, value: string | null, o?: { push?: boolean }): void;
          }
        | undefined;
      const decodeParam = (raw: string): unknown => {
        if (field.type === 'string') return raw;
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      };
      const encodeParam = (v: unknown): string => (field.type === 'string' ? String(v) : JSON.stringify(v));

      // Precedence: URL param > persisted value > declared initial.
      let initialValue = resolveInitial(rawInitial);
      if (persistKey) {
        try {
          const storedRaw = localStorage.getItem(persistKey);
          if (storedRaw !== null) initialValue = JSON.parse(storedRaw);
        } catch {
          // Corrupt entry — fall back to the declared initial.
        }
      }
      if (syncSpec && routeParams) {
        const fromUrl = routeParams.get(syncSpec.name);
        if (fromUrl !== undefined) initialValue = decodeParam(fromUrl);
      }

      const [get, set] = createSignal<unknown>(initialValue);
      accessors[name] = get;
      // Function-type fields: Solid treats setter(fn) as a functional update (calls fn(prev)).
      // Wrap the setter so that storing a function value works correctly.
      const baseSetter: (v: unknown) => void =
        field.type === 'function' ? (v) => set(() => v as never) : (set as (v: unknown) => void);
      const declaredInitial = resolveInitial(rawInitial);
      setters[name] =
        persistKey || (syncSpec && routeParams)
          ? (v) => {
              baseSetter(v);
              if (persistKey) {
                try {
                  localStorage.setItem(persistKey, JSON.stringify(v));
                } catch {
                  // Quota/serialization failure — the in-memory value still applies.
                }
              }
              if (syncSpec && routeParams) {
                // Back at the declared initial → drop the param, keeping URLs clean.
                const atDefault = JSON.stringify(v) === JSON.stringify(declaredInitial);
                routeParams.set(syncSpec.name, atDefault ? null : encodeParam(v), { push: syncSpec.push });
              }
            }
          : baseSetter;
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

      metaEntries[name] = {
        initial: resolveInitial(rawInitial),
        rules,
        touched,
        setTouched,
        errors,
        reset: () => {
          set(resolveInitial(rawInitial) as never);
          if (persistKey) localStorage.removeItem(persistKey);
          if (syncSpec && routeParams) routeParams.set(syncSpec.name, null);
          setTouched(false);
        },
      };

      // For dynamic initial expressions, keep the signal in sync whenever the
      // underlying store value changes (e.g. switching spaces resets the field
      // to the new space's values rather than keeping the old space's values).
      if (
        rawInitial !== null &&
        typeof rawInitial === 'object' &&
        !Array.isArray(rawInitial) &&
        Object.keys(rawInitial as object).some((k) => k.startsWith('$'))
      ) {
        const reactiveVal = resolveProp(rawInitial, stores, context, createMemo);
        createEffect(() => {
          const next =
            typeof reactiveVal === 'function' && REACTIVE_ACCESSOR in (reactiveVal as object)
              ? (reactiveVal as () => unknown)()
              : reactiveVal;
          set(next as never);
          setTouched(false);
        });
      }
    }

    effectiveContext = {
      ...context,
      $local: { ...((context.$local as Record<string, unknown>) ?? {}), ...accessors },
      $localSetters: { ...((context.$localSetters as Record<string, unknown>) ?? {}), ...setters },
      $localMeta: { ...((context.$localMeta as Record<string, unknown>) ?? {}), ...metaEntries },
      $localScopeFields: scopeFields,
    };
  }

  // Create reactive query subscriptions when $queries is declared on this node.
  // Each entry runs createQuerySignal at node mount and injects the result array into
  // $local under the given name — read-only, shared across the entire subtree.
  if (node.$queries) {
    // Always created, even before the backend's data bindings land (a reload
    // straight into a data route, or a presentation-only host): the accessor
    // reads $getModel reactively inside its own effect and starts the real
    // subscription the moment the bindings arrive. Each entry also exposes
    // `<name>Loaded` — false until the first result set (or error) — so a
    // template can hold a skeleton instead of flashing its empty state.
    const queryAccessors: Record<string, () => unknown> = {};
    for (const [name, field] of Object.entries(node.$queries as Record<string, QueryStateField>)) {
      const descriptor = resolveQueryProp({ $query: field });
      const accessor = createQuerySignal(descriptor, stores, effectiveContext);
      queryAccessors[name] = accessor;
      queryAccessors[`${name}Loaded`] = accessor.loaded;
    }
    effectiveContext = {
      ...effectiveContext,
      $local: { ...((effectiveContext.$local as Record<string, unknown>) ?? {}), ...queryAccessors },
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

  // Handle viewport-driven animations (child always mounted)
  if (node.type === '$animate') {
    return <AnimateRenderer node={node} stores={stores} context={effectiveContext} renderNode={renderNode} />;
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
      // The accessor reads $getModel reactively inside its own effect — empty
      // until the backend bindings land, live from then on.
      itemsArray = createQuerySignal(descriptor, stores, effectiveContext);
    } else {
      itemsArray = createMemo(() => {
        // Read from store proxy INSIDE the memo so Solid tracks mutations from updateSchema/patching
        const currentItems = (node.props as Record<string, unknown>)?.items;
        const resolvedItems = resolveProp(currentItems, stores, effectiveContext, createMemo);
        const items = typeof resolvedItems === 'function' ? resolvedItems() : resolvedItems;
        return Array.isArray(items) ? items : [];
      });
    }

    // Return a list of the rendered items.
    //
    // Alongside the item, each row gets `$index` and `$prev` — its position, and the row before it.
    //
    // `$prev` is what makes *grouping* expressible, and grouping is not a detail: a chat log that
    // repeats the avatar and byline on every line of a four-line message from one person is a
    // different design from one that does not, and the difference is most of the density. Without a
    // view of the neighbour a template can only ask about the row it is on, so the compact form was
    // simply unreachable — no theme or prop could recover it.
    //
    // Plain values rather than accessors, matching how the item itself is passed: a context ref
    // resolves by path lookup, and a function under `prev` would break that. The consequence is that
    // `$prev` is captured when a row renders, so it can go stale if the list is *reordered* under a
    // keyed `<For>` without that row's own identity changing. Appends and prepends — every feed
    // here — are unaffected.
    return (
      <For each={itemsArray()}>
        {(item, index) =>
          renderNode(itemSchema, {
            ...effectiveContext,
            [String(node.props?.as ?? 'item')]: item,
            index: index(),
            prev: index() > 0 ? itemsArray()[index() - 1] : undefined,
          })
        }
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
      {
        createEffect(() => {
          // Read inside the effect — reactive, so a mount before the backend
          // connects self-heals when the bindings land (see createQuerySignal).
          const getModelFn = stores.$getModel;
          const getModelForPerspective = stores.$getModelForPerspective;
          if (!getModelFn) {
            setHasItem(false);
            return;
          }
          let p: unknown = null;
          if (descriptor.dataset) {
            const parts = descriptor.dataset.split('.');
            let target: unknown = stores;
            for (const part of parts) target = (target as Record<string, unknown>)?.[part];
            p = typeof target === 'function' ? (target as () => unknown)() : target;
            // See the $each dataset resolution above — a store may hand back a DatasetRef.
            if (p && typeof p === 'object' && 'handle' in p) p = (p as { handle: unknown }).handle;
          } else {
            const currentDataset = stores.$currentDataset;
            p = typeof currentDataset === 'function' ? currentDataset() : null;
          }
          if (!p) {
            setHasItem(false);
            return;
          }

          const dynamicCls = getModelForPerspective ? getModelForPerspective(descriptor.entity, p) : undefined;
          let Model: ModelClass;
          try {
            Model = dynamicCls ?? getModelFn(descriptor.entity);
          } catch {
            const onError = stores.$onError;
            onError?.(`Model "${descriptor.entity}" is not available in this perspective`);
            setHasItem(false);
            return;
          }

          const resolvedParams = deepResolveTokens(descriptor.params, stores, effectiveContext) as Record<
            string,
            unknown
          >;
          if (resolvedParams.where && typeof resolvedParams.where === 'object') {
            const prunedWhere = pruneUnresolvedWhere(resolvedParams.where as Record<string, unknown>);
            if (prunedWhere === undefined) delete resolvedParams.where;
            else resolvedParams.where = prunedWhere;
          }
          const resolvedInclude =
            descriptor.include !== undefined
              ? (deepResolveTokens(descriptor.include, stores, effectiveContext) as Record<
                  string,
                  boolean | Record<string, unknown>
                >)
              : undefined;
          let queryOptions: Record<string, unknown> = {
            ...resolvedParams,
            ...(resolvedInclude !== undefined && { include: resolvedInclude }),
          };
          // Route through the QueryIR, as the list path does. Handing options straight to the
          // backend would skip capability planning entirely — no fail-loud on a genuine gap, no
          // `degraded` warning, and on a non-AD4M backend it would pass a dialect the adapter
          // never agreed to read.
          const irFlag = stores.$useQueryIR;
          const useQueryIR = typeof irFlag === 'function' ? (irFlag as () => unknown)() === true : irFlag === true;
          const queryAdapter = stores.$queryAdapter;
          if (useQueryIR && queryAdapter) {
            const lowered = routeQueryThroughIR(descriptor.entity, queryOptions, queryAdapter, irErrorReporter(stores));
            if (lowered === null) {
              setHasItem(false);
              return;
            }
            queryOptions = lowered;
          }

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
            const builder = Model.query(p, queryOptions) as {
              subscribe: (cb: (results: unknown[]) => void) => Promise<unknown[]>;
              dispose: () => void;
            };
            builder
              .subscribe(handleResults)
              .then(handleResults)
              .catch((err: unknown) => {
                setHasItem(false);
                reportQueryError(stores, descriptor.entity, err);
              });
            onCleanup(() => builder.dispose());
          } else {
            // Same abort discipline as the list-path createQuerySignal: the
            // effect re-runs on perspective swap / param change, and any
            // in-flight findAll from the previous run should be cancelled so
            // we don't pay its serialise + transit + deserialise tax.
            const controller = new AbortController();
            onCleanup(() => controller.abort());
            (Model.findAll(p, queryOptions, { signal: controller.signal }) as Promise<unknown[]>)
              .then((results) => {
                if (controller.signal.aborted) return;
                handleResults(results);
              })
              .catch((err) => {
                if (isAbort(err)) return;
                setHasItem(false);
                reportQueryError(stores, descriptor.entity, err);
              });
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

  // $agent: demand-fetch and inject an AgentProfileSummary into child context.
  // Usage: { type: '$agent', props: { did: '$item.author', as: 'agent' }, children: [...] }
  if (node.type === '$agent') {
    const asKey = String(node.props?.as ?? 'agent');
    const [hasAgent, setHasAgent] = createSignal(false);
    const [agentStore, setAgentStore] = createStore<Record<string, unknown>>({});

    createEffect(() => {
      const rawDid = node.props?.did;
      // resolveProp handles both '$post.author' strings and token objects like { $local: 'selectedPin.id' }
      const did = rawDid ? String(resolveProp(rawDid, stores, effectiveContext) ?? '') : '';
      if (!did) return;

      const identities = stores.$identities;
      if (!identities) return;

      // `get` reads reactively, so this effect re-runs once a `fetch` lands and the profile appears.
      const cached = identities.get(did);
      if (cached) {
        setAgentStore(reconcile(cached, { merge: true }));
        setHasAgent(true);
      } else {
        identities.fetch(did);
      }
    });

    const childContext = { ...effectiveContext, [asKey]: agentStore };
    return (
      <Show when={hasAgent()}>
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
  // An unrecognised type used to throw, which took down **the whole render** rather than one node —
  // so a template referencing a component from a module that isn't enabled produced a blank page.
  // Fail the way the rest of the system does: loud, but scoped.
  //
  // Dev-time loudness is not lost: `we-validate-schemas` catches unknown types before runtime, which
  // is the right place for a typo. What changes is only the runtime, where one bad node should cost
  // that node and nothing more.
  if (!component()) {
    const message = `Unknown component "${node.type}"`;
    console.error(`${message}. It may belong to a feature module that is not enabled, or the type may be misspelt.`);
    return (
      <div
        data-we-missing-component={node.type}
        style={{
          padding: 'var(--we-space-300, 12px)',
          border: '1px dashed var(--we-color-danger-400, #d66)',
          'border-radius': 'var(--we-radius-300, 6px)',
          color: 'var(--we-color-danger-600, #a33)',
          'font-size': 'var(--we-font-size-100, 12px)',
        }}
      >
        {message}
      </div>
    );
  }

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
  //
  // MEASURED DEAD END — one memo per prop looks wasteful for a node whose props are all static
  // literals, and consolidating them into a single shared memo per node is the obvious fix. It was
  // tried and measured **slower**: roughly +6% headless, and worse in the browser. The per-read
  // indirection and the object allocation it introduced outweighed every memo it removed. Do not
  // retry without a materially different approach — resolving static props at template-install time
  // (a schema pre-compilation step) is the direction that has not been tried.
  // See docs/architecture/performance.md for how these costs were measured.
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
      propMemos[key] = createQuerySignal(descriptor, stores, effectiveContext);
    } else if (
      hasToken(rawValue, '$map', 'object') &&
      hasToken((rawValue as { $map: MapProp }).$map.items, '$query', 'object')
    ) {
      // $map with $query items: wire a reactive subscription for the items source,
      // then pass the live signal into resolveMapProp so it re-maps on every update.
      const mapSpec = (rawValue as { $map: MapProp }).$map;
      const descriptor = resolveQueryProp(mapSpec.items);
      const itemsSignal = createQuerySignal(descriptor, stores, effectiveContext);
      propMemos[key] = createMemo(() =>
        deepUnwrap(resolveProp({ $map: { ...mapSpec, items: itemsSignal } }, stores, effectiveContext, createMemo)),
      );
    } else if (isEventProp(key) && Array.isArray(rawValue)) {
      // Event handler arrays: resolve each item lazily at call time so that
      // $if conditions with $event.* references (e.g. '$event.detail') resolve
      // against the actual event rather than the render-time context.
      const items = rawValue as unknown[];
      propMemos[key] =
        () =>
        (...args: unknown[]) => {
          const callContext = args.length > 0 ? { ...effectiveContext, event: args[0] } : effectiveContext;
          for (const item of items) {
            /*
              `noMemo`, not `createMemo`: this runs inside the event handler, where there is no
              reactive owner, so a memo here is a computation created outside a root — Solid warns
              and it is never disposed. A handler array is evaluated once per click against the
              event that just happened; there is nothing for a memo to hold on to.
            */
            let fn = resolveProp(item, stores, callContext, noMemo);
            if (typeof fn === 'function' && REACTIVE_ACCESSOR in (fn as object)) fn = (fn as () => unknown)();
            if (typeof fn === 'function') fn(...args);
          }
        };
    } else {
      const raw = hoistMapQuerySignals(rawValue, stores, effectiveContext);
      propMemos[key] = createMemo(() => {
        const resolved = resolveProp(raw, stores, effectiveContext, createMemo);
        return deepUnwrap(resolved);
      });
    }
  }

  /**
   * Which of a parent web component's named slots this node goes into.
   *
   * Applied to the **wrapper** below rather than to the element itself, and that is the only
   * placement that can work. Every node is wrapped in a `display: contents` div, so the wrapper —
   * not the component — is the direct child a shadow host sees, and slot assignment considers
   * direct children only. `display: contents` does not change that: slotting is a DOM-tree
   * question, not a layout one.
   *
   * On the inner element the attribute was inert. It matched nothing, the wrapper fell into the
   * default slot regardless, and a node aimed at a named slot rendered as ordinary content beside
   * the trigger while the slot it named stayed empty. `we-tabs` hit this and worked around it from
   * the other side, by finding its tabs with `querySelectorAll` at any depth.
   */
  const slotProp = node.slot ? { slot: node.slot } : {};
  // Compute wrapper div styles. `theme` always uses display:contents so it doesn't affect layout
  // but still scopes CSS custom properties. `styles` is the raw-CSS escape hatch — when present
  // the wrapper participates in layout (no display:contents) so transforms, filters, etc. work.
  const wrapperStyle = createMemo(() => {
    const themeVars = node.theme ? { display: 'contents' as const, ...themeToStyle(node.theme) } : null;
    const ns = node.styles;
    if (themeVars && ns) return { ...themeVars, ...ns };
    if (themeVars) return themeVars;
    if (ns) return ns;
    return { display: 'contents' as const };
  });
  const themeAttr = createMemo(() => node.theme?.themeName);
  const isWebComponent = node.type?.includes('-') ?? false;

  // Register this wrapper div in the visual editor node registry.
  // The ref is set synchronously during JSX evaluation, before effects run.
  let wrapperRef: HTMLDivElement | undefined;
  createEffect(() => {
    if (visualEditor.enabled && node.id && wrapperRef) {
      return visualEditor.registerNode(node.id, wrapperRef);
    }
  });

  /**
   * Build this node's children ONCE and reuse the result.
   *
   * Both render paths below put children in `<Dynamic>`'s children position, next to
   * `component={component()}` and a `{...reactiveAttrs()}` / `{...eventAttrs()}` spread. Solid's
   * compiler turns a dynamic children expression into a getter, so whenever that spread recomputes
   * — i.e. whenever *any* prop on this node is reactive and changes — `<Dynamic>` re-renders and
   * re-invokes the getter, reconstructing the entire subtree beneath it.
   *
   * That is not just wasted DOM work: rebuilding the subtree re-runs `createQuerySignal` for every
   * `$query` inside it, so each rebuild issues a *duplicate backend query*. Measured case:
   * `gridWrapper`'s `<Grid>` has a reactive `columns` prop (`$if` on `displayMode`), so every card
   * list built its children twice and fired two identical queries.
   *
   * A memo fixes it without costing reactivity: `node.children` is read from the schema store, so a
   * genuine schema patch (visual editor / `updateSchema`) still invalidates and rebuilds, while an
   * unrelated prop change now reuses the cached subtree.
   *
   * Declared after the `$if`/`$each`/`$routes` early returns above, and after the memo-creating prop
   * setup — `createMemo` runs eagerly, so declaring it earlier would build children for nodes that
   * never render them.
   */
  const childrenEl = createMemo(() => renderChildren(node.children));

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

    // Track dynamically added props for web components, and reset them when removed.
    // prevDynamicKeys persists across effect runs to detect keys that have been deleted.
    const prevDynamicKeys = new Set<string>();
    createEffect(() => {
      const currentProps = node.props as Record<string, unknown> | undefined;
      if (!hostRef) return;
      const currentDynamicKeys = new Set<string>();
      if (currentProps) {
        for (const key of Object.keys(currentProps)) {
          if (!(key in propMemos) && !isEventProp(key)) {
            const resolved = resolveProp(currentProps[key], stores, effectiveContext, createMemo);
            hostRef[key] = deepUnwrap(resolved);
            currentDynamicKeys.add(key);
          }
        }
      }
      for (const key of prevDynamicKeys) {
        if (!currentDynamicKeys.has(key)) hostRef[key] = undefined;
      }
      prevDynamicKeys.clear();
      for (const key of currentDynamicKeys) prevDynamicKeys.add(key);
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
      <Dynamic ref={hostRef} component={component()} {...eventAttrs()} {...slotElements}>
        {childrenEl()}
      </Dynamic>
    );

    return (
      <div
        ref={wrapperRef}
        style={wrapperStyle()}
        {...slotProp}
        data-we-theme={themeAttr()}
        data-we-node-id={visualEditor.enabled && node.id ? node.id : undefined}
      >
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
    <Dynamic component={component()} {...reactiveAttrs()} {...slotElements}>
      {childrenEl()}
    </Dynamic>
  );

  return (
    <div
      ref={wrapperRef}
      style={wrapperStyle()}
      {...slotProp}
      data-we-theme={themeAttr()}
      data-we-node-id={visualEditor.enabled && node.id ? node.id : undefined}
    >
      {solidElement}
    </div>
  );
}
