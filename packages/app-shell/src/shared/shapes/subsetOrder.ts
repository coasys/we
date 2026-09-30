/**
 * A reorder made while looking at part of a column, put back into the whole of it.
 *
 * `we-sortable` reports the order of what it shows. A column showing everything hands over the
 * whole column, and writing that is right. A column showing *some* of its cards — the people filter
 * in hide mode, or one person's row on a board laid out a row per person — hands over only those,
 * and the obvious write (that order, then everything else after it) sends every card the reader
 * could not see to the bottom of the column, for everybody, with nothing on screen to say so.
 *
 * So the cards the reader moved are put back **into the slots they occupied**, and every card they
 * could not see keeps its own. A reader who drags Ana's second card above her first swaps those two
 * positions in the column and touches nothing between them.
 *
 * A card that arrives from another column has no slot yet. It is seated immediately after the card
 * it was dropped under, or immediately before the card it was dropped above when it lands first —
 * which is where the reader put it relative to everything they could see. Among what they could
 * not see there is no right answer, and "next to its visible neighbour" disturbs the least.
 */
export function spliceSubsetOrder(full: readonly string[], subset: readonly string[]): string[] {
  const inFull = new Set(full);
  const members = new Set(subset.filter((id) => inFull.has(id)));
  const known = subset.filter((id) => members.has(id));

  // Every visible card that was already here goes back into a slot a visible card occupied.
  const out: string[] = [];
  let next = 0;
  for (const id of full) out.push(members.has(id) ? known[next++] : id);

  // Then the newcomers, left to right, each beside the neighbour it was dropped next to.
  subset.forEach((id, index) => {
    if (inFull.has(id)) return;
    const before = subset[index - 1];
    const after = subset.slice(index + 1).find((other) => out.includes(other));
    if (before !== undefined && out.includes(before)) out.splice(out.indexOf(before) + 1, 0, id);
    else if (after !== undefined) out.splice(out.indexOf(after), 0, id);
    else out.push(id);
  });
  return out;
}
