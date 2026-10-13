/**
 * The records a space names by role — its canvas, its board — read and written in one place.
 *
 * A role is a `SpaceRole` record on the `Space` (`Space.roles`) naming one record. A space's starter
 * writes the first ones, and a store action that makes such a record later (the board somebody
 * presses "make" for in a space whose starter made none) writes its role the same way, so a
 * template finds it whichever made it. Templates read them through `spaceStore.roles`.
 *
 * Two roles of one name — two members making the space's board at the same moment on two nodes —
 * resolve to the newest, and the other record is left as an ordinary one.
 */
import { type DatasetProxy, Space, SpaceRole } from '@we/entities';

/** The space's roles, by name → the id of the record playing it. The newest wins a name. */
export async function readSpaceRoles(dataset: DatasetProxy): Promise<Record<string, string>> {
  const roles = await SpaceRole.findAll(dataset);
  const byName: Record<string, { id: string; at: string }> = {};
  for (const role of roles) {
    const node = Array.isArray(role.node) ? role.node[0] : role.node;
    const at = String((role as { createdAt?: unknown }).createdAt ?? '');
    if (!role.name || !node) continue;
    if (!byName[role.name] || at > byName[role.name].at) byName[role.name] = { id: String(node), at };
  }
  return Object.fromEntries(Object.entries(byName).map(([name, { id }]) => [name, id]));
}

/** Record that `nodeId` plays `name` in the space whose record is `spaceId`. */
export async function writeSpaceRole(
  dataset: DatasetProxy,
  spaceId: string,
  name: string,
  nodeId: string,
): Promise<void> {
  // An untyped to-one is written as a one-element list at creation — see `createBoard`.
  const role = await SpaceRole.create(dataset, { name, node: [nodeId] } as never);
  await Space.addRelation(dataset, spaceId, 'roles', role.id);
}
