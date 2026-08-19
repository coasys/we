import type { CoreEntityDef } from '../defs';

/**
 * How far one agent has read in one node — the private half of "what's new here".
 *
 * The first instance of a pattern worth naming, because the notification story is built from it
 * rather than beside it: in a local-first system a notification is **a standing query whose new
 * results I have not seen** — a (query, marker, delta) triple. This is the marker. A channel's
 * unread dot is `latest child newer than my marker`, and "3 unread mentions" is the same shape with
 * a different query. Nothing about it is Discord-specific; unread is simply the case that forced it
 * to exist first.
 *
 * **Held in the root dataset, never in the space** — the `SpacePreference` rule, and for the same
 * reason. Written into the shared perspective, my read position would sync to every member of the
 * community, which is both a privacy leak and wrong: read state is per-agent by definition, and two
 * members of a channel have different ones.
 *
 * That placement has one honest cost: the root dataset is this device's, so read positions do not
 * follow the agent to another machine. Promoting them is the same decision `AgentSettings` already
 * represents (device vs agent scope, `routing-and-view-state.md` tier 3), and it is deferred rather
 * than overlooked — a marker that syncs is a marker that needs conflict rules, and "latest wins" is
 * only obviously right until someone marks a channel unread on purpose.
 *
 * ### Why a node id rather than a per-space cursor
 *
 * One record per node read, keyed by `nodeId`, rather than one per space holding a map. A map is a
 * single property rewritten on every channel switch, which is a read-modify-write over state that
 * two tabs of the same agent can both hold — the race `WeNode.participants` documents, in miniature.
 * Separate records are independently written and never contend.
 *
 * `spaceUuid` rides along anyway, so a template can scope its query to the space it is rendering
 * without first resolving every node id in it.
 */
export const ReadMarker: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: {"predicate": "we://flag", "value": "we://read_marker"},
    properties: {
      /**
       * The node this marks a position in — a channel, a board, a post with replies.
       *
       * Deliberately any `WeNode` rather than specifically a collection: "how far have I read" is a
       * question about anything with children or comments, and narrowing it would mean a second model
       * the first time someone wants it on a thread.
       */
      nodeId: { type: "string", predicate: "we://node_id", default: "" },
      /** The dataset id of the space the node lives in, so markers can be fetched per space. */
      spaceUuid: { type: "string", predicate: "we://space_uuid", default: "" },
      /**
       * When this agent last read it, as an ISO-8601 UTC string.
       *
       * A timestamp rather than a last-seen child id, because a child id answers "have I seen *this*"
       * and unread needs "is there anything after this point" — which with an id means resolving it to
       * a position first, and fails outright when that child has since been deleted.
       *
       * ISO-8601 UTC specifically, matching what `createdAt` carries, because the comparison is done as
       * a string: `where: { createdAt: { gt: marker } }` pushes down to the backend only as a scalar
       * compare, and ISO-8601 UTC is the format where lexicographic order *is* chronological order.
       * A local-offset or non-padded variant would sort wrongly and the failure would be quiet.
       */
      lastReadAt: { type: "string", predicate: "we://last_read_at", default: "" },
    },
    relations: {
    },
  },
};
