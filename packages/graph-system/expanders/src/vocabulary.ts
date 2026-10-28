/**
 * The vocabulary — what a space has defined, rather than what it holds, as a map.
 *
 * A space's own words live in records nothing on its canvas points at: the signal types a starter
 * wrote, its task states, the kinds of part somebody can have in a record, its connection kinds, its
 * models, its workflows. They are found by type, never by containment, so a canvas seeded from the space's
 * collection cannot reach them. This draws them in **buckets** — one per kind of vocabulary, in the
 * order and words the interface names — and each bucket opens into what is in it.
 *
 * ## A seed and an expander, sharing what the seed was told
 *
 * The buckets are given, not discovered: which kinds of vocabulary there are, what each is called,
 * and — for the two that are not records here — the models and workflows themselves. An expander receives
 * an id and nothing else, so the pair is made together and the expander reads what the seed last
 * received. Made per graph, like every plugin (`defaultExpanders`), so two graphs on a page cannot see
 * each other's buckets.
 *
 * ## Three kinds of bucket
 *
 * - **Records of an entity** — `entity: 'SignalType'`. Opened by asking for them.
 * - **Models** — `models: [{ name }]`, opened into type nodes, which `schema-properties` opens in turn.
 * - **Workflows** — `workflows: [{ name, steps, moves }]`, opened into one node per workflow, and each workflow into its
 *   steps, with a line for each move between them.
 * - **Items** — `items: [{ id, label }]`, for what a space has defined that is neither records of one
 *   type nor models — its policy's rules — opened into one node each, with nothing further inside.
 *
 * Everything a bucket opens into carries the bucket's key as `data.bucket`, as the bucket does, so a
 * style rule can light one kind of word and what is in it.
 */
import type { Expander, GraphEdge, GraphNode, SeedSource } from '@we/graph-protocol';
import { clusterAddress, entityAddress, nodeTypeOf, parseAddress } from '@we/graph-protocol';

import { edgeId, rowToNode } from './nodes';
import { SCHEMA_TYPE } from './schema';

/** The node type of a bucket, a workflow and one of its steps. */
export const VOCABULARY_TYPE = 'vocabulary';
export const WORKFLOW_TYPE = 'workflow';

/** The type of an item bucket's members — see `items`. */
export const ITEM_TYPE = 'vocabulary-item';
export const WORKFLOW_STATE_TYPE = 'workflow-step';

export interface VocabularyWorkflow {
  name: string;
  label: string;
  steps: { name: string; label: string; final?: boolean }[];
  moves: { from: string; to: string }[];
}

export interface VocabularyBucket {
  /** Unique among the buckets; part of the bucket's address, so it must not change between loads. */
  key: string;
  label: string;
  /** Records of this entity are what is in the bucket. */
  entity?: string;
  /** What one of those records opens into: its uses — see `VocabularyUses`. */
  opens?: VocabularyUses;
  /** Or these models. */
  models?: { name: string; label?: string }[];
  /** Or these workflows. */
  workflows?: VocabularyWorkflow[];
  /** Or these items, which are nothing to open. */
  items?: { id: string; label: string }[];
}

/**
 * What a definition opens into on the map: the records made with it, newest first.
 *
 * The records of `entity` whose `field` holds the definition's `key`. A task state opens into the tasks
 * in it — `{ entity: 'TaskBlock', field: 'status', key: 'slug' }` — which is what somebody opening "To
 * do" on a map of the space's words is asking to see. Three more words for the kinds whose use is a
 * step removed:
 *
 * - `through` — the field is on a record linked by this relation, so a signal type opens into the
 *   records reacted to with it: `{ entity: [...], through: 'signals', field: 'signalTypeId', key: 'id' }`.
 * - `follow` — draw the record this relation of each row names rather than the row: an involvement
 *   kind opens into the records somebody is involved in that way, not into the involvements.
 * - `pair` — caption each row by the records at the ends of these two relations, "A → B": a kind of
 *   connection opens into its connections, which have no name of their own.
 */
export interface VocabularyUses {
  entity: string | string[];
  field: string;
  key: string;
  through?: string;
  follow?: string;
  pair?: [string, string];
  /** The line's word. Default `field`. */
  label?: string;
  /** How many to draw. Default the seed's `limit`. */
  limit?: number;
}

export interface VocabularySeedOptions {
  buckets: VocabularyBucket[];
  dataset?: string;
  /** Records read per entity bucket. Default 200 — a vocabulary is a few dozen words, not a feed. */
  limit?: number;
}

/** A workflow step's address. The workflow's name and the step's are both part of it, so steps of two workflows never meet. */
const stepAddress = (workflow: string, step: string) => clusterAddress(WORKFLOW_STATE_TYPE, `${workflow}\u0000${step}`);

