/**
 * The profile an author is drawn with: the person's, when the device that signed speaks for one.
 *
 * A record's `author` is a device key. A person who writes from two computers is two device keys
 * and one person (`did:scid:…`), and the person's profile is published under that `did:scid`, so
 * both computers' posts are drawn with one name and one face. The device stays on the answer
 * (`device`) for anything that needs to know which computer signed.
 *
 * Where the person has published nothing yet (a log made before its profile was written, or a peer
 * whose copy has not arrived) the device's own profile stands in, still under the person's DID so
 * that grouping and "is this me" do not change when the person's profile lands.
 */
import { type AgentProfileSummary, isProfileEmpty } from '@we/backend-shared';

export function profileAsPerson(
  device: string,
  person: string,
  byPerson: AgentProfileSummary | undefined,
  byDevice: AgentProfileSummary | undefined,
): AgentProfileSummary | undefined {
  if (person === device) return byDevice;
  const chosen = byPerson && !isProfileEmpty(byPerson) ? byPerson : (byDevice ?? byPerson);
  if (!chosen) return undefined;
  return { ...chosen, did: person, device };
}

/**
 * A list of agents as one entry per person, each carrying the device keys it was seen under.
 *
 * `dids` are whatever the list is made of — the cache's keys, a space's member keys — and
 * `profileFor` answers each as its person (see above), so two computers of one person fold into one
 * entry: its `did` is the person, its `devices` every key that spoke for them. The entry's profile is
 * the one its first device is drawn with, so a list and a byline never disagree about a name. An
 * agent that is its own person is left exactly as it was. Order is first appearance.
 */
export function onePerPerson(
  dids: readonly string[],
  profileFor: (did: string) => AgentProfileSummary | undefined,
): AgentProfileSummary[] {
  const groups = new Map<string, string[]>();
  for (const did of dids) {
    const person = profileFor(did)?.did;
    if (!person) continue;
    const devices = groups.get(person) ?? [];
    if (!groups.has(person)) groups.set(person, devices);
    if (did !== person && !devices.includes(did)) devices.push(did);
  }
  const out: AgentProfileSummary[] = [];
  for (const [person, devices] of groups) {
    const profile = profileFor(devices[0] ?? person);
    if (!profile) continue;
    const { device: _signer, ...entry } = profile;
    out.push(devices.length ? { ...entry, did: person, devices } : entry);
  }
  return out;
}

/**
 * The DIDs that are the viewer, from `me.dids` (a list) or `me.did` (one) — what a host function's
 * `me` option is handed. See `shared/selfAcrossDevices.ts`.
 */
export function selfDids(me: unknown): Set<string> {
  return new Set((Array.isArray(me) ? me : [me]).filter((did): did is string => typeof did === 'string' && did !== ''));
}

/**
 * A list of people indexed by every DID that names them: each entry's own `did` and each of its
 * `devices`. A record names the device that wrote it; a list one entry per person names the person,
 * and this is the join between them.
 */
export function byAnyDid<T extends { did?: unknown; devices?: unknown }>(rows: unknown): Map<string, T> {
  const index = new Map<string, T>();
  for (const row of Array.isArray(rows) ? (rows as T[]) : []) {
    if (typeof row?.did !== 'string' || !row.did) continue;
    index.set(row.did, row);
    for (const device of Array.isArray(row.devices) ? row.devices : []) {
      if (typeof device === 'string' && !index.has(device)) index.set(device, row);
    }
  }
  return index;
}
