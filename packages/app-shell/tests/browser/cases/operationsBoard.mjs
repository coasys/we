/**
 * A card moved and a board's columns reordered are drawn before the writes land.
 *
 * `core.moveCard` and `core.reorderBoardColumns` invoked as a template invokes them, through the
 * host's `invokeOperation`, with the real runs held: the columns' `arranges` and the board's
 * `children` the renderer reads already carry the move, from the speculative run's prediction.
 */
export const name = 'a board move drawn before it lands';
export const scenario = 'blank';
export const widths = [420];

const text = () => document.getElementById('mount')?.textContent ?? '';

export async function check({ evaluate }) {
  const problems = [];
  const read = () => evaluate(text);
  const settle = () => evaluate(() => new Promise((r) => setTimeout(r, 150)));

  const ids = await evaluate(() => window.__harness.operationsProbe('board'));
  await settle();
  const start = await read();
  if (!start.includes('A todo: Task one') || !start.includes('order A todo,B doing'))
    return [`the board did not draw as seeded: "${start}"`];

  await evaluate(
    (i) =>
      window.__harness.operationsInvoke('core.moveCard', { from: i.todo, to: i.doing, card: i.card, ids: [i.card] }),
    ids,
  );
  await settle();
  const moved = await read();
  if (!moved.includes('B doing: Task one') || moved.includes('A todo: Task one'))
    problems.push(`the card was not drawn in its new column before the write landed: "${moved}"`);

  await evaluate(
    (i) => window.__harness.operationsInvoke('core.reorderBoardColumns', { board: i.board, ids: [i.doing, i.todo] }),
    ids,
  );
  await settle();
  if (!(await read()).includes('order B doing,A todo'))
    problems.push(`the column order was not drawn before the write landed: "${await read()}"`);

  await evaluate(() => window.__harness.operationsLand());
  await settle();
  const landed = await read();
  if (!landed.includes('B doing: Task one') || !landed.includes('order B doing,A todo'))
    problems.push(`what was drawn did not hold once the writes landed: "${landed}"`);
  return problems;
}
