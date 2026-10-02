/**
 * One person's reaction is shown outright, with no summary row in front of it.
 *
 * A summary saying "1 person" beside one face, behind a press that reveals one row, is three
 * pieces of indirection standing in front of something shorter than the thing hiding it. So the
 * rule is: a crowd is summarised, and one person is just named.
 *
 * This used to be a `total == 1` branch carrying the list of names down BOTH of its sides —
 * ~7,000 characters duplicated at every placement of the fragment. It is now two conditions over
 * one list: the summary when there is more than one, the names when there is one or when anybody
 * asked. The same answer, written once.
 *
 * Why it has to be measured here. Whether the names are showing on a first paint is not something
 * a schema test can see: the rows exist in the markup of every closed hover bubble on the panel,
 * which is the confusion `reactorDisclosure` records. `:visible` is the whole assertion — and that
 * case seeds TWO reactions per type, so nothing before this measured the one-person path at all.
 */
export const name = 'one reactor is named, not summarised';
export const scenario = 'signals:one-reactor';
export const widths = [420];

export async function check({ count, measureControl, measureAll, measureText, note }) {
  const problems = [];

  /*
    The row is a full-width row, not a collapsed one.

    Worth measuring because the merged condition carries a `reveal` transition, and a transitioning
    `$if` renders a real wrapper — `display: grid` with a `0fr`/`1fr` track — where the branch it
    replaced had none at all. A grid track that stayed at `0fr`, or a wrapper that sized to
    min-content, would leave the names on screen in the markup and unreadable on the page.
  */
  // `measureText`, not a `:text-is()` selector: `measureAll` runs `querySelectorAll` inside the
  // page, where Playwright's own text engine does not exist.
  const panel = await measureText('Like', 'we-text');
  const row = (await measureAll('we-avatar')).find((b) => b.w && b.h);
  if (!row) problems.push('the reactor row has no box at all — the reveal track never opened');
  else {
    note(`reactor row: ${row.w}x${row.h} at y=${row.y}`);
    if (row.h < 12) problems.push(`the reactor row is ${row.h}px tall — the reveal track is still closed`);
    if (panel && row.y < panel.y) problems.push('the reactor row is above the type it belongs to');
  }

  // The one reaction is the reader's own, so their row says so — see the scenario for why a peer
  // would render as an empty name here.
  const names = await count('we-text:text-is("You"):visible');
  if (!names) {
    problems.push('the one person who reacted is not named — the list is behind a press that should not exist');
  }

  if (await measureControl('Who reacted')) {
    problems.push('a summary row is drawn for a single reactor, which is what it exists to avoid');
  }

  // And the count that would have been in it is nowhere either.
  if (await count('text="1 person":visible')) {
    problems.push('"1 person" is on screen beside the one person it is counting');
  }

  return problems;
}
