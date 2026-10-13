/**
 * Unread dots and mentions, answered from one read of a space's containers.
 *
 * Both used to read every `CollectionBlock` in the space with every field. On a real space that is
 * two reads of ~450 KB each, about 11 s apiece against a remote backend, and nearly all of it `children`
 * — the id of everything in every container, which neither question looks at. One read naming the
 * three fields they do use carries a few KB.
 *
 * `mentions` is selected rather than included. Included, it asks the backend to hydrate its targets,
 * and it declares none, so a backend that insists on a target refuses the whole read as soon as one
 * node mentions somebody.
 */
import type { TypedEntityQuery } from '@we/backend-shared';
import type { CollectionBlock } from '@we/entities';

/**
 * The one read. Typed against the record, so a field named here that the entity does not declare is
 * a compile error rather than an empty column.
 *
 * Two things say a container has something new in it. `$latestChild` is the newest thing said in it
 * at the top level. `$latestReply` is the newest response under a node — a comment on a post — which
 * is a child of nothing: where it was said is derived, from the container its subject is part of. So
 * each row also carries `partOf`, and a reply is credited to its subject's container.
 */
export const CONTAINER_ACTIVITY_QUERY: TypedEntityQuery<CollectionBlock> = {
  properties: ['author', 'createdAt', 'mentions', 'partOf'],
  include: {
    $latestChild: { from: 'children', order: { createdAt: 'DESC' }, limit: 1 },
    $latestReply: { from: 'thread', order: { createdAt: 'DESC' }, limit: 1 },
  },
};

export interface ContainerActivity {
  id: string;
  author?: string;
  createdAt?: unknown;
  mentions?: unknown;
  partOf?: unknown;
  $latestChild?: unknown;
  $latestReply?: unknown;
}

const idOf = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return idOf(value[0]);
  return (value as { id?: string } | undefined)?.id ?? '';
};

const createdAtOf = (value: unknown): string => {
  const at = (value as { createdAt?: unknown } | undefined)?.createdAt;
  return typeof at === 'string' ? at : '';
};

/**
 * Containers holding something newer than this agent's marker for them — said in them directly, or
 * in reply to something that is.
 *
 * A container with *no* marker counts as unread — it has never been opened, so everything in it is
 * new. That case has to be written down rather than falling out of the comparison, because `>`
 * against `undefined` is false and would have read as "nothing new here". ISO-8601 UTC compares
 * lexicographically in chronological order — see `ReadMarker`.
 */
export function unreadContainerIds(
  containers: readonly ContainerActivity[],
  markers: readonly { nodeId: string; lastReadAt: string }[],
): string[] {
  const lastReadOf = new Map(markers.map((m) => [m.nodeId, m.lastReadAt]));
  // The newest reply under anything in each container, credited to that container.
  const replyIn = new Map<string, string>();
  for (const node of containers) {
    const at = createdAtOf(node.$latestReply);
    const home = idOf(node.partOf);
    if (at && home && at > (replyIn.get(home) ?? '')) replyIn.set(home, at);
  }
  return containers
    .filter((container) => {
      const child = createdAtOf(container.$latestChild);
      const reply = replyIn.get(container.id) ?? '';
      const latest = child > reply ? child : reply;
      if (!latest) return false;
      const marker = lastReadOf.get(container.id);
      return marker === undefined || latest > marker;
    })
    .map((container) => container.id);
}

/**
 * Nodes naming `did`, newest first.
 *
 * Filtered here rather than pushed down: matching on the contents of a to-many relation is a
 * relation filter, which both adapters declare they cannot do (`AdapterCapabilities.relationFilters`).
 * `createdAt` is the backend's comparable timestamp, compared as a number here.
 */
export function mentionsOf(
  containers: readonly ContainerActivity[],
  did: string,
): { id: string; author: string; createdAt: number }[] {
  return containers
    .filter((node) => (Array.isArray(node.mentions) ? node.mentions : []).includes(did))
    .map((node) => ({ id: node.id, author: String(node.author ?? ''), createdAt: Number(node.createdAt) }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
