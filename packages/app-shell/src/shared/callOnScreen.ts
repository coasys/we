/**
 * When the address should start naming the call this agent has just joined.
 *
 * The address's `?call=` is "the call the interface on screen is about", and the host publishes it to
 * modules as `callOnScreen`. Nothing ever wrote it for a call you started: the call module cannot
 * touch the address, so only picking a call from a list put it there. A started call was followed
 * only through a fallback to the live record, which left a link copied from the screen naming no
 * call, and the page empty the moment the call ended — while a call reached from the list stayed.
 *
 * Pure, so the rule is tested without a router: the store binding it reads the address and writes
 * what this answers.
 */
export interface CallParamInput {
  /** The route's segments — `['space', '<id>', 'canvas']`. */
  segments: readonly string[];
  /** What `?call=` holds now, or null. */
  current: string | null;
  /** The record of the call just joined. */
  recordId: string;
  /** The space the call is in, by uri, or null where the call did not say. */
  datasetUri: string | null;
  /** The id a space's uri reads as in the address — `SpaceStore`'s `sharedIdOf`. */
  spaceIdOf: (uri: string) => string;
}

/**
 * The value to write into `?call=`, or null to leave the address alone.
 *
 * Written only while the address is inside the call's own space. Somebody who started a call and
 * walked to another space before it connected has an address about that other space, where naming
 * the call would be naming a record it does not hold. A call that did not say which space it is in
 * is taken to be in the one on screen, which is where it was started.
 */
export function callParamToWrite({
  segments,
  current,
  recordId,
  datasetUri,
  spaceIdOf,
}: CallParamInput): string | null {
  if (!recordId) return null;
  if (segments[0] !== 'space' || !segments[1]) return null;
  if (datasetUri && spaceIdOf(datasetUri) !== segments[1]) return null;
  if (current === recordId) return null;
  return recordId;
}