export function vocabularyPlugins(): { seed: SeedSource; expander: Expander; records: Expander } {
  /** What the seed was last told, per dataset, for the expander to answer from. */
  const told = new Map<string, VocabularySeedOptions>();
  const datasetOf = (options: VocabularySeedOptions | undefined, fallback: string | null) =>
    options?.dataset ?? fallback ?? '';

  const seed: SeedSource = {
    id: 'vocabulary',
    description:
      'Draws what a space has defined — its signal types, states, kinds, models and workflows — in buckets that open.',
    async seed(rawOptions, context) {
      const options = (rawOptions ?? { buckets: [] }) as VocabularySeedOptions;
      const dataset = datasetOf(options, context.defaultDataset());
      told.set(dataset, options);
      const buckets = options.buckets ?? [];
      const limit = options.limit ?? 200;
      /*
        How much is in each, read now rather than when it is opened: a category with nothing in it is
        offered no caret, and the categories are ranked by it, fullest first, so the empty ones end up
        at the far end. A vocabulary is a few dozen words, so this is a handful of small reads.
      */
      const counts = await Promise.all(
        buckets.map(async (bucket) => {
          if (bucket.models) return bucket.models.length;
          if (bucket.workflows) return bucket.workflows.length;
          if (bucket.items) return bucket.items.length;
          if (!bucket.entity) return 0;
          const rows = await context.query({ entity: bucket.entity, dataset, limit }).catch(() => null);
          // Unreadable is not empty: it keeps its caret, and says why when opened.
          return rows ? rows.length : undefined;
        }),
      );
      // Fullest first; the order given between equals, so the settings' order still decides most of it.
      const rank = buckets.map((_, index) => index).sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a - b);
      const nodes: GraphNode[] = buckets.map((bucket, index) => ({
        id: clusterAddress(VOCABULARY_TYPE, bucket.key),
        kind: 'cluster',
        type: VOCABULARY_TYPE,
        label: bucket.label,
        data: {
          bucket: bucket.key,
          // Its place among the categories, for a layout to keep — a node id sorts alphabetically.
          order: rank.indexOf(index),
          ...(counts[index] !== undefined ? { count: counts[index]! } : {}),
        },
        ...(counts[index] === 0 ? { leaf: true } : {}),
        source: 'vocabulary',
      }));
      return { nodes, edges: [], total: nodes.length };
    },
  };

  /** A definition a bucket's `opens` names, opened into the records made with it — see `VocabularyUses`. */
  async function openRecord(
    request: Parameters<Expander['expand']>[0],
    context: Parameters<Expander['expand']>[1],
    address: { type?: string; id?: string },
    options: VocabularySeedOptions | undefined,
  ) {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const opens = options?.buckets.find((b) => b.entity && b.entity === address.type)?.opens;
    if (!opens || !address.type || !address.id) return { nodes, edges };
    const dataset = context.defaultDataset() ?? '';
    const [record] = await context.query({
      entity: address.type,
      dataset,
      where: { id: address.id },
      limit: 1,
      signal: request.signal,
    });
    const value = record?.[opens.key];
    if (value === undefined || value === null || value === '') return { nodes, edges };
    const limit = opens.limit ?? options?.limit ?? 200;
    const entities = Array.isArray(opens.entity) ? opens.entity : [opens.entity];
    const include = {
      ...(opens.follow ? { [opens.follow]: true } : {}),
      ...(opens.pair ? { [opens.pair[0]]: true, [opens.pair[1]]: true } : {}),
    };
    const rows = await context.query({
      entity: opens.entity,
      dataset,
      where: opens.through ? { [opens.through]: { some: { [opens.field]: value } } } : { [opens.field]: value },
      order: { createdAt: 'desc' },
      limit,
      ...(Object.keys(include).length ? { include } : {}),
      signal: request.signal,
    });
    const shapeOf = (entity: string | undefined) => context.models(dataset).find((s) => s.name === entity);
    // A row's own entity: the one asked for, or — over several — the one it was read as.
    const typeOf = (row: Record<string, unknown>, fallback?: string) => nodeTypeOf(row) ?? fallback ?? entities[0];
    const nameOf = (row: unknown) => {
      if (!row || typeof row !== 'object') return '';
      const type = typeOf(row as Record<string, unknown>);
      return rowToNode(row as Record<string, unknown>, type, dataset, shapeOf(type), 'vocabulary')?.label ?? '';
    };
    const seen = new Set<string>();
    for (const row of rows) {
      const subject = opens.follow ? row[opens.follow] : row;
      if (!subject || typeof subject !== 'object') continue;
      const type = typeOf(subject as Record<string, unknown>, opens.follow ? undefined : entities[0]);
      const node = rowToNode(subject as Record<string, unknown>, type, dataset, shapeOf(type), 'vocabulary');
      // Two involvements of one kind in the same record are one use of it.
      if (!node || seen.has(node.id)) continue;
      seen.add(node.id);
      if (opens.pair) node.label = `${nameOf(row[opens.pair[0]]) || '?'} → ${nameOf(row[opens.pair[1]]) || '?'}`;
      // A use is the end of a word's branch: on a map of words there is nothing further to open.
      nodes.push({ ...node, leaf: true });
      edges.push({
        id: edgeId(request.id, 'instance', node.id),
        source: request.id,
        target: node.id,
        type: 'instance',
        // What put it there — "status" for a state's tasks — which is what the line means.
        label: opens.label ?? opens.field,
      });
    }
    if (rows.length === limit) context.warn(`showing the latest ${limit} here`);
    return { nodes, edges, total: nodes.length };
  }

  /*
    A separate expander, because what it claims is a different question. The buckets and the workflows are
    two cluster types; a word's records hang off records of any type at all. One expander claiming both
    had to claim every cluster to reach the records, and offered a caret on a workflow's steps that opened
    nothing — a caret is offered wherever an expander says it can open.
  */
  const records: Expander = {
    id: 'vocabulary-records',
    kinds: ['entity'],
    description:
      'Opens a word on a vocabulary map into the records made with it — a task state into its tasks, a signal type into what was reacted to.',
    async expand(request, context) {
      const address = parseAddress(request.id);
      if (!address || !address.id || request.direction === 'in') return { nodes: [], edges: [] };
      const dataset = context.defaultDataset() ?? '';
      return openRecord(request, context, address, told.get(dataset) ?? [...told.values()][0]);
    },
  };

  const expander: Expander = {
    id: 'vocabulary',
    kinds: ['cluster'],
    types: [VOCABULARY_TYPE, WORKFLOW_TYPE],
    description: 'Opens a vocabulary bucket into what is in it, and a workflow into its steps and moves.',
    async expand(request, context) {
      const address = parseAddress(request.id);
      if (!address || address.kind !== 'cluster' || !address.id || request.direction === 'in') {
        return { nodes: [], edges: [] };
      }
      const dataset = context.defaultDataset() ?? '';
      const options = told.get(dataset) ?? [...told.values()][0];
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      const contain = (node: GraphNode) => {
        nodes.push(node);
        edges.push({
          id: edgeId(request.id, 'contains', node.id),
          source: request.id,
          target: node.id,
          type: 'contains',
        });
      };

      if (address.type === WORKFLOW_TYPE) {
        const workflow = options?.buckets.flatMap((b) => b.workflows ?? []).find((f) => f.name === address.id);
        if (!workflow) return { nodes, edges };
        for (const step of workflow.steps) {
          contain({
            id: stepAddress(workflow.name, step.name),
            kind: 'cluster',
            type: WORKFLOW_STATE_TYPE,
            label: step.label,
            data: { workflow: workflow.name, step: step.name, final: step.final ?? false },
            source: 'vocabulary',
          });
        }
        for (const move of workflow.moves) {
          const source = stepAddress(workflow.name, move.from);
          const target = stepAddress(workflow.name, move.to);
          edges.push({ id: edgeId(source, 'move', target), source, target, type: 'move' });
        }
        return { nodes, edges, total: workflow.steps.length };
      }

      const bucket = options?.buckets.find((b) => b.key === address.id);
      if (!bucket) return { nodes, edges };
      // What a bucket holds says which bucket, as the bucket does.
      const hold = (node: GraphNode) => contain({ ...node, data: { ...node.data, bucket: bucket.key } });

      if (bucket.items) {
        for (const item of bucket.items) {
          hold({
            id: clusterAddress(ITEM_TYPE, `${bucket.key}:${item.id}`),
            kind: 'cluster',
            type: ITEM_TYPE,
            label: item.label,
            data: { item: item.id },
            leaf: true,
            source: 'vocabulary',
          });
        }
        return { nodes, edges, total: bucket.items.length };
      }

      if (bucket.workflows) {
        for (const workflow of bucket.workflows) {
          hold({
            id: clusterAddress(WORKFLOW_TYPE, workflow.name),
            kind: 'cluster',
            type: WORKFLOW_TYPE,
            label: workflow.label,
            data: { workflow: workflow.name, steps: workflow.steps.length },
            source: 'vocabulary',
          });
        }
        return { nodes, edges, total: bucket.workflows.length };
      }

      if (bucket.models) {
        for (const model of bucket.models) {
          hold({
            id: entityAddress(dataset, SCHEMA_TYPE, model.name),
            kind: 'entity',
            type: SCHEMA_TYPE,
            label: model.label ?? model.name,
            data: { entity: model.name },
            source: 'vocabulary',
          });
        }
        return { nodes, edges, total: bucket.models.length };
      }

      if (bucket.entity) {
        const shape = context.models(dataset).find((s) => s.name === bucket.entity);
        const limit = options?.limit ?? 200;
        const rows = await context.query({ entity: bucket.entity, dataset, limit, signal: request.signal });
        for (const row of rows) {
          const node = rowToNode(row, bucket.entity, dataset, shape, 'vocabulary');
          if (node) hold(node);
        }
        // A full page says there may be more, and says so rather than looking complete.
        if (rows.length === limit) context.warn(`showing the first ${limit} of ${bucket.label}`);
        return { nodes, edges, total: nodes.length };
      }
      return { nodes, edges };
    },
  };

  return { seed, expander, records };
}
