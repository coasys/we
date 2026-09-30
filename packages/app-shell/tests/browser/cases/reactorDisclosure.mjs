/**
 * The people rows start closed, and the whole summary row opens them.
 *
 * A vocabulary of four types with a handful of reactions each is two dozen rows of people in front
 * of whatever the reader actually opened, so the names are collapsed behind their faces and a
 * count. Two claims come out of that, and both are about pixels rather than about the tree:
 *
 * - **Closed by default.** A schema test can see that the rows are behind a condition; it cannot
 *   see what that condition evaluates to on a first paint, which is the half that was wrong before.
 * - **The row is the target, not the caret.** The press here lands on the *words* — a caret is a
 *   five-millimetre target for a question the whole line is asking, and wiring the handler to it
 *   alone would look identical in the source.
 */
export const name = 'people rows open from the whole row';
export const scenario = 'signals:vocabulary';
export const widths = [420];

export async function check({ count, measureControl, click }) {
  const problems = [];

  const summary = await measureControl('Who reacted');
  if (!summary) return ['no summary row for who reacted'];

  /*
    The reader's own row, counted only where it is on screen.

    Not the page's height — the harness viewport is fixed and the content scrolls inside it, so
    `body` reads the same open or closed — and not the tree either: the rows exist in the markup of
    every closed hover bubble, which is exactly the confusion this has to see through. `:visible`
    is the whole assertion.
  */
  const mine = 'we-text:text-is("You"):visible';
  const closed = await count(mine);
  if (closed) problems.push(`${closed} people rows are showing before anybody asked for them`);

  // By its TEXT, which is the point: this is the part of the row nobody would think to wire up.
  await click('text="2 people"');
  const open = await count(mine);
  if (!open) problems.push('pressing the words of the summary row opened no people rows');

  return problems;
}
