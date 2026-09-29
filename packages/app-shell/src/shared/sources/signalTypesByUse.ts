/**
 * Reaction types ordered by how many people reacted with each — most used first.
 *
 * ## Why the host lends this, and why it lends only this
 *
 * Sorting a list is the one thing the expression language cannot say. There is no sort in the
 * library, the grammar is closed, and there is no query to hang an `order` on either: these types
 * come from one hoisted subscription and are counted against the signals the record already
 * carries. So the order comes here.
 *
 * Nothing else does. WHICH types a surface draws is a filter and reads perfectly well as one, so it
 * stays in the schema, and this takes the list it produced. That split is the whole reason a
 * display's overflow arithmetic — how many types is this row not drawing — is still an expression
 * anyone can evaluate: reordering a list cannot change how long it is.
 *
 * ## By head count, never by what people said
 *
 * A five-star rating from three people would outrank fifteen likes on any total of values, and a
 * downvoted type would sort BELOW one nobody has used once the negatives took it past zero — so the
 * busiest conversation on the record would be the one pushed furthest down it. "How many people
 * bothered" is the only reading that compares a toggle with a rating with a vote with a slider,
 * which is the same reason `signalTally` refuses to total values across types.
 *
 * Ties keep the order they arrived in, which a stable sort gives: two types nobody has used sit in
 * the order the vocabulary lists them, so a panel does not reshuffle itself as reactions arrive one
 * at a time.
 *
 * ## Muted authors do not get a vote on the order
 *
 * Somebody this agent has muted should not decide what the panel leads with. They are excluded from
 * the count here for the same reason they are excluded from the lists everywhere else.
 *
 * ## `order` is what stops the list moving while somebody is reading it
 *
 * Ordering by use live means a reaction you have just WITHDRAWN slides down the column under your
 * cursor, which is disconcerting on its own and worse than that in practice: `$each` hands each row
 * its index as a value captured when the row rendered, so a row that moves keeps the index it was
 * born with, and anything drawn from the index — the line between one type and the next — is drawn
 * in the wrong place afterwards.
 *
 * So an order settled earlier is passed back in as a list of ids. Ids it names keep that order;
 * anything it does not name — a type defined since, or one that has just had its first reaction —
 * is appended by use, so a new type appears rather than being dropped. An empty or absent `order`
 * means nobody has settled one, and the live order is the answer.
 *
 * WHO settles it is the host, not the template: see `signalOrder`, and the note there about why a
 * `$localState` snapshot cannot survive the subscription that a reaction itself triggers.
 *
 * Total, like every function an expression can call.
 */
export function signalTypesByUse(options: unknown): unknown[] {
  const { types, signals, muted, limit, order } = (options ?? {}) as {
    types?: unknown;
    signals?: unknown;
    muted?: unknown;
    limit?: unknown;
    order?: unknown;
  };
  if (!Array.isArray(types)) return [];
  const rows = Array.isArray(signals) ? signals : [];
  const hidden = new Set(Array.isArray(muted) ? (muted as unknown[]).filter((did) => typeof did === 'string') : []);

  const reactors = new Map<string, number>();
  for (const row of rows as { signalTypeId?: unknown; author?: unknown }[]) {
    if (typeof row?.signalTypeId !== 'string') continue;
    if (typeof row.author === 'string' && hidden.has(row.author)) continue;
    reactors.set(row.signalTypeId, (reactors.get(row.signalTypeId) ?? 0) + 1);
  }

  const used = (type: unknown) => {
    const id = (type as { id?: unknown } | null)?.id;
    return typeof id === 'string' ? (reactors.get(id) ?? 0) : 0;
  };

  /*
    The settled order first, then everything it did not know about, by use.

    Both halves are sorted with a stable sort, so ties inside each keep the order they arrived in —
    the vocabulary's own, which is what makes two surfaces showing one record agree.
  */
  const settled = Array.isArray(order) ? (order as unknown[]).filter((id) => typeof id === 'string') : [];
  const rank = new Map(settled.map((id, at) => [id as string, at]));
  const placed = (type: unknown) => {
    const id = (type as { id?: unknown } | null)?.id;
    return typeof id === 'string' ? rank.get(id) : undefined;
  };

  const ordered = [...types].sort((a, b) => {
    const [left, right] = [placed(a), placed(b)];
    if (left !== undefined && right !== undefined) return left - right;
    // A type the settled order never saw goes after every type it did, however used it is: it
    // arrived while somebody was reading, and moving the rows they are looking at is the thing
    // being avoided.
    if (left !== undefined) return -1;
    if (right !== undefined) return 1;
    return used(b) - used(a);
  });
  return typeof limit === 'number' && limit >= 0 ? ordered.slice(0, limit) : ordered;
}
