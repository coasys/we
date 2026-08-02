/**
 * Deep clone, via JSON round-trip.
 *
 * **Deliberately not `structuredClone`.** Every caller clones `templateStore.currentTemplate`, which
 * is a Solid store — a `Proxy`. `structuredClone` cannot clone a proxy: it throws `DataCloneError`,
 * the edit handler aborts, and the change silently does not happen. The symptom is precise and
 * misleading — the visual editor appears to do nothing while AI-driven edits keep working, because
 * that path clones through a different helper.
 *
 * The round-trip also does something the callers depend on: it materialises the store's accessors
 * into plain values, producing a *detached* snapshot that can be mutated freely before being handed
 * back through `updateTemplate`. A structural clone of a reactive proxy would not be detached in the
 * same way.
 *
 * A template is JSON by definition — data, not code — so the round-trip loses nothing.
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
