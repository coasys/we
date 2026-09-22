import type { EntityClass, FlatQuery, QueryAdapter, RendererStores } from '@we/backend-shared';
import { combineEntityRows, entityNamesOf, routeQuery } from '@we/backend-shared';
import type {
  LocalFieldMeta,
  LocalStateField,
  QueryDescriptor,
  QueryStateField,
  ValidationRule,
} from '@we/schema-shared';
import {
  applyThemeVars,
  deepUnwrap,
  hasToken,
  markReactive,
  noMemo,
  pruneUnresolvedWhere,
  REACTIVE_ACCESSOR,
  resolveProp,
  resolveQueryProp,
  scopeIsAnchored,
  validateField,
} from '@we/schema-shared';
import { batch, createEffect, createMemo, createSignal, For, JSX, onCleanup, Show } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';

import { AnimateRenderer } from './AnimateRenderer';
import { ConditionalRenderer } from './ConditionalRenderer';
import { acquireSubscription } from './subscriptionPool';
import { SurfaceRenderer } from './SurfaceRenderer';
import type { RendererOutput, RenderProps, SchemaNode } from './types';
import { useVisualEditor } from './VisualEditorContext';

/** Check if a prop key is an event handler name (e.g. onClick, onInput, onKeyDown) */
function isEventProp(key: string): boolean {
  return key.length > 2 && key.startsWith('on') && key[2] === key[2].toUpperCase();
}

/**
 * Deep-walk query params and evaluate any expression tokens to their current values.
 * Scoped to descriptor.params only — never touches the broader schema tree.
 * Must be called inside a Solid createEffect so that signal reads register as
 * reactive dependencies automatically, triggering re-runs when store values change.
 */
