/**
 * The Coasys flows page marks the record chosen. A row under Active flows opens the page at its flow
 * with the record in `?card=`; choosing another record of the same flow changed nothing on screen, so
 * the chosen one is drawn as a selection is everywhere else, an accent edge on the accent's soft fill.
 *
 * Measured, because the claim is about what a browser paints: the chosen row's edge and fill differ
 * from the others', and the others all match each other.
 */
export const name = 'the Coasys flows page marks the record chosen';
export const scenario = 'coasys:flows-page';
export const widths = [900];

const TITLES = ['Fix the roof', 'Paint the gate', 'Order the tiles'];
const CHOSEN = 'Paint the gate';

export async function check({ evaluate, screenshot }) {
  const problems = [];
  await evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
  await screenshot?.('coasys-flows-page');

  const rows = await evaluate((titles) => {
    // The innermost element holding a title, then the card around it: the nearest ancestor with a border.
    const all = [...document.querySelectorAll('*')];
    return titles.map((title) => {
      const text = all.find((el) => el.children.length === 0 && el.textContent?.trim() === title);
      let card = text;
      while (card && getComputedStyle(card).borderTopWidth === '0px') card = card.parentElement;
      if (!card) return { title, found: false };
      const style = getComputedStyle(card);
      return { title, found: true, border: style.borderTopColor, fill: style.backgroundColor };
    });
  }, TITLES);

  for (const row of rows) if (!row.found) problems.push(`no card for "${row.title}"`);
  if (problems.length) return problems;

  const chosen = rows.find((r) => r.title === CHOSEN);
  const others = rows.filter((r) => r.title !== CHOSEN);
  if (others[0].border !== others[1].border || others[0].fill !== others[1].fill)
    problems.push(`the rows not chosen differ from each other: ${JSON.stringify(others)}`);
  if (chosen.border === others[0].border)
    problems.push(`the chosen row's edge is the same as the others': ${chosen.border}`);
  if (chosen.fill === others[0].fill) problems.push(`the chosen row's fill is the same as the others': ${chosen.fill}`);
  return problems;
}
