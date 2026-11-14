/**
 * The recording bridge — the half of `crates/renderer/scripts/record-coasys.mjs` that lives inside
 * the page.
 *
 * Mounted only when the URL carries `?record=1` (see `index.tsx`); a normal preview load and every
 * other `?fixture=`/`?fixtureUrl=` render ship without it. What it does is expose `window.__weRecord`:
 * the host's own stores object — the same bag `TemplateProvider` hands the renderer — plus helpers
 * that evaluate a member path or a `$queries` descriptor the way the renderer would. A recorder run
 * drives this object; nothing here runs on its own.
 *
 * The reads go through the same machinery the renderer uses, not a parallel implementation:
 *
 * - member paths resolve through `resolveProp` + `deepUnwrap` from `@we/schema-shared`, evaluated
 *   twice — once against the space-tier filtered bag (what the template can see) and once against
 *   the raw stores (to tell "absent by the tier filter" from "undefined at runtime");
 * - a `$queries` descriptor is token-resolved exactly as `runQuery` in `SchemaRenderer` does —
 *   `when`, `scopeIsAnchored`, `pruneUnresolvedWhere`, `routeQuery` against the backend's own query
 *   adapter, then `Model.findAll` on the space's dataset handle.
 */
import { moduleRegistry, moduleStores } from '@shared/registries/moduleRegistry';
import { buildTemplateBag, CHROME_TIER, SPACE_TIER } from '@shared/registries/templateSurface';
import {
  isValidThemeKey,
  useAccountStore,
  useAppStore,
  useBundleStore,
  useChatStore,
  useClockStore,
  useDatasetStore,
  useDeviceStore,
  useEditorStore,
  useIdentityStore,
  useInterpretationStore,
  usePresenceStore,
  useProfileStore,
  useRecordStore,
  useRouteStore,
  useRuntimeStore,
  useSessionStore,
  useShapeStore,
  useShellStore,
  useSpaceStore,
  useTemplateStore,
  useThemeStore,
  useWorkflowStore,
} from '@we/app-shell/solid';
import { manifestEntries, routeQuery } from '@we/backend-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { deepUnwrap, parseOverrides, pruneUnresolvedWhere, resolveProp, scopeIsAnchored } from '@we/schema-shared';
import { onCleanup, onMount } from 'solid-js';

type Json = Record<string, unknown>;
type Row = Record<string, unknown>;

/** Same signature as `SchemaRenderer`'s: `we-preview` may import it, so it does. */
function deepResolveTokens(params: unknown, stores: Json, context: Json): unknown {
  if (params === null || params === undefined || typeof params !== 'object') return params;
  if (Array.isArray(params)) return params.map((item) => deepResolveTokens(item, stores, context));
  const obj = params as Json;
  const hasTokenKey = Object.keys(obj).some((k) => k.startsWith('$'));
  if (hasTokenKey) return deepUnwrap(resolveProp(obj, stores, context));
  const result: Json = {};
  for (const [k, v] of Object.entries(obj)) result[k] = deepResolveTokens(v, stores, context);
  return result;
}

/**
 * A value as the snapshot stores it — JSON only. Functions and `undefined` are reported back as
 * `{ unserializable }`/`{ undefined }` rather than silently dropped, so the report can say *why* a
 * member is missing instead of leaving a hole.
 */
