/**
 * The Coasys tree's Social DNA in three levels: the group, each kind of definition with its count, and
 * each definition — a leaf, whose fields are the inspector's and whose uses are the vocabulary map's.
 *
 * Rows are opened by setting `open` on them, as the tree's own state would; choosing one would also
 * navigate, which this case has nowhere to do.
 */
export const name = "the Coasys tree's Social DNA";
export const scenario = 'coasys:tree-dna';
export const widths = [320];

const ROWS = ['Social DNA', 'Signal types', 'Task states', 'Models', 'Policy'];

export async function check({ evaluate, screenshot }) {
  const problems = [];
  // A row by its label exactly, allowing the count a kind carries after it: "Hive" must not find a
  // topic described as "Hives, honey and swarms".
  await evaluate(async (rows) => {
    const label = (item) => item.firstElementChild?.textContent?.trim() ?? '';
    for (const text of rows) {
      const item = [...document.querySelectorAll('we-tree-item')].find((i) =>
        new RegExp(`^${text}\\d*$`).test(label(i)),
      );
      if (item) item.open = true;
      // Each level's rows are drawn once the level above is open.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, ROWS);
  await evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
  const shown = await evaluate(() =>
    [...document.querySelectorAll('we-tree-item')]
      .filter((i) => i.getBoundingClientRect().height > 0)
      .map((i) => [...i.children].find((c) => c.getAttribute('slot') !== 'children')?.textContent?.trim() ?? ''),
  );
  const has = (text) => shown.some((row) => row.startsWith(text));
  for (const row of [
    'Social DNA',
    'Signal types',
    'Like',
    'Rating',
    'Connection types',
    'Task states',
    'In review',
    'Involvement',
    'Topics',
    'Models',
    'Hive',
    'Policy',
    'Members can make anything.',
  ])
    if (!has(row)) problems.push(`no "${row}" row`);
  // A definition is a leaf: what it says is in the inspector, not rows under it.
  for (const row of ['Mode · rating', 'From 0 to 5', '2 approvals to move on', 'Frames · number'])
    if (has(row)) problems.push(`a "${row}" row under a definition`);
  await screenshot?.('coasys-tree-dna');
  return problems;
}
