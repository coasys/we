/**
 * The graph's data binding — the one place that knows both the graph and the backend.
 *
 * `@we/graph-core` and its expanders reach the data layer through a three-function port
 * (`query` / `defaultDataset` / `models`), so nothing in the graph system imports a backend. This
 * file supplies that port from the host's stores, which is why it lives in `app-shell` rather than in
 * a graph package: the graph should be portable, and the knowledge of how *this* deployment reads data
 * is exactly what must not travel with it.
 */
/*
  The graph's own stylesheet, imported here because this is the only place the app mounts a graph.

  `@we/graph-solid` ships it as a separate entry rather than injecting it, which is right for a
  package that must not assume a bundler — but it means a host that forgets the import gets a graph
  that *renders and is invisible*. Every element is in the DOM with the right classes and the right
  CSS custom properties on it, and none of them mean anything: no `position: absolute`, so nodes
  stack in flow instead of at their coordinates; no size or background on the dot, so marks vanish
  and only their labels survive; no stroke on the edges. It reads as a broken layout engine rather
  than a missing file. The graph-explorer playground had the import and the app never did.
*/
import '@we/graph-solid/styles';

import type { EntityClass, EntityManifestEntry, QueryOptions } from '@we/backend-shared';
import { manifestEntries, trace } from '@we/backend-shared';
import { BlockRenderer } from '@we/block-solid';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { placementStyle } from '@we/graph-expanders';
import type { EntityShape, GraphNode, GraphValue, WatchQuery } from '@we/graph-protocol';
import { GraphView, type GraphViewProps } from '@we/graph-solid';
import { createMemo, Show } from 'solid-js';

import { useDatasetStore } from '../stores/DatasetStore';
import { useProfileStore } from '../stores/ProfileStore';
import { useRecordStore } from '../stores/RecordStore';
import { useSessionStore } from '../stores/SessionStore';

/**
 * How many rows a reverse lookup will read before giving up.
 *
 * "What points at this?" has no target-side form in the ORM the query path lowers onto, so it is
 * answered by reading candidate instances and filtering them here. That is a scan, and it is capped
 * and *reported* rather than left to be discovered as slowness on a large space — the graph shows the
 * warning in its status strip.
 *
 * The real fix is a target-side query at the adapter (`?source <predicate> <target>` is one SPARQL
 * pattern, and `scope` already resolves a relation to its predicate). When that lands this constant
 * and the scan below go together.
 */
const REVERSE_SCAN_LIMIT = 200;

interface ScopeRequest {
  anchor: string;
  via: string;
  anchorId: string;
  direction?: 'in' | 'out';
}

/** Translate a backend model manifest entry into the neutral shape the graph reads. */
function toEntityShape(entry: EntityManifestEntry): EntityShape {
  const properties: EntityShape['properties'] = [];
  const relations: EntityShape['relations'] = [];

  for (const property of entry.properties) {
    if (property.relatedEntity) {
      relations.push({
        name: property.name,
        target: property.relatedEntity,
        cardinality: property.isCollection ? 'many' : 'one',
      });
    } else {
      properties.push({
        name: property.name,
        type: property.type,
        ...(property.required ? { required: true } : {}),
      });
    }
  }

  return { name: entry.name, properties, relations };
}

/**
 * A card that draws its own contents, rather than its first sixty characters.
 *
 * The `content: 'block'` a board's style rules name. It lives here, not in the graph package, which
 * is the point of the `nodeContent` seam: `BlockRenderer` drags in the block system and the design
 * system, and a graph engine that imported any of that would stop being portable.
 *
 * `editorState` is already on the node — it is a declared string property, so the row the seed
 * fetched carried it into `data` — and handed over exactly as it arrived. A file-backed property
 * resolves to a `data:…;base64,…` blob rather than to JSON, and `BlockRenderer` already knows to
 * decode a string; parsing it here first threw on every card and rendered nothing, which is why they
 * all looked empty.
 *
 * ## Why it draws the label when there is no document
 *
 * A style rule names `content` for every card it matches, and a board holds more than one kind of
 * record: the workshop board is `TaskBlock`s and `EventBlock`s beside composed cards, and only a
 * `CollectionBlock` has an `editorState` at all. The renderer's own fallback does not cover this —
 * it draws the label when the *component* is missing, which is not the same as a component that
 * renders nothing — so a freshly extracted task arrived as a card with nothing in it, and a board of
 * them read as an empty canvas. That is the worst possible rendering of "extraction worked".
 *
 * The same class the renderer's fallback uses, so a card that falls back here is indistinguishable
 * from one whose rule never asked for content.
 */
