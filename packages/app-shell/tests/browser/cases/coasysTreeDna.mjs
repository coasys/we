/**
 * The Coasys tree's Social DNA: the group, the classes in three groups — the space's own, other apps'
 * (each with its namespace), WE's (its vocabulary, then its blocks) — and the policy with its rules. A
 * class is a leaf: its records are on its page, not rows under it.
 *
 * Rows are opened by setting `open` on them, as the tree's own state would; choosing one would also
 * navigate, which this case has nowhere to do.
 */
export const name = "the Coasys tree's Social DNA";
export const scenario = 'coasys:tree-dna';
export const widths = [320];

const ROWS = ['Social DNA', 'This space', 'Other apps', 'WE', 'Policy'];

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
    'This space',
    'Hive',
    'Other apps',
    'Questionconv://',
    'WE',
    'Signal types',
    'Connection types',
    'Task states',
    'Involvement',
    'Topics',
    'Task',
    'Policy',
    'Members can make anything.',
  ])
    if (!has(row)) problems.push(`no "${row}" row`);
  // A class is a leaf; there is no Models category; WE's plumbing is not a class of the space's.
  for (const row of ['Like', 'In review', 'Models', 'Placement']) if (has(row)) problems.push(`a "${row}" row`);
  await screenshot?.('coasys-tree-dna');
  return problems;
}