function serializable(value: unknown, depth = 0): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (value === undefined) return { ok: false, reason: 'undefined' };
  if (typeof value === 'function') return { ok: false, reason: 'function' };
  if (depth > 8) return { ok: false, reason: 'depth-limit' };
  if (value === null || typeof value !== 'object') return { ok: true, value };
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const r = serializable(item, depth + 1);
      out.push(r.ok ? r.value : { $absent: r.reason });
    }
    return { ok: true, value: out };
  }
  const proto = Object.getPrototypeOf(value);
  if (proto && proto !== Object.prototype) {
    // A model instance / classed object: copy own enumerable props plus `id` (prototype getter on
    // the generated classes — see the `normalise` note in SchemaRenderer's runQuery).
    const rec = value as Row;
    const copy: Row = { id: (rec as { id?: unknown }).id, ...rec };
    return serializable(copy, depth + 1);
  }
  const out: Row = {};
  for (const [k, v] of Object.entries(value as Row)) {
    const r = serializable(v, depth + 1);
    if (r.ok) out[k] = r.value;
  }
  /*
    Backend runtime clocks a fixture cannot reach: a workflow item's `since` is `Date.now()` on
    `enter`, whatever the fixture says about record timestamps. Clamp the workflow-state clock keys
    to the fixture epoch so the snapshot is a pure function of the fixture — the relative meaning
    ("this run is sitting in this state") is preserved; only the wall-clock value is pinned.
  */
  if (typeof out.since === 'number') out.since = WORKFLOW_EPOCH_MS;
  if (typeof out.askedAt === 'number') out.askedAt = WORKFLOW_EPOCH_MS;
  if (Array.isArray(out.approvers)) {
    out.approvers = (out.approvers as unknown[]).map((a) =>
      a && typeof a === 'object' ? { ...(a as Row), at: WORKFLOW_EPOCH_MS } : a,
    );
  }
  return { ok: true, value: out };
}

/** `2025-10-01T00:00:00.000Z` — the same epoch `fixture.createdAt` carries, as epoch milliseconds. */
const WORKFLOW_EPOCH_MS = 1759276800000;

