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

import { isoOf } from './interpretation/callExport';

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
    const node = relationId(landmark.node);
    const at = isoOf(landmark.createdAt);
    if (!landmark.name || !node) continue;
    if (!byName[landmark.name] || at > byName[landmark.name].at) byName[landmark.name] = { id: node, at };
  }
  return Object.fromEntries(Object.entries(byName).map(([name, { id }]) => [name, id]));
}

/** A space's record and its collection (`Space.root`), by id. `root` is empty for a space without one. */
export interface SpaceRoot {
  id: string;
  root: string;
}

/*
  Read once per dataset and kept. The space record and its collection are written at the create press
  and never change, and opening a space asks for them from several places at once — the space store,
  the module host, the board actions, extraction's filing — so one read is shared while it is in
  flight and kept once it has found the collection.

  Not kept: a failure, no space, or a space with no collection yet. The create press writes the space
  a moment before its root, so a read in that moment must be asked again; and a space made before
  spaces had a collection pays a read per caller, as it always did.

  It assumes one Space record per dataset: if a dataset held two, the first read that finds a
  collection is the answer for as long as the handle lives.
*/
const spaceRoots = new WeakMap<object, Promise<SpaceRoot | null>>();

/** The space's record id and its collection's id — one read per dataset, shared and kept. */
export function readSpaceRoot(dataset: DatasetProxy): Promise<SpaceRoot | null> {
  // A dataset handle is an object whatever the backend; `DatasetProxy` is opaque to say no more.
  const key = dataset as object;
  const known = spaceRoots.get(key);
  if (known) return known;
  const read = (async (): Promise<SpaceRoot | null> => {
    const space = await Space.findOne(dataset, { include: { root: true } });
    if (!space) return null;
    return { id: space.id, root: relationId(space.root) };
  })();
  spaceRoots.set(key, read);
  const forget = () => {
    if (spaceRoots.get(key) === read) spaceRoots.delete(key);
  };
  read.then((found) => !found?.root && forget(), forget);
  return read;
}

/**
 * Keep a space row already read as its dataset's answer, so opening the space reads nothing more.
 *
 * The space list reads every space's record before one is opened, and a row read without an include
 * still carries its collection's id — a to-one relation is stored as a property of the row. Reading
 * the record again with the collection included cost a whole round trip, on the path to the Feed's
 * first rows, to learn what the list already held.
 *
 * Keeps nothing for a row without a collection, and leaves an answer already kept, or a read already
 * in flight, alone. The caller vouches that the row is the dataset's own space.
 */
export function seedSpaceRoot(dataset: DatasetProxy, space: { id?: string; root?: unknown } | null | undefined): void {
  const key = dataset as object;
  const root = relationId(space?.root);
  if (!space?.id || !root || spaceRoots.has(key)) return;
  spaceRoots.set(key, Promise.resolve({ id: space.id, root }));
}

/** A to-one relation's id, however a row carries it: the id, a one-element list, or the record. */
function relationId(value: unknown): string {
  const one: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof one === 'string') return one;
  const id = (one as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' ? id : '';
}

/** Record that `nodeId` is the landmark `name` of the space whose record is `spaceId`. */
export async function writeSpaceLandmark(
  dataset: DatasetProxy,
  spaceId: string,
  name: string,
  nodeId: string,
): Promise<void> {
  // An untyped to-one is written as a one-element list at creation — see `createBoard`.
  const landmark = await SpaceLandmark.create(dataset, { name, node: [nodeId] });
  await Space.addRelation(dataset, spaceId, 'landmarks', landmark.id);
}
