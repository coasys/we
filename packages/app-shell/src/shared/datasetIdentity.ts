/**
 * When two dataset refs describe the same dataset in the same state.
 *
 * ## Why this is not a tidiness question
 *
 * The backend adapter's `toRef` builds a fresh object on every `lifecycle.get`, so publishing the
 * same space twice publishes two objects equal in every way that matters and unequal by reference.
 * Solid compares by reference, so every consumer of `currentDataset` woke for a change that had not
 * happened.
 *
 * `PresenceStore` is one of those consumers, and it rebuilds its source when the dataset changes —
 * which broadcasts a `bye` and drops the peer map. So a re-publish of the space you were already in
 * told your peers you had left, emptied the call's roster, and closed every `RTCPeerConnection` in
 * it. Clicking your own space in the sidebar during a call dropped the call, which is exactly what
 * going to its settings and coming back makes you do.
 *
 * ## What counts as the same
 *
 * The fields a consumer can act on. `handle` is what model calls take, `sharedUri` changes when a
 * personal space is published as a neighbourhood, and `id` identifies the space. Everything else a
 * switch recomputes — `isWeSpace`, the model manifest — has its own signal and notifies on its own
 * account, so leaving it out here costs nothing.
 *
 * Structural rather than typed against `AppDataset`, so the predicate carries no dependency on the
 * store it serves and can be tested without loading it.
 */
export interface DatasetIdentity {
  id: string;
  handle: unknown;
  sharedUri?: string;
}

export function sameDataset(a: DatasetIdentity | null, b: DatasetIdentity | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.handle === b.handle && a.sharedUri === b.sharedUri;
}
