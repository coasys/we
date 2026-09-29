/**
 * One line between each type, and none above the first.
 *
 * Each type in a full display is three or four stacked pieces — a name with its control, a
 * sentence, a row of faces, sometimes a list of people — so the gap that separated two types read
 * as just another gap inside one of them.
 *
 * A schema test can see the line is conditional on `index`; only a rendered tree can say how many
 * were actually drawn, which is the half that was wrong. `$each` hands a row its index as a value
 * captured when the row rendered, so the count here is also what would catch a row moving after the
 * fact and taking its line with it — the order is settled at mount precisely so it cannot.
 *
 * The scenario offers five types: a toggle, a rating, a vote, a slider, and one nobody has used.
 * `full` draws all five, so four lines fall between them.
 */
export const name = 'a line between each type';
export const scenario = 'signals:vocabulary';
export const widths = [420];

export async function check({ count }) {
  const problems = [];

  const lines = await count('we-divider:visible');
  if (lines !== 4) {
    problems.push(`five types drawn with ${lines} lines between them, expected 4`);
  }

  return problems;
}