function deepResolveTokens(
  params: unknown,
  stores: Record<string, unknown>,
  context: Record<string, unknown>,
): unknown {
  if (params === null || params === undefined || typeof params !== 'object') return params;
  if (Array.isArray(params)) return params.map((item) => deepResolveTokens(item, stores, context));

  const obj = params as Record<string, unknown>;
  const hasTokenKey = Object.keys(obj).some((k) => k.startsWith('$'));
  if (hasTokenKey) {
    const resolved = resolveProp(obj, stores, context);
    // Unwrap reactive accessors — calling them here registers deps in the enclosing createEffect.
    // Deep, because a handler token resolved here may embed accessors below its top level.
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
 * The entity a query names, resolving an expression against the stores and the row's bindings.
 *
 * A plain name is the overwhelming case and goes through untouched. An expression is what lets a
 * template list records of a type it was not written for — a feed inside `$each` over a store's
 * list of model names, where `entity: { $: 'target' }` reads the row it is on. That is the same
 * arrangement `where` and `order` have always had; `entity` was the one part of a query a template
 * had to know before it ran.
 *
 * A **list** of names is a query over all of them — see `entityNamesOf` in `@we/backend-shared` for
 * what counts as one, and `runQuery` for how it is asked. An empty list has answered: "no kinds" is
 * a result.
 *
 * Answers `undefined` for anything that does not resolve to a name or a list, which callers must
 * treat as **not yet** rather than as an error: a store read is empty for the first frames after a
 * mount and permanently on a host that does not carry it, exactly as with an unresolved `where`
 * operand.
 *
 * Call it inside the effect, so the read is tracked and the query re-runs when the name changes.
 */
function resolveEntityNames(
  entity: unknown,
  stores: RendererStores,
  context: Record<string, unknown>,
): { names: string[]; union: boolean } | undefined {
  return entityNamesOf(typeof entity === 'string' ? entity : deepResolveTokens(entity, stores, context));
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
/** Diagnostics already reported, keyed `entity:diagnostic` — a reactive re-run must not respam. */
const warnedDiagnostics = new Set<string>();

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

/**
 * Compile, plan and lower one query for the connected backend, and say what that found.
 *
 * The deciding is {@link routeQuery}'s, in `@we/backend-shared`, where it is neutral and tested. What
 * is left here is the reporting policy, which is the renderer's because only it knows where a message
 * goes: a refusal is user-facing and raises a toast; a diagnostic is for whoever wrote the template,
 * so it warns to the console, once per `entity:diagnostic`, and only in development — a query re-runs
 * on every reactive change, and a warning per frame is a warning nobody reads.
 *
 * Returns `null` when the query cannot run, and the caller renders nothing. There is deliberately no
 * third answer where the raw descriptor goes to the backend unrouted: that only ever worked because
 * AD4M is both the dialect and the backend, so it hid real capability gaps instead of surfacing them.
 *
 * A host with no `$queryAdapter` at all is the same refusal with a different sentence. The binding is
 * required by `RendererDataBindings`, so its absence is an unimplemented contract rather than a
 * query anyone can fix — and saying which is missing beats every query on the screen reporting a
 * compile error about a backend that was never wired up.
 */
function routeForBackend(
  entity: string,
  options: Record<string, unknown>,
  adapter: QueryAdapter | undefined,
  stores: RendererStores,
): Record<string, unknown> | null {
  if (!adapter) {
    reportRoutingRefusal(
      stores,
      `Query on "${entity}" cannot run: this host injected no $queryAdapter, so there is nothing to ` +
        'plan or lower the query for. Every backend supplies one (see RendererDataBindings).',
    );
    return null;
  }

  const routed = routeQuery({ entity, ...options } as FlatQuery, adapter);

  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    for (const diagnostic of routed.diagnostics) {
      const key = `${entity}:${diagnostic.key}`;
      if (warnedDiagnostics.has(key)) continue;
      warnedDiagnostics.add(key);
      console.warn('[query]', diagnostic.message);
    }
  }

  if (routed.ok) return routed.options as Record<string, unknown>;

  reportRoutingRefusal(stores, routed.error);
  return null;
}

/** A refused query is user-facing: a toast where the host offers one, the console where it does not. */
function reportRoutingRefusal(stores: RendererStores, message: string): void {
  const onError = stores.$onError;
  if (onError) onError(message);
  else console.error('[query-ir]', message);
}

/**
 * Ask the backend one query, over one entity or several, and hand back rows each time they change.
 *
 * Shared by the list path and `$single`, which differ only in what they do with the rows. Must be
 * called inside the effect: it registers its own cleanup, so a re-run disposes the subscriptions or
 * cancels the reads it started.
 *
 * ## One entity
 *
 * Exactly the path there has always been: route, then `query().subscribe` or `findAll`. A failure is
 * the caller's `onError`, and a model the dataset lacks or a refused route means nothing runs.
 *
 * ## Several
 *
 * Backends answer one entity at a time, so each is asked separately and the answers are combined by
 * `combineEntityRows` — tagged with the class each came from, de-duplicated, then ordered and
 * limited as a whole. Nothing is emitted until every entity has answered once: a list that filled in
 * kind by kind would flash as incomplete, and `Loaded` would turn true over a partial answer.
 *
 * One entity that cannot be read is reported and counts as having no rows, rather than taking the
 * others down with it — the same choice the graph's seeds make, where a canvas that cannot read one
 * of its types keeps the rest.
 *
 * `offset` is refused. Paging a union correctly means fetching `offset + limit` from every entity to
 * find one page, which is a cost to design for when something needs it, not one to pay silently.
 *
 * Returns `false` when nothing was started (already reported), so the caller can clear its rows.
 */
/**
 * Whether this query should follow its answer — resolving an expression if that is what was written.
 *
 * Must be called **inside** the querying effect, like every other resolved part of a query: that is
 * what makes a surface stop subscribing the moment its subject settles, rather than at whatever the
 * condition happened to be when the node mounted.
 *
 * An unresolved expression reads as **not live** rather than live. That is the safe direction: the
 * worst case is a surface that fetches once and re-asks a moment later when the condition resolves,
 * where the other way round opens a subscription nobody asked for — which is the cost this exists to
 * avoid, and the more expensive mistake of the two.
 */
function resolveSubscribe(
  authored: unknown,
  stores: Record<string, unknown>,
  context: Record<string, unknown>,
): boolean {
  if (authored === undefined) return true;
  if (typeof authored === 'boolean') return authored;
  return Boolean(deepResolveTokens(authored, stores, context));
}

function runQuery(request: {
  names: string[];
  union: boolean;
  dataset: unknown;
  options: Record<string, unknown>;
  subscribe: boolean | undefined;
  stores: RendererStores;
  onRows: (rows: Record<string, unknown>[]) => void;
  onError: (entity: string, err: unknown) => void;
}): boolean {
  const { names, union, dataset, options, stores } = request;
  const getEntity = stores.$getEntity;
  const getEntitiesForPerspective = stores.$getEntitiesForPerspective;
  if (!getEntity) return false;

  if (union && options.offset != null) {
    reportRoutingRefusal(
      stores,
      `Query on ${names.map((name) => `"${name}"`).join(', ')} cannot take an offset: a query over several ` +
        'entities is ordered and limited as a whole, and paging one is not supported yet.',
    );
    return false;
  }

  const plans: { entity: string; Model: EntityClass; queryOptions: Record<string, unknown> }[] = [];
  for (const entity of names) {
    // Dataset-scoped model lookup: prefer a dataset-specific dynamic model, fall back to the global
    // registry. The dataset stays opaque here: the host derives whatever key its per-dataset model
    // registry needs, since only it knows the concrete handle type.
    const dynamicCls = getEntitiesForPerspective ? getEntitiesForPerspective(entity, dataset) : undefined;
    let Model: EntityClass;
    try {
      Model = dynamicCls ?? getEntity(entity);
    } catch {
      stores.$onError?.(`Model "${entity}" is not available in this perspective`);
      if (union) continue;
      return false;
    }
    // Every query goes through the neutral IR and the backend's own adapter. Fail loud: a gap renders
    // nothing and reports, rather than handing the backend a dialect its adapter never agreed to read.
    const queryOptions = routeForBackend(entity, options, stores.$queryAdapter, stores);
    if (queryOptions === null) {
      if (union) continue;
      return false;
    }
    plans.push({ entity, Model, queryOptions });
  }

  // AD4M model instances expose `id` as a prototype getter, not an own enumerable
  // property, so Solid's reconcile({ key: 'id' }) cannot find it for keyed diffing.
  // Without normalisation, every subscription update destroys and recreates all
  // <For> entries (reconcile treats them as new), causing visible DOM flashes.
  const normalise = (results: readonly unknown[]): Record<string, unknown>[] =>
    results.map((r) => {
      const rec = r as Record<string, unknown>;
      return { id: rec.id, ...rec };
    });

  /*
    Whether this run has been superseded — the effect re-ran, or the node unmounted.

    A subscription answers twice over: once through the callback, and once more when `subscribe()`
    resolves with the initial rows. Neither is withdrawn by `dispose()`. So a query torn down before its
    first answer arrived — a selection let go of a moment after it was made, a `when` turning falsy —
    had that answer land afterwards and write the rows its successor had just cleared: the inspector
    went on showing a card nobody had selected any more, until something else re-ran it. Every answer
    is checked against this rather than trusting the backend to stop calling.
  */
  let stale = false;
  onCleanup(() => {
    stale = true;
  });

  const answered = new Map<string, readonly unknown[]>();
  const take = (entity: string, results: readonly unknown[]) => {
    if (stale) return;
    answered.set(entity, results);
    if (answered.size < plans.length) return;
    request.onRows(
      union
        ? combineEntityRows(
            plans.map((plan) => ({ entity: plan.entity, rows: answered.get(plan.entity) ?? [] })),
            { order: options.order as Record<string, unknown> | undefined, limit: options.limit },
          )
        : normalise(results),
    );
  };
  const fail = (entity: string, err: unknown) => {
    if (stale) return;
    if (!union) return request.onError(entity, err);
    reportQueryError(stores, entity, err);
    take(entity, []);
  };

  // Several entities of which none could be asked — or a list that named none — have answered.
  if (plans.length === 0) {
    request.onRows([]);
    return true;
  }

  if (request.subscribe) {
    for (const { entity, Model, queryOptions } of plans) {
      // Shared with every other node asking the same question — see `subscriptionPool`.
      const release = acquireSubscription(
        Model as never,
        dataset,
        queryOptions,
        (results) => take(entity, results),
        (err) => fail(entity, err),
        entity,
      );
      onCleanup(release);
    }
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
    for (const { entity, Model, queryOptions } of plans) {
      (Model.findAll(dataset, queryOptions, { signal: controller.signal }) as Promise<unknown[]>)
        .then((results) => {
          if (controller.signal.aborted) return;
          take(entity, results);
        })
        .catch((err: unknown) => {
          // AbortError = a newer effect run or unmount cancelled this query.
          // Silently drop — no UI state to update, the new run handles it.
          if (isAbort(err)) return;
          fail(entity, err);
        });
    }
  }
  return true;
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
    // with an empty result until a route change happened to remount it. `runQuery` reads the rest
    // of them, synchronously, inside this same effect.
    if (!stores.$getEntity) {
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

    // Read inside the effect, so a name that comes from an expression re-runs the query when it
    // changes — and so a name that is not there yet is a frame to wait through, not a failure.
    const entities = resolveEntityNames(descriptor.entity, stores, context);
    if (!entities) {
      setItems(reconcile([]));
      return;
    }

    // A query that waits — see `QueryToken.when`. Read inside the effect, so the moment the
    // condition turns true the query is asked; until then it has not been, which is what `Loaded`
    // staying false says. Different from an unresolved `where` operand, which is pruned and the
    // query asked anyway: pruning widens, and a scope that is about to exist must not be widened.
    if (descriptor.when !== undefined) {
      const ready = deepResolveTokens(descriptor.when, stores, context);
      if (!ready) {
        setItems(reconcile([]));
        setLoaded(false);
        return;
      }
    }

    const resolvedParams = deepResolveTokens(descriptor.params, stores, context) as Record<string, unknown>;
    // An unresolved reference in a filter (a $store that hasn't loaded) must drop
    // the condition, not ship an empty one the backend cannot parse.
    if (resolvedParams.where && typeof resolvedParams.where === 'object') {
      const prunedWhere = pruneUnresolvedWhere(resolvedParams.where as Record<string, unknown>);
      if (prunedWhere === undefined) delete resolvedParams.where;
      else resolvedParams.where = prunedWhere;
    }
    // And the same rule for the anchor a scope narrows to: unresolved means "don't narrow", not
    // "narrow to the children of nothing". A view that reads its anchor from a URL parameter carries
    // the scope unconditionally and is unanchored when nobody named one.
    if (resolvedParams.scope !== undefined && !scopeIsAnchored(resolvedParams.scope)) delete resolvedParams.scope;
    const resolvedInclude =
      descriptor.include !== undefined
        ? (deepResolveTokens(descriptor.include, stores, context) as Record<string, boolean | Record<string, unknown>>)
        : undefined;
    const rawOptions: Record<string, unknown> = {
      ...resolvedParams,
      ...(resolvedInclude !== undefined && { include: resolvedInclude }),
    };

    const started = runQuery({
      ...entities,
      dataset: p,
      options: rawOptions,
      // Read inside the effect, so a surface can stop following its subject the moment the subject
      // stops changing — see `QueryToken.subscribe`. A change re-runs this effect, which disposes
      // the old subscription on cleanup, so going live-to-static actually releases it.
      subscribe: resolveSubscribe(descriptor.subscribe, stores, context),
      stores,
      onRows: (rows) => {
        setItems(reconcile(rows, { key: 'id', merge: true }));
        setLoaded(true);
      },
      onError: (entity, err) => {
        setItems(reconcile([]));
        setLoaded(true);
        reportQueryError(stores, entity, err);
      },
    });
    if (!started) setItems(reconcile([]));
  });

  /*
    Marked reactive, so a consumer that unwraps accessors gets rows rather than a function.

    The two conventions in the resolvers differ, and the difference is invisible until it bites:
    `$map` calls whatever it is handed (`typeof items === 'function' ? items() : items`), while
    `$count` and `$find` only call it when `REACTIVE_ACCESSOR` is set — a deliberate distinction,
    since a prop may legitimately hold a plain callable that must not be invoked. Unmarked, this
    accessor satisfied the first and not the second, so hoisting a query into a `$count` produced a
    function, `Array.isArray` said no, and the count came back 0 — the same value a genuinely empty
    query returns, which is why it read as "this call has no utterances".
  */
  return markReactive(Object.assign(readItems, { loaded }));
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
    // Expression means either a token object (`{ $: … }`, `{ $query: … }`) or a `$`-prefixed
    // **string** — the old context reference, `'$space.name'`. Only objects were resolved here, so a
    // form seeded from a `$each` item silently rendered the string `$space.name` in its input: no
    // error, and the field looked filled in.
    //
    // **This is the last place a `$`-string evaluates.** Every other position treats one as literal
    // text and the validator rejects it, which is the contract as of #169 — an `initial` is the one
    // exception, kept so a template written before that still seeds its fields rather than putting
    // the ten characters into them. Do not read this as the spelling being alive.
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
    // reads $getEntity reactively inside its own effect and starts the real
    // subscription the moment the bindings arrive. Each entry also exposes
    // `<name>Loaded` — false until the first result set (or error) — so a
    // template can hold a skeleton instead of flashing its empty state.
    const queryAccessors: Record<string, () => unknown> = {};
    /*
      A query may read the results of the queries declared before it.

      Each entry's `where` and `scope` are resolved against the context it is created with, and
      before this the accessors were merged into `$local` only after the whole list had been made —
      so a query whose anchor was `first(local.board).gathers` read `local.board` as undeclared, got
      nothing, dropped its scope, and drew the whole space. Not a frame to wait through: an
      undeclared name is not a reactive read, so nothing re-ran it when the board arrived.

      The names are declared up front as accessors that look the real one up at read time. Every
      accessor exists before any query's effect first runs — effects are deferred past the
      synchronous creation of the whole list — so a read inside one query's effect reaches the
      other's signal whichever was declared first, is tracked by it, and re-runs the reader when it
      answers. Declaration order does not matter, and the test says so.
    */
    const entries = Object.entries(node.$queries as Record<string, QueryStateField>);
    const forward: Record<string, () => unknown> = {};
    for (const [name] of entries) {
      forward[name] = () => queryAccessors[name]?.() ?? [];
      forward[`${name}Loaded`] = () => queryAccessors[`${name}Loaded`]?.() ?? false;
    }
    const queryContext = {
      ...effectiveContext,
      $local: { ...((effectiveContext.$local as Record<string, unknown>) ?? {}), ...forward },
    };
    for (const [name, field] of entries) {
      const descriptor = resolveQueryProp({ $query: field });
      const accessor = createQuerySignal(descriptor, stores, queryContext);
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

  /**
   * `nodes` is an accessor, so the list is read inside `<For>` rather than by whoever calls this.
   *
   * That is what makes a *change* to the list reconcile instead of rebuild. `For` keys by
   * reference, so an entry whose node object is unchanged keeps its DOM — which several things
   * depend on and one of them says so outright: the slot registry preserves a subtree's identity
   * "so the renderer has no reason to remount it".
   *
   * It had a reason anyway. Read here, the list was a dependency of the memo below, so every
   * change tore down the `<For>` and built a new one — every entry remounted, including the ones
   * that had not changed. Shell chrome is one node with a reactive children list, so entering a
   * space (which registers the interface's panels) destroyed and rebuilt the sidebar, the boot
   * screen and every dock frame. The sidebar is a rail that closes on `mouseleave`, and an element
   * removed under the pointer is never sent one: it stayed open until it was hovered again.
   */
  function renderChildren(nodes: () => SchemaNode['children']): RendererOutput {
    return (
      <For each={nodes() ?? []} fallback={null}>
        {(child) => {
          // A string child is text.
          if (typeof child === 'string') return child;
          // An expression placed directly in children renders as text. Schema nodes (have `type`
          // or `children`) are not tokens even when they carry $-prefixed keys like $localState.
          if (
            child &&
            typeof child === 'object' &&
            !('type' in child) &&
            !('children' in child) &&
            Object.keys(child).some((k) => k.startsWith('$'))
          ) {
            // Resolved inside the reactive expression so the reads it makes are tracked as
            // fine-grained dependencies. A `$query` cannot be read from here — children render
            // inside a memo, and a subscription is an effect — so a question for the backend is
            // hoisted into `$queries` and read back through `local`.
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
    const fragment = <>{renderChildren(() => node.children)}</>;
    if (node.theme) {
      /*
        Applied, not declared.

        Spreading the parameters into `style` writes a theme's inputs and its role defaults and stops
        there. Everything that has to be *measured* — the per-hue chroma ceilings, a fill moved until
        a label fits, the label chosen against where it landed, the corrected foregrounds, which way
        a hover travels — happens at apply time and needs a real element.

        Left out they do not go missing: custom properties inherit, so a themed node quietly rendered
        through the *ambient* theme's measurements. A green theme inside a violet app was drawn with
        the violet's chroma ceilings.

        `display: contents` still generates no box, so this changes nothing about layout — the
        element exists to carry variables and to be something the derivation can measure against.
      */
      const themed = node.theme;
      let themeEl: HTMLDivElement | undefined;
      createEffect(() => {
        if (themeEl) applyThemeVars(themeEl, themed);
      });
      return (
        <div
          ref={(el: HTMLDivElement) => (themeEl = el)}
          style={{ display: 'contents' }}
          data-we-theme={themed.themeName}
        >
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

  /*
    A responsive boundary — a box whose size the content inside it can adapt to.

    Placed by the host wherever it mounts a schema tree, and by a template that wants a pane to
    adapt to itself rather than to the page. Nesting is meaningful: the innermost surface wins, for
    the CSS rules `*UpProps` compiles to and for the tier reported here alike.
  */
  if (node.type === '$surface') {
    return <SurfaceRenderer node={node} context={effectiveContext} renderNode={renderNode} />;
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
      // The accessor reads $getEntity reactively inside its own effect — empty
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
          if (!stores.$getEntity) {
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

          // Same as `createQuerySignal`: read inside the effect so an expression re-runs the query,
          // and treat a name that has not resolved yet as a frame to wait through.
          const entities = resolveEntityNames(descriptor.entity, stores, effectiveContext);
          if (!entities) {
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
          if (resolvedParams.scope !== undefined && !scopeIsAnchored(resolvedParams.scope)) delete resolvedParams.scope;
          const resolvedInclude =
            descriptor.include !== undefined
              ? (deepResolveTokens(descriptor.include, stores, effectiveContext) as Record<
                  string,
                  boolean | Record<string, unknown>
                >)
              : undefined;
          const rawOptions: Record<string, unknown> = {
            ...resolvedParams,
            ...(resolvedInclude !== undefined && { include: resolvedInclude }),
          };
          // Routed exactly as the list path is, by the same runner. Handing options straight to the
          // backend would skip capability planning entirely — no fail-loud on a genuine gap, no
          // `degraded` warning, and on a non-AD4M backend it would pass a dialect the adapter never
          // agreed to read. Over several entities it is the first row of the combined, ordered list.
          const started = runQuery({
            ...entities,
            dataset: p,
            options: rawOptions,
            subscribe: resolveSubscribe(descriptor.subscribe, stores, context),
            stores,
            onRows: (rows) => {
              if (rows.length === 0) {
                setHasItem(false);
              } else {
                // Rows arrive with `id` already copied off the prototype, so the store proxy has a
                // stable id for $profile.id action args.
                setItem(reconcile(rows[0], { merge: true }));
                setHasItem(true);
              }
            },
            onError: (entity, err) => {
              setHasItem(false);
              reportQueryError(stores, entity, err);
            },
          });
          if (!started) setHasItem(false);
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
  // resolveProp is called INSIDE the memo so that an expression's reads
  // are tracked as the memo's signal dependencies.
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
    } else if (isEventProp(key) && Array.isArray(rawValue)) {
      // Event handler arrays: resolve each item lazily at call time so that
      // `$if` conditions and expressions reading `event` resolve against the
      // actual event rather than the render-time context.
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
      propMemos[key] = createMemo(() => {
        const resolved = resolveProp(rawValue, stores, effectiveContext, createMemo);
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
    // The theme's variables are *applied* to this element below rather than spread in here — see
    // the effect under `wrapperRef`. Only layout belongs in the style object.
    const ns = node.styles;
    if (ns) return node.theme ? { display: 'contents' as const, ...ns } : ns;
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

  /*
    A themed node is *applied*, not declared — the same distinction the document root, the scoped
    template wrapper, the theme editor's preview and its role swatches all needed.

    Spreading a theme's parameters into a style object writes its inputs and its role defaults and
    stops there. Everything measured — the per-hue chroma ceilings, a fill moved until a label fits,
    the label chosen against where it landed, the corrected foregrounds, the direction a hover
    travels — happens at apply time and needs a real element to measure against.

    Left out, those variables do not go missing: custom properties inherit, so a themed node rendered
    through the *ambient* theme's measurements. A green theme inside a violet app was drawn with a
    violet's chroma ceilings.
  */
  createEffect(() => {
    const themed = node.theme;
    if (themed && wrapperRef) applyThemeVars(wrapperRef, themed);
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
   * A memo fixes it without costing reactivity: an unrelated prop change now reuses the cached
   * subtree, while the list itself stays live inside `<For>` — see `renderChildren`, which takes an
   * accessor precisely so this memo does not depend on the list's contents.
   *
   * **`hasChildren` is a boolean, and that is the point.** The memo has to know whether there are
   * children at all, because a node with none must pass `undefined` on rather than an empty list: a
   * component asking `props.children ? … : …` would otherwise see a truthy `<For>` and take the
   * wrong branch. Asking it as a boolean means a *changed* list answers the same and stops there,
   * where reading `node.children` here would invalidate this memo on every change and rebuild the
   * whole subtree — which is the fault `renderChildren` describes.
   *
   * Declared after the `$if`/`$each`/`$routes` early returns above, and after the memo-creating prop
   * setup — `createMemo` runs eagerly, so declaring it earlier would build children for nodes that
   * never render them.
   */
  const hasChildren = createMemo(() => !!node.children);
  const childrenEl = createMemo(() => (hasChildren() ? renderChildren(() => node.children) : undefined));

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
