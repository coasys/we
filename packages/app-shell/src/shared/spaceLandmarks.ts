/**
 * The records a space names as its landmarks — its canvas, its board — read and written in one place.
 *
 * A landmark is a `SpaceLandmark` record on the `Space` (`Space.landmarks`) naming one record. A space's
 * starter writes the first ones, and a store action that makes such a record later (the board somebody
 * presses "make" for in a space whose starter made none) writes its landmark the same way, so a
 * template finds it whichever made it. Templates read them through `spaceStore.landmarks`.
 *
 * Two landmarks of one name — two members making the space's board at the same moment on two nodes —
 * resolve to the newest, and the other record is left as an ordinary one.
 */
import { type DatasetProxy, Space, SpaceLandmark } from '@we/entities';

/** The space's landmarks, by name → the id of the record that is it. The newest wins a name. */
export async function readSpaceLandmarks(dataset: DatasetProxy): Promise<Record<string, string>> {
  return landmarksByName(await SpaceLandmark.findAll(dataset));
}

/**
 * The landmark records as names → ids — what `readSpaceLandmarks` makes of a read, and what a live
 * query's pushed rows are made into without reading them again.
 */
export function landmarksByName(
  landmarks: readonly { name?: string; node?: unknown; createdAt?: unknown }[],
): Record<string, string> {
  const byName: Record<string, { id: string; at: string }> = {};
  for (const landmark of landmarks) {
    const node = Array.isArray(landmark.node) ? landmark.node[0] : landmark.node;
    const at = String(landmark.createdAt ?? '');
    if (!landmark.name || !node) continue;
    if (!byName[landmark.name] || at > byName[landmark.name].at) byName[landmark.name] = { id: String(node), at };
  }
  return Object.fromEntries(Object.entries(byName).map(([name, { id }]) => [name, id]));
}

/** Record that `nodeId` is the landmark `name` of the space whose record is `spaceId`. */
export async function writeSpaceLandmark(
  dataset: DatasetProxy,
  spaceId: string,
  name: string,
  nodeId: string,
): Promise<void> {
  // An untyped to-one is written as a one-element list at creation — see `createBoard`.
  const landmark = await SpaceLandmark.create(dataset, { name, node: [nodeId] } as never);
  await Space.addRelation(dataset, spaceId, 'landmarks', landmark.id);
}
