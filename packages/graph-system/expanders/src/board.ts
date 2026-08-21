/**
 * The board seed — a container's contents, at the positions somebody put them.
 *
 * Every other seed answers "what is here". This one answers "what is here, and where did people
 * put it", which is two questions because the answers live in two places. Membership is ordinary
 * containment, so a card composed onto a board is found by everything that already walks a
 * collection. Position is a `Placement` record, because a coordinate is a fact about a *pair* — this
 * board, this node — and storing it on either one alone means a record can be in one place only.
 *
 * ## Why it is a seed rather than a layout
 *
 * The `manual` layout reads `x`/`y` off each node's own data and is right to: a layout arranges what
 * it is given and must not know how to fetch anything. So the merge happens here, where the data
 * layer is already in reach, and `manual` stays a dozen lines of arithmetic that works the same
 * whether the coordinates came from a placement, a fixture, or a field on the record.
 *
 * ## How it finds what to load without being told
 *
 * `contains` names the types a board may hold, and defaults to the block vocabulary — but a
 * community's own models are not in any list a template could have written. The placements supply
 * the rest: every one names the type of the thing it positions, so anything anybody has *placed* is
 * queried whether or not the template anticipated it. The two together are what let a board hold a
 * `Sighting` nobody had heard of when this file was written.
 *
 * Placements are read first for that reason, and their node references are read as bare URIs rather
 * than hydrated. An untyped relation has no target class for `include` to hydrate into, and the id
 * is what is wanted anyway: the records come back in one query per type and are matched up here.
 */
import type { GraphEdge, GraphNode, SeedSource } from '@we/graph-protocol';

import { rowToNode } from './nodes';

export interface BoardSeedOptions {
  /** Record id of the board. Nothing loads until this is set. */
  board: string;
  dataset?: string;
  /** Relation holding the board's contents and its placements. */
  via?: string;
  /** Entity holding coordinates. */
  placementEntity?: string;
  /**
   * Types the board may hold, beyond whatever its placements name.
   *
   * One drill-down query each, so this is a real cost rather than a free "list everything" — the
   * same bargain the collection expander makes, and the reason it is a list rather than every
   * entity the dataset declares.
   */
  contains?: string[];
  limit?: number;
}

/** What a board tends to hold when a template does not say. Mirrors the collection expander's set. */
const DEFAULT_CONTAINS = ['CollectionBlock', 'TaskBlock', 'EventBlock', 'ImageBlock'];

interface Placed {
  x: number;
  y: number;
}

export function boardSeed(): SeedSource {
  return {
    id: 'board',
    description: "A container's contents, positioned by the placements recorded against it.",
    async seed(rawOptions, context, signal) {
      const options = (rawOptions ?? {}) as BoardSeedOptions;
      // No board chosen yet — a picker whose `$local` is still empty. Loading the types wholesale
      // here would fill the canvas with every card in the space, which is worse than an empty one.
      if (!options.board) return { nodes: [], edges: [], total: 0 };

      const dataset = options.dataset ?? context.defaultDataset() ?? '';
      const shapes = context.models(dataset);
      const via = options.via ?? 'children';
      const placementEntity = options.placementEntity ?? 'Placement';
      const limit = options.limit ?? 200;
      const scope = { anchor: 'CollectionBlock', via, anchorId: options.board };

      const read = (entity: string) =>
        context.query({ entity, dataset, scope, limit, signal }).catch((error: unknown) => {
          context.warn(`board: cannot read ${entity}: ${error instanceof Error ? error.message : String(error)}`);
          return [] as Record<string, unknown>[];
        });

      /*
        Positions first, because they decide what else is worth asking for.

        A board that has never been arranged returns none, and falls back to `contains` — which is
        right: a freshly composed card has containment and no placement yet, and appears unplaced
        for the layout to park.
      */
      const positions = new Map<string, Placed>();
      const placedTypes = new Set<string>();
      if (shapes.some((s) => s.name === placementEntity)) {
        for (const row of await read(placementEntity)) {
          const node = typeof row.node === 'string' ? row.node : undefined;
          if (!node) continue;
          positions.set(node, { x: Number(row.x) || 0, y: Number(row.y) || 0 });
          if (typeof row.nodeType === 'string' && row.nodeType) placedTypes.add(row.nodeType);
        }
      }

      const wanted = [...new Set([...(options.contains ?? DEFAULT_CONTAINS), ...placedTypes])];
      const nodes: GraphNode[] = [];

      for (const entity of wanted) {
        if (entity === placementEntity) continue;
        if (!shapes.some((s) => s.name === entity)) continue;
        const shape = shapes.find((s) => s.name === entity);
        for (const row of await read(entity)) {
          const node = rowToNode(row, entity, dataset, shape, 'board');
          if (!node) continue;
          const at = typeof row.id === 'string' ? positions.get(row.id) : undefined;
          /*
            Coordinates land in `data`, where the `manual` layout reads them.

            Merged into the node rather than passed beside it because that is the contract a layout
            has: it is handed nodes and returns positions, and a seed that needed its own channel to
            the layout would be a seed only one layout could use.
          */
          nodes.push(at ? { ...node, data: { ...node.data, x: at.x, y: at.y } } : node);
        }
      }

      // No edges: containment is how a board holds things, not something a board is *about*. Drawing
      // it would put a line from an invisible parent to every card, which is a hub-and-spoke diagram
      // rather than the freeform surface the whole mode exists to be.
      const edges: GraphEdge[] = [];
      return { nodes, edges, total: nodes.length };
    },
  };
}
