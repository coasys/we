/**
 * The "New board" sheet makes a board through `ops.core.createBoard` and opens what it answers with.
 *
 * One params object — the title, the states the community offers as slugs in its own order, and no
 * parent while the view is not narrowed — and on success the sheet closes onto the new board.
 * Rendered against the space tier's bag, so the call goes through the gate a space template's does.
 * A failure is said by the host's operation runner (`operationFailureMessage`, unit-tested).
 */
export const name = 'a new board is made by the operation, and opens';
export const scenario = 'boards:create';
export const widths = [720];

const op = (evaluate) => evaluate(() => JSON.parse(document.body.getAttribute('data-op') ?? 'null'));

export async function check({ evaluate, click, count, type }) {
  const problems = [];
  await click('we-button:has-text("New board")');
  await type('we-input input', 'Sprint 12');
  await click('we-button:has-text("Create board")');
  await new Promise((resolve) => setTimeout(resolve, 300));

  const asked = await op(evaluate);
  const wanted = ['core.createBoard', { title: 'Sprint 12', states: ['todo', 'review', 'done'] }];
  if (JSON.stringify(asked) !== JSON.stringify(wanted))
    problems.push(`the sheet asked ${JSON.stringify(asked)}, not ${JSON.stringify(wanted)}`);
  if (await count('we-button:has-text("Create board")'))
    problems.push('the sheet is still open after the board was made');
  if (!(await count('we-button:has-text("All boards")'))) problems.push('the new board did not open');
  if (!(await count('we-text:has-text("Sprint 12")'))) problems.push('the opened board is not the one just made');

  return problems;
}
