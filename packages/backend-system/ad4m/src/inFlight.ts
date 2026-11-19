/**
 * One request for a read that several callers make at the same moment.
 *
 * At startup the shell's stores each ask the executor the same few questions as they arrive — who
 * the agent is (`agent.me`), whether a model is installed (`ai.getModels`), what the identity module
 * holds (`identity.status`) — and they arrive together, so each question went out once per store.
 * The answer is per client, not per port: the agent session and the dataset lifecycle are separate
 * ports over the same client, and both ask `agent.me`.
 *
 * Only while the request is in flight. When it settles the entry is gone and the next caller asks
 * again, so nothing here goes stale and nothing is a cache: a caller after the answer arrived gets a
 * fresh one, exactly as before. A failure is shared the same way, and is not remembered either.
 */
const flights = new WeakMap<object, Map<string, Promise<unknown>>>();

export function sharedInFlight<T>(owner: object, key: string, read: () => Promise<T>): Promise<T> {
  let byKey = flights.get(owner);
  if (!byKey) {
    byKey = new Map();
    flights.set(owner, byKey);
  }
  const held = byKey.get(key);
  if (held) return held as Promise<T>;
  const table = byKey;
  // Called now, not a tick later, so the request leaves when it did before it was shared.
  const request: Promise<T> = (async () => read())().finally(() => {
    if (table.get(key) === request) table.delete(key);
  });
  table.set(key, request);
  return request;
}
