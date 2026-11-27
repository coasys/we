import type { StoreEntry } from '@we/schema-shared';
import { CAPABILITY_PROFILES } from '@we/schema-shared';

/**
 * The store entries as a template sees them: each capability profile's members moved out of the
 * stores that hold them into an entry for the profile's namespace, which carries the store of each
 * member as `homes`. The namespaces come first, in the profiles' order and each in its profile's
 * member order, so the reference shows what travels before what is WE's.
 *
 * `homes` is the host's own table (`PROFILE_HOMES` in the template surface), by namespace then
 * member. A member a store does not declare is left out, as the bag would leave it out.
 */
export function profileNamespaces(
  entries: readonly StoreEntry[],
  homes: ReadonlyMap<string, ReadonlyMap<string, string>>,
): StoreEntry[] {
  const stores = new Map(entries.map((entry) => [entry.name, { ...entry, state: { ...entry.state } }]));
  const namespaces: StoreEntry[] = [];

  for (const profile of CAPABILITY_PROFILES) {
    const byMember = homes.get(profile.namespace);
    if (!byMember) throw new Error(`the host keeps no members of the ${profile.id} profile`);
    const entry: StoreEntry = { name: profile.namespace, state: {}, actions: [], homes: {} };
    for (const { path } of profile.members) {
      const member = path.slice(path.indexOf('.') + 1);
      const home = byMember.get(member);
      const store = home ? stores.get(home) : undefined;
      if (!home || !store) throw new Error(`${path}: the host names no store holding it`);
      if (member in store.state) {
        entry.state[member] = store.state[member];
        delete store.state[member];
      } else if (store.actions.includes(member)) {
        entry.actions.push(member);
        store.actions = store.actions.filter((action) => action !== member);
      } else continue;
      entry.homes![member] = home;
    }
    namespaces.push(entry);
  }

  return [...namespaces, ...stores.values()];
}