export function RecorderBridge() {
  const sessionStore = useSessionStore();
  const accountStore = useAccountStore();
  const runtimeStore = useRuntimeStore();
  const datasetStore = useDatasetStore();
  const profileStore = useProfileStore();
  const editorStore = useEditorStore();
  const appStore = useAppStore();
  const spaceStore = useSpaceStore();
  const shapeStore = useShapeStore();
  const recordStore = useRecordStore();
  const themeStore = useThemeStore();
  const templateStore = useTemplateStore();
  const routeStore = useRouteStore();
  const shellStore = useShellStore();
  const chatStore = useChatStore();
  const presenceStore = usePresenceStore();
  const interpretationStore = useInterpretationStore();
  const clockStore = useClockStore();
  const bundleStore = useBundleStore();
  const workflowStore = useWorkflowStore();
  const identityStore = useIdentityStore();
  const deviceStore = useDeviceStore();

  onMount(() => {
    const stores: Json = {
      sessionStore,
      accountStore,
      runtimeStore,
      datasetStore,
      profileStore,
      editorStore,
      appStore,
      spaceStore,
      shapeStore,
      recordStore,
      themeStore,
      templateStore,
      routeStore,
      shellStore,
      chatStore,
      presenceStore,
      interpretationStore,
      clockStore,
      bundleStore,
      workflowStore,
      identityStore,
      deviceStore,
      modules: moduleStores,
      record: {
        // Never fired during a passive capture — the recorder records the member's existence, not a reply.
        create: () => Promise.resolve({ id: '' }),
        update: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
      clipboard: { copy: () => Promise.resolve() },
      $me: sessionStore.me,
      $modelsPending: (dataset: unknown) =>
        !!dataset && dataset === datasetStore.currentDataset()?.handle && !shapeStore.shapesLoaded(),
      $routeParams: {
        get: (name: string) => routeStore.params()[name],
        set: (name: string, value: string | null) => routeStore.setParam(name, value),
      },
    };

    // The renderer-facing bindings, built the way TemplateProvider's `boundBindings` are: same deps,
    // same getter-delegation onto `stores`, since the connector's ports exist only post-connect.
    const moduleEntries = () => {
      const schemas = sessionStore.backendPorts()?.schemas;
      return schemas ? moduleRegistry.entityEntries(schemas) : [];
    };
    const coreEntries = manifestEntries(CORE_MANIFEST);
    const boundBindings = () =>
      sessionStore.backendPorts()?.dataBindings({
        currentDataset: () => datasetStore.currentDataset()?.handle ?? null,
        currentDatasetEntities: () => [...datasetStore.currentDatasetEntities(), ...coreEntries, ...moduleEntries()],
        profiles: profileStore.profiles,
        profileFor: profileStore.profileFor,
        fetchProfile: profileStore.fetchProfile,
        ephemeral: sessionStore.ephemeralPort,
      });
    for (const key of [
      '$getEntity',
      '$getEntityForDataset',
      '$currentDataset',
      '$identities',
      '$queryAdapter',
      '$ephemeral',
    ]) {
      Object.defineProperty(stores, key, {
        enumerable: true,
        get: () => (boundBindings() as Json | undefined)?.[key],
      });
    }

    // The space-tier filtered bag — what the bundle's expressions actually see — and the chrome bag
    // the app shell's own surfaces see (they read members a space template may not).
    const bag = buildTemplateBag(stores, { grants: SPACE_TIER, gesture: 'enforce' }) as unknown as Json;
    const chromeBag = buildTemplateBag(stores, { grants: CHROME_TIER, gesture: 'enforce' }) as unknown as Json;

    /**
     * Evaluate a store path or expression the way a `{ $: … }` prop resolves it — against the
     * filtered bag — and answer `{ ok, value | reason }`. `raw` repeats the read unfiltered so the
     * report can name the difference.
     */
    const read = (expr: string, scope: 'space' | 'chrome' | 'raw' = 'space') => {
      try {
        const target = scope === 'raw' ? stores : scope === 'chrome' ? chromeBag : bag;
        const resolved = deepUnwrap(resolveProp({ $: expr }, target, {}));
        return serializable(resolved);
      } catch (error) {
        return { ok: false as const, reason: `threw: ${(error as Error).message}` };
      }
    };

    /**
     * One `$queries` entry, run the way `runQuery` does. Answers
     * `{ ok, rows | skipped | error }`; rows are serialised model instances.
     */
    const runQuery = async (descriptor: Json, context: Json = {}) => {
      try {
        const { entity, subscribe: _sub, dataset: datasetPath, include, when, ...params } = descriptor;

        let p: unknown = null;
        if (typeof datasetPath === 'string' && datasetPath) {
          let target: unknown = stores;
          for (const part of datasetPath.split('.')) target = (target as Json)?.[part];
          p = typeof target === 'function' ? (target as () => unknown)() : target;
          if (p && typeof p === 'object' && 'handle' in p) p = (p as { handle: unknown }).handle;
        } else {
          const currentDataset = stores.$currentDataset as (() => unknown) | undefined;
          p = typeof currentDataset === 'function' ? currentDataset() : null;
        }
        if (!p) return { ok: false as const, reason: 'no-dataset' };

        if (when !== undefined && !deepResolveTokens(when, stores, context)) {
          return { ok: true as const, skipped: 'when' };
        }

        const resolvedParams = deepResolveTokens(params, stores, context) as Json;
        if (resolvedParams.where && typeof resolvedParams.where === 'object') {
          const pruned = pruneUnresolvedWhere(resolvedParams.where as Json);
          if (pruned) resolvedParams.where = pruned;
          else delete resolvedParams.where;
        }
        // An unanchored scope is treated as a falsy `when` by the renderer — not asked at all.
        if (resolvedParams.scope !== undefined && !scopeIsAnchored(resolvedParams.scope)) {
          return { ok: true as const, skipped: 'unanchored-scope', request: resolvedParams };
        }
        if (include !== undefined) resolvedParams.include = deepResolveTokens(include, stores, context);

        const entityName =
          typeof entity === 'string' ? entity : (deepResolveTokens(entity, stores, context) as string | undefined);
        if (!entityName) return { ok: false as const, reason: 'no-entity' };

        const adapter = stores.$queryAdapter;
        if (typeof adapter !== 'object' || adapter === null) return { ok: false as const, reason: 'no-query-adapter' };
        const routed = routeQuery({ entity: entityName, ...resolvedParams }, adapter as never);
        if (!routed.ok) return { ok: false as const, reason: `routed-error: ${routed.error}` };

        const getEntity = stores.$getEntity as
          ((name: string) => { findAll(d: unknown, o: Json): Promise<Row[]> }) | undefined;
        const getEntityForDataset = stores.$getEntityForDataset as
          ((name: string, d: unknown) => { findAll(d: unknown, o: Json): Promise<Row[]> } | undefined) | undefined;
        if (!getEntity) return { ok: false as const, reason: 'no-get-entity' };
        const Model = getEntityForDataset?.(entityName, p) ?? getEntity(entityName);
        const rows = await Model.findAll(p, routed.options as Json);
        const normalise = rows.map((row) => ({ id: (row as { id?: unknown }).id, ...(row as Row) }));
        const s = serializable(normalise);
        if (!s.ok) return { ok: false as const, reason: `serialize: ${s.reason}` };
        // The full resolved request the answer belongs to — the identity a snapshot keys on,
        // not the local query name: two surfaces asking `signalTypes` with different sorts are
        // two different questions.
        return { ok: true as const, request: { entity: entityName, ...resolvedParams }, rows: s.value as Row[] };
      } catch (error) {
        return { ok: false as const, reason: `threw: ${(error as Error).message}` };
      }
    };

    (window as unknown as Json).__weRecord = {
      evaluate: (expr: string) => read(expr),
      evaluateRaw: (expr: string) => read(expr, 'raw'),
      evaluateChrome: (expr: string) => read(expr, 'chrome'),
      runQuery,
      agentProfile: (did: string) => {
        const identities = stores.$identities as { get?: (id: string) => unknown } | undefined;
        const found = identities?.get?.(did);
        return serializable(found);
      },
      navigate: (path: string) => routeStore.navigate(path),
      setParam: (name: string, value: string | null) => routeStore.setParam(name, value),
      params: () => ({ ...routeStore.params() }),
      path: () => routeStore.currentPath(),
      // `setDefaultTheme`'s boolean reaches the caller — a failed settings write must fail the
      // recorder, not read back as success because the request was made.
      setTheme: (themeId: string) => themeStore.setDefaultTheme(themeId),
      theme: () => themeStore.defaultThemeId(),
      /*
        What the theme system actually applied, as opposed to what it was asked for. `resolved`
        is the ThemeData `currentTheme` settled on — the lookup misses an unknown id and falls
        back (to `light`), which is exactly the silent failure a screenshot must not survive.
        `expectedAttr` recomputes the base name `applyThemeToDOM` stamps on documentElement;
        `documentAttr`/`scopeAttr` are what the DOM carries now.
      */
      appliedTheme: () => {
        const resolved = themeStore.currentTheme();
        const themeName = parseOverrides(resolved.overrides).themeName;
        return {
          requested: themeStore.currentThemeId(),
          resolved: resolved.id,
          expectedAttr: themeName ?? (isValidThemeKey(resolved.id) ? resolved.id : 'light'),
          documentAttr: document.documentElement.getAttribute('data-we-theme'),
          scopeAttr: document.querySelector('[data-we-theme-scope]')?.getAttribute('data-we-theme') ?? null,
        };
      },
      openShellView: (view: string) => shellStore.openShellView(view),
      closeShellView: (_view?: string) => shellStore.closeShellView(),
      booted: () => sessionStore.bootState?.() === 'ready',
      datasetId: () => datasetStore.currentDataset()?.id ?? null,
    };
  });

  // The global exists for exactly the bridge's lifetime — a page navigating away or the flag
  // flipping leaves nothing behind.
  onCleanup(() => {
    delete (window as unknown as Json).__weRecord;
  });

  // No UI — a mounted provider component exists to publish `__weRecord` and nothing else.
  return null;
}
