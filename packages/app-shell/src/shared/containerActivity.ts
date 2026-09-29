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
 * The one read. `$latestChild` is what the unread comparison looks at. Typed against the record, so a
 * field named here that the entity does not declare is a compile error rather than an empty column.
 */
export const CONTAINER_ACTIVITY_QUERY: TypedEntityQuery<CollectionBlock> = {
  properties: ['author', 'createdAt', 'mentions'],
  include: { $latestChild: { from: 'children', order: { createdAt: 'DESC' }, limit: 1 } },
};

export interface ContainerActivity {
  id: string;
  author?: string;
  createdAt?: unknown;
  mentions?: unknown;
  $latestChild?: unknown;
}

/**
 * Containers holding something newer than this agent's marker for them.
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
  return containers
    .filter((container) => {
      const latest = container.$latestChild as { createdAt?: string } | undefined;
      if (!latest?.createdAt) return false;
      const marker = lastReadOf.get(container.id);
      return marker === undefined || latest.createdAt > marker;
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