function BlockCard(props: { node: GraphNode }) {
  const datasetStore = useDatasetStore();

  const editorState = createMemo(() => {
    const raw = props.node.data?.editorState;
    return typeof raw === 'string' && raw ? raw : undefined;
  });

  return (
    <Show when={editorState()} fallback={<span class="we-graph__card-text">{props.node.label}</span>}>
      {(state) => <BlockRenderer editorState={state() as never} perspective={datasetStore.currentDataset()?.handle} />}
    </Show>
  );
}

export function GraphHost(props: Omit<GraphViewProps, 'host'>) {
  const datasetStore = useDatasetStore();
  const recordStore = useRecordStore();
  const sessionStore = useSessionStore();
  const profileStore = useProfileStore();

  /**
   * The neutral read surface, built the same way the template renderer builds its own.
   *
   * A second call rather than a shared instance because `dataBindings` is a pure adaptation — it maps
   * the backend's model statics onto `query`/`findAll` and pairs them with a capability profile, and
   * holds no cache of its own. The one genuinely shared thing it is handed, the ephemeral port, comes
   * from the session store either way.
   */
  const bindings = createMemo(() =>
    sessionStore.backendPorts()?.dataBindings({
      currentDataset: () => datasetStore.currentDataset()?.handle ?? null,
      currentDatasetEntities: () => datasetStore.currentDatasetEntities(),
      profiles: profileStore.profiles,
      fetchProfile: profileStore.fetchProfile,
      ephemeral: sessionStore.ephemeralPort,
    }),
  );

  /**
   * Every entity the graph may draw or traverse — WE's own vocabulary *and* whatever else the
   * dataset holds.
   *
   * `currentDatasetEntities` is **foreign schemas only**: everything WE knows natively is deliberately
   * absent from it, because a native model is already registered globally and re-fetching its shape
   * would be wasted work. Reading it as "the dataset's models" is a mistake this codebase has now
   * made three times, and here it broke two things at once. The schema map showed only the classes
   * some *other* app had written into the space — in a space with a call in it, exactly
   * `InterpretationOverlay` and `InterpretationRun` — and `parentFor` could not resolve
   * `CollectionBlock.children`, so no container would open into anything.
   *
   * Core first, so a foreign schema that happens to share a name cannot shadow WE's own.
   */
  const manifest = createMemo(() => {
    const core = manifestEntries(CORE_MANIFEST);
    const known = new Set(core.map((entry) => entry.name));
    return [...core, ...datasetStore.currentDatasetEntities().filter((entry) => !known.has(entry.name))];
  });

  function modelFor(entity: string, dataset?: string): EntityClass | undefined {
    const bound = bindings();
    if (!bound) return undefined;
    // Dataset-scoped resolution first: a foreign shape only exists as a class synthesised for the
    // perspective it came from, so a name-only lookup would miss exactly the models a knowledge map
    // is most likely to be built on.
    const handle =
      dataset && dataset !== datasetStore.currentDataset()?.id
        ? datasetStore.datasets().find((d) => d.id === dataset || d.sharedId === dataset)?.handle
        : datasetStore.currentDataset()?.handle;
    return bound.$getEntitiesForPerspective?.(entity, handle) ?? bound.$getEntity?.(entity);
  }

  /**
   * A neutral read, as the ORM's options — the one translation, shared by the fetch and the watch.
   *
   * They must not drift: a watch subscribes in order to fingerprint the rows the fetch would
   * return, so a difference between the two is a change the graph is never told about. `undefined`
   * means the read resolves to nothing at all, which is a scope this dataset cannot name.
   */
  function queryOptions(request: WatchQuery): QueryOptions | undefined {
    const { where, order, limit, offset, include, scope } = request;
    const options: QueryOptions = {};
    if (where) options.where = where;
    if (order) options.order = order;
    if (limit !== undefined) options.limit = limit;
    if (offset !== undefined) options.offset = offset;
    if (include) options.include = include;
    if (scope) {
      const parent = parentFor(scope);
      if (!parent) return undefined;
      (options as Record<string, unknown>).parent = parent;
    }
    return options;
  }

  /** Resolve a neutral drill-down to the parent handle the ORM takes. Mirrors the query adapter. */
  function parentFor(scope: ScopeRequest): { id: string; predicate: string } | undefined {
    const entry = manifest().find((m) => m.name === scope.anchor);
    const property = entry?.properties.find((p) => p.name === scope.via);
    if (!property) return undefined;
    return { id: scope.anchorId, predicate: property.predicate };
  }

  /**
   * Answer "what points at this?" by reading candidates and filtering here.
   *
   * Deliberately explicit about being a scan: it is capped, and it tells the graph so the cost is
   * visible in the UI rather than only in a profile.
   */
  async function reverseLookup(
    entity: string,
    scope: ScopeRequest,
    dataset: string | undefined,
    warn: (message: string) => void,
  ): Promise<Record<string, unknown>[]> {
    const model = modelFor(entity, dataset);
    const handle = datasetStore.currentDataset()?.handle;
    if (!model || !handle) return [];

    warn(`reading what points at ${scope.anchor} by scanning up to ${REVERSE_SCAN_LIMIT} ${entity} records`);

    const rows = await model.findAll(handle, {
      limit: REVERSE_SCAN_LIMIT,
      include: { [scope.via]: true },
    } as QueryOptions);

    return (rows as Record<string, unknown>[]).filter((row) => {
      const value = row[scope.via];
      const targets = Array.isArray(value) ? value : value == null ? [] : [value];
      return targets.some((target) =>
        typeof target === 'string'
          ? target === scope.anchorId
          : typeof target === 'object' && target !== null && (target as { id?: unknown }).id === scope.anchorId,
      );
    });
  }

  const host: GraphViewProps['host'] = {
    nodeContent: { block: BlockCard },

    /**
     * What the board has just written and not yet seen come back.
     *
     * Named through `placementStyle`, the board seed's own mapping, so an optimistic field and a
     * seeded one are the same field — two copies of that naming would drift, and the copy that fell
     * behind would write a key nothing reads, leaving the card unchanged until the round trip landed
     * with no sign of why.
     */
    pendingData: () => {
      const pending = recordStore.pendingCardStyle();
      const out: Record<string, Record<string, GraphValue>> = {};
      for (const [nodeId, patch] of Object.entries(pending)) out[nodeId] = placementStyle(patch);
      return out;
    },

    /*
      The graph has caught up on these, so the store can stop standing in for them.

      Reported from the drawn node rather than judged here, and the difference is visible: a read
      landing is not the same moment as a card being redrawn from it — there is the rest of a seed
      in between — so clearing where the rows arrive put the old value back for that whole window.
    */
    confirmPending: (recordIds) => recordStore.confirmPending(recordIds),

    /**
     * Tell the graph when the answer to one of its reads changes here.
     *
     * The same live path `$query` uses — `EntityClass.query(...).subscribe(...)` — which is why a
     * post appears in the cards route the moment it is written. The graph took `findAll` instead,
     * so it read once and never again; that is the whole difference between a map of a space and a
     * picture of one.
     *
     * ## Why it subscribes to the seed's own query
     *
     * It used to subscribe to `{ limit: 1 }` over the type, on the reasoning that the rows are
     * thrown away and only the notification matters. That is not what an AD4M model subscription
     * is. It re-runs *its own* query on a change and fingerprints the rows, and calls back **only
     * when that fingerprint differs** — so a one-row probe over a type is silent for every change
     * that leaves its single row alone. A space with one task in it already: extract a second, and
     * the probe's answer is the same first row, so nothing fires and the board stays as loaded.
     * The extraction panel beside it updated, because its `$query` subscribes to its own narrower
     * question and that question's answer really had changed — which is what made this look like a
     * board bug rather than a notification one.
     *
     * So the engine hands over the read it made and this subscribes to exactly that. The rows are
     * still thrown away; what they are for is the fingerprint, and it now covers the same records
     * the seed drew. Cost is one subscription per distinct read — four for a board — each paging
     * exactly what the seed would have fetched anyway.
     */
    watch(request, onChange) {
      const model = modelFor(request.entity, request.dataset);
      const handle = datasetStore.currentDataset()?.handle;
      if (!model || !handle) {
        // A watch that never attached is the other silence: the graph then never hears about
        // anything, and looks exactly like a graph whose data has not changed.
        trace('graph', 'watch:not-attached', {
          entity: request.entity,
          model: Boolean(model),
          handle: Boolean(handle),
        });
        return () => undefined;
      }

      const options = queryOptions(request);
      // A read whose scope cannot be resolved reads as nothing; watching it would be a subscription
      // to a question with no answer.
      if (!options) return () => undefined;
      trace('graph', 'watch', { entity: request.entity, parent: (options as { parent?: { id?: string } }).parent?.id });

      let live = true;
      /*
        The first delivery is the current state, not a change.

        `subscribe` resolves with the initial page *and* invokes the callback, so treating every
        invocation as a change makes the graph refresh once per watched type immediately after
        loading — re-running every seed query for a state it already has. `pending` covers the
        genuine race: a write landing before the initial page resolves is a real change, and
        dropping it would lose exactly the update that arrived while the graph was opening.
      */
      let primed = false;
      let pending = false;

      const subscription = model.query(handle, options);
      subscription
        .subscribe(() => {
          if (!live) return;
          if (!primed) {
            pending = true;
            return;
          }
          onChange();
        })
        .then(() => {
          primed = true;
          if (live && pending) onChange();
        })
        .catch((error: unknown) => {
          // A type this backend will not subscribe to leaves the graph as loaded rather than
          // taking it down — the same degradation every other read here makes.
          console.warn(`[graph] cannot watch ${request.entity}:`, error);
        });

      return () => {
        live = false;
        subscription.dispose();
      };
    },

    /*
      The same `graph` scope the reads above report into, so one `we:trace` switch covers the whole
      path: what a seed asked the backend, and what it made of the answer. Rows arriving and nodes
      appearing are two different claims, and until both are on one timeline the gap between them
      is invisible.
    */
    trace: (event, detail) => trace('graph', event, detail),

    defaultDataset: () => {
      const current = datasetStore.currentDataset();
      // Prefer the shared id: it is identical on every agent, which is what makes a node address
      // minted here mean the same thing to a peer. Local uuid only when there is no shared id.
      return current ? (current.sharedId ?? current.id) : null;
    },

    models: () => manifest().map(toEntityShape),

    async query(request) {
      const { entity, dataset, scope, where, order, limit, offset, include } = request as {
        entity: string;
        dataset?: string;
        scope?: ScopeRequest;
        where?: Record<string, unknown>;
        order?: Record<string, 'asc' | 'desc'>;
        limit?: number;
        offset?: number;
        include?: Record<string, unknown>;
      };

      const handle = datasetStore.currentDataset()?.handle;
      if (!handle) return [];

      if (scope?.direction === 'in') {
        // The graph collects warnings through its own context; throwing here would take down the
        // whole expansion for a lookup that is legitimately unavailable on some backends.
        return reverseLookup(entity, scope, dataset, (message) => console.warn(`[graph] ${message}`));
      }

      const model = modelFor(entity, dataset);
      /*
        Both of these return nothing and say nothing, which is how a board comes to draw an empty
        canvas over a space full of records. The seed cannot report them — it never learns *why* a
        read was empty — so they are traced here, where the reason is known.

        Turned on with `localStorage.setItem('we:trace', 'graph')` and a reload; every read then
        prints its entity, the parent it asked under and how many rows came back. See
        `installConsoleTrace`.
      */
      if (!model) {
        trace('graph', 'read:no-model', { entity, dataset });
        return [];
      }

      const options = queryOptions({ entity, dataset, where, order, limit, offset, include, scope });
      if (!options) {
        trace('graph', 'read:unresolved-scope', { entity, scope });
        return [];
      }

      const rows = await model.findAll(handle, options);
      trace('graph', 'read', {
        entity,
        rows: (rows as unknown[]).length,
        parent: (options as { parent?: { id?: string } }).parent?.id,
        where,
        limit,
      });
      return rows as Record<string, unknown>[];
    },
  };

  return <GraphView {...props} host={host} />;
}

export default GraphHost;
