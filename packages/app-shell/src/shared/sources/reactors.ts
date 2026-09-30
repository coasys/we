/**
 * Who reacted with one type, and what each of them gave.
 *
 * ## Why the host lends this
 *
 * The record already carries the answer — `include: { signals: true }` hydrates every `Signal` with
 * its `author` and `value`, so nothing new is fetched. What a schema cannot do is the **join**: a
 * signal names a DID, and a face and a name live in `profileStore.profiles`, and an expression that
 * paired them would be a `find()` inside a `map()` inside a `filter()` written out at every call
 * site. `involvement` exists for the same reason one concept along, and this is deliberately its
 * shape.
 *
 * ## The search is here rather than in the schema
 *
 * Narrowing by name means comparing against the *joined* name, which only exists after the join —
 * so a template filtering the signals first would be filtering on a DID. Doing it here also makes
 * "hide a type nobody matching used" a count of what came back rather than a second expression that
 * has to agree with the first.
 *
 * ## Unresolved people are people
 *
 * A profile that is not cached yet has no name, and such a row is kept rather than dropped: it is
 * somebody who reacted, and the alternative is a count that disagrees with the list beside it. They
 * carry their DID as `hash`, which is what draws a stable identicon — two unresolved peers must not
 * be two identical blank discs. A *search*, though, cannot match them, so a narrowed list says so
 * through `unresolved` rather than quietly omitting them.
 *
 * Total, like every function an expression can call.
 */
export interface Reactor {
  did: string;
  /** The display name, or empty while the profile is still arriving. */
  name: string;
  avatar: string;
  /** What they gave — a rating's score, a vote's direction, a toggle's `rangeMax`. */
  value: number;
  /** Whether this is the reader's own reaction, so a list can lead with it. */
  mine: boolean;
}

export interface ReactorsView {
  /** The people, this agent first, then by name — unnamed last, since they sort as empty. */
  people: Reactor[];
  /** How many reacted in all, before any search. What "12 people" counts. */
  total: number;
  /** How many of them a search could not judge, because their profile has not arrived. */
  unresolved: number;
}

type ProfileRow = { did?: unknown; name?: unknown; avatar?: unknown };

export function reactors(options: unknown): ReactorsView {
  const { signals, profiles, me, search } = (options ?? {}) as {
    signals?: unknown;
    profiles?: unknown;
    me?: unknown;
    search?: unknown;
  };
  const rows = Array.isArray(signals) ? signals : [];
  const cache = Array.isArray(profiles) ? (profiles as ProfileRow[]) : [];
  const mine = typeof me === 'string' ? me : '';
  const needle = typeof search === 'string' ? search.trim().toLowerCase() : '';

  const byDid = new Map<string, ProfileRow>();
  for (const row of cache) if (typeof row?.did === 'string') byDid.set(row.did, row);

  const all: Reactor[] = [];
  for (const row of rows as { author?: unknown; value?: unknown }[]) {
    if (typeof row?.author !== 'string') continue;
    const profile = byDid.get(row.author);
    all.push({
      did: row.author,
      name: typeof profile?.name === 'string' ? profile.name : '',
      avatar: typeof profile?.avatar === 'string' ? profile.avatar : '',
      value: typeof row.value === 'number' ? row.value : 0,
      mine: row.author === mine,
    });
  }

  /*
    The reader first, then everybody by name.

    Their own reaction is the one they are most likely to be looking for — to check it, or to see
    what they gave beside everyone else — and it is the one row they can act on from here.
  */
  all.sort((a, b) => (a.mine === b.mine ? a.name.localeCompare(b.name) : a.mine ? -1 : 1));

  const matching = needle ? all.filter((person) => person.name.toLowerCase().includes(needle)) : all;
  return {
    people: matching,
    total: all.length,
    unresolved: needle ? all.filter((person) => !person.name).length : 0,
  };
}
