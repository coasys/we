/**
 * The graph's data binding — the one place that knows both the graph and the backend.
 *
 * `@we/graph-core` and its expanders reach the data layer through a three-function port
 * (`query` / `defaultDataset` / `models`), so nothing in the graph system imports a backend. This
 * file supplies that port from the host's stores, which is why it lives in `app-shell` rather than in
 * a graph package: the graph should be portable, and the knowledge of how *this* deployment reads data
 * is exactly what must not travel with it.
 */
import type { ModelClass, ModelManifestEntry, QueryOptions } from '@we/backend-shared';
import type { EntityShape } from '@we/graph-protocol';
import { GraphView, type GraphViewProps } from '@we/graph-solid';
import { createMemo } from 'solid-js';

import { useDatasetStore } from '../stores/DatasetStore';
import { useProfileStore } from '../stores/ProfileStore';
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
function toEntityShape(entry: ModelManifestEntry): EntityShape {
  const properties: EntityShape['properties'] = [];
  const relations: EntityShape['relations'] = [];

  for (const property of entry.properties) {
    if (property.relatedModel) {
      relations.push({
        name: property.name,
        target: property.relatedModel,
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

export function GraphHost(props: Omit<GraphViewProps, 'host'>) {
  const datasetStore = useDatasetStore();
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
      currentDatasetModels: () => datasetStore.currentDatasetModels(),
      profiles: profileStore.profiles,
      fetchProfile: profileStore.fetchProfile,
      ephemeral: sessionStore.ephemeralPort,
    }),
  );

  const manifest = () => datasetStore.currentDatasetModels();

  function modelFor(entity: string, dataset?: string): ModelClass | undefined {
    const bound = bindings();
    if (!bound) return undefined;
    // Dataset-scoped resolution first: a foreign shape only exists as a class synthesised for the
    // perspective it came from, so a name-only lookup would miss exactly the models a knowledge map
    // is most likely to be built on.
    const handle =
      dataset && dataset !== datasetStore.currentDataset()?.id
        ? datasetStore.datasets().find((d) => d.id === dataset || d.sharedId === dataset)?.handle
        : datasetStore.currentDataset()?.handle;
    return bound.$getModelForPerspective?.(entity, handle) ?? bound.$getModel?.(entity);
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
      if (!model) return [];

      const options: QueryOptions = {};
      if (where) options.where = where;
      if (order) options.order = order;
      if (limit !== undefined) options.limit = limit;
      if (offset !== undefined) options.offset = offset;
      if (include) options.include = include;
      if (scope) {
        const parent = parentFor(scope);
        if (!parent) return [];
        (options as Record<string, unknown>).parent = parent;
      }

      const rows = await model.findAll(handle, options);
      return rows as Record<string, unknown>[];
    },
  };

  return <GraphView {...props} host={host} />;
}

export default GraphHost;
