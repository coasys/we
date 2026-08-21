/**
 * The board seed — a container's contents, at the positions somebody put them.
 *
 * Every other seed answers "what is here". This one answers two questions, because a board holds
 * three facts that are usually one:
 *
 * - **Ownership** — containment. Where a record *lives*, and what a delete cascades to. A note born
 *   on a board is owned by it; a task from a call is owned by the call.
 * - **Membership** — the placement's existence. That it *appears* on this board. Many per record,
 *   one per board it is on.
 * - **Position** — the placement's coordinates.
 *
 * Letting containment carry both ownership and membership is what made "a note born here" and "a
 * task brought here" impossible to tell apart: putting an existing record on a board would have
 * reparented it, and a note the board owned could not be removed from view without deleting it.
 *
 * So placed records are fetched **by id**, from the placements. Containment is still read, but only
 * for what the board *owns* and nobody has positioned — the tray, which is a recovery surface rather
 * than a third kind of membership: a placement that failed to write, or a card composed before
 * anybody said where it goes.
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
 * is what is wanted anyway: the records come back in one query per type — `where: { id: [...] }`,
 * which is native on AD4M and pushes down to a SPARQL `VALUES` clause — and are matched up here.
 */
import type { GraphEdge, GraphNode, GraphValue, SeedSource } from '@we/graph-protocol';
import { entityAddress } from '@we/graph-protocol';

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
  /**
   * Entity to draw as connections between the things on this board, if any.
   *
   * Only those with *both* ends placed here are drawn. A board is a closed surface — a line to a
   * record that is not on it would leave the canvas and end nowhere, and pulling the far end in to
   * fix that would put things on the board that nobody placed.
   */
  connections?: string;
  limit?: number;
}

/**
 * Types checked for *owned but unplaced* records — the tray.
 *
 * One, deliberately. Everything that is on a board is placed; the only way to be owned by one and
 * have no position is to be a card composed onto it before anybody said where, which is always a
 * `CollectionBlock`. Listing more would cost a drill-down query each, on every load and every
 * refresh, looking for what cannot be there.
 */
const DEFAULT_CONTAINS = ['CollectionBlock'];

interface Placed {
  x: number;
  y: number;
}

/** A connection's own scalars, for style rules to match on — the same thing `reified` carries. */
function scalarsOf(row: Record<string, unknown>): Record<string, GraphValue> {
  const data: Record<string, GraphValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      data[key] = value as GraphValue;
    }
  }
  return data;
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

      const read = (entity: string, where?: Record<string, unknown>) =>
        context
          .query({ entity, dataset, limit, signal, ...(where ? { where } : { scope }) })
          .catch((error: unknown) => {
            context.warn(`board: cannot read ${entity}: ${error instanceof Error ? error.message : String(error)}`);
            return [] as Record<string, unknown>[];
          });

      /*
        Placements first, because they *are* the membership: which records are on this board, of what
        type, and where. Everything after this is looking those records up.
      */
      const positions = new Map<string, Placed>();
      const placedIds = new Map<string, string[]>();
      if (shapes.some((s) => s.name === placementEntity)) {
        for (const row of await read(placementEntity)) {
          const node = typeof row.node === 'string' ? row.node : undefined;
          const nodeType = typeof row.nodeType === 'string' ? row.nodeType : '';
          // A placement whose node never linked names a type and points at nothing. Skipped rather
          // than half-drawn, and left for a sweep — the record it meant is not knowable from here.
          if (!node || !nodeType) continue;
          positions.set(node, { x: Number(row.x) || 0, y: Number(row.y) || 0 });
          placedIds.set(nodeType, [...(placedIds.get(nodeType) ?? []), node]);
        }
      }

      const nodes: GraphNode[] = [];
      const seen = new Set<string>();
      /** Record ids on this board, so a connection can be checked for having both ends here. */
      const placed = new Set<string>([...placedIds.values()].flat());
      /** Record id → its entity name, so a connection's endpoints can be addressed. */
      const typeOf = new Map<string, string>();
      for (const [entity, ids] of placedIds) for (const id of ids) typeOf.set(id, entity);

      const addressOf = (declared: unknown, id: string): string | undefined => {
        const entity = typeof declared === 'string' && declared ? declared : typeOf.get(id);
        return entity ? entityAddress(dataset, entity, id) : undefined;
      };

      /*
        Two passes, because a board answers two questions.

        Placed records come back by id — one query per type, `where: { id: [...] }`, native on AD4M
        and pushed down as a SPARQL `VALUES` clause. By id rather than by containment because
        placement is what puts something on a board: a task owned by a call belongs on this board
        without being reparented into it, which asking for the board's children could never express.

        Owned-but-unplaced records come back by containment, and are the tray.
      */
      const passes: { entity: string; where?: Record<string, unknown> }[] = [
        ...[...placedIds].map(([entity, ids]) => ({ entity, where: { id: ids } })),
        ...(options.contains ?? DEFAULT_CONTAINS).map((entity) => ({ entity })),
      ];

      for (const pass of passes) {
        const entity = pass.entity;
        if (entity === placementEntity) continue;
        if (!shapes.some((s) => s.name === entity)) continue;
        const shape = shapes.find((s) => s.name === entity);
        for (const row of await read(entity, pass.where)) {
          const node = rowToNode(row, entity, dataset, shape, 'board');
          if (!node) continue;
          // A record both placed and owned answers both passes; the first one wins, and it is the
          // placed one, which is the one carrying a position.
          if (seen.has(node.id)) continue;
          seen.add(node.id);
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

      /*
        Connections between what is on the board.

        No *containment* edges — that would draw a line from an invisible parent to every card, a
        hub-and-spoke diagram rather than the freeform surface the mode exists to be. What is worth
        drawing is what people asserted: a relationship between two cards that are both here.

        Filtered to pairs that are both placed, and filtered *here* rather than in the query, because
        "both ends in this set" is not a where-clause. The query narrows by source, which is the half
        a backend can do, and the target check is a set lookup against what was just loaded.
      */
      const edges: GraphEdge[] = [];
      const connections = options.connections;
      if (connections && shapes.some((s) => s.name === connections) && placed.size) {
        const ends = [...placed];
        for (const row of await read(connections, { source: ends })) {
          const source = typeof row.source === 'string' ? row.source : undefined;
          const target = typeof row.target === 'string' ? row.target : undefined;
          if (!source || !target || !placed.has(source) || !placed.has(target)) continue;
          const from = addressOf(row.sourceType, source);
          const to = addressOf(row.targetType, target);
          if (!from || !to) continue;
          edges.push({
            id: `board-connection|${String(row.id)}`,
            source: from,
            target: to,
            type: 'relates',
            ...(typeof row.label === 'string' && row.label ? { label: row.label } : {}),
            data: scalarsOf(row),
            // Keeps the record reachable, exactly as the reified expander does: clicking the line
            // should be able to open the claim it stands for rather than dead-ending.
            reifiedAs: entityAddress(dataset, connections, String(row.id)),
          });
        }
      }

      return { nodes, edges, total: nodes.length };
    },
  };
}
