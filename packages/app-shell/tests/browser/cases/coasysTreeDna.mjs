/**
 * The Coasys tree's Social DNA: Models (the space's own classes, then other apps', each with its
 * namespace), Flows (the flows written), Templates, the built-in classes (WE's vocabulary, then its
 * blocks together in a nested Blocks row) and the policy with its rules. A class is a leaf: its
 * records are on its page, not rows under it. At the top, Active flows lists each record still
 * running, latest first, and Templates is no longer a group of its own.
 *
 * Rows are opened by setting `open` on them, as the tree's own state would; choosing one would also
 * navigate, which this case has nowhere to do.
 */
export const name = "the Coasys tree's Social DNA";
export const scenario = 'coasys:tree-dna';
export const widths = [320];

const ROWS = ['Active flows', 'Social DNA', 'Models', 'Flows', 'Templates', 'Built in', 'Blocks', 'Policy'];

export async function check({ evaluate, screenshot }) {
  const problems = [];
  // A row by its label exactly, allowing the count a kind carries after it: "Hive" must not find a
  // topic described as "Hives, honey and swarms".
  await evaluate(async (rows) => {
    const label = (item) => item.firstElementChild?.textContent?.trim() ?? '';
    for (const text of rows) {
      for (const item of [...document.querySelectorAll('we-tree-item')].filter((i) =>
        new RegExp(`^${text}\\d*$`).test(label(i)),
      ))
        item.open = true;
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
  // Exactly this label, allowing a count after it: "Task" must not be found by "Task states".
  const hasExactly = (text) => shown.some((row) => new RegExp(`^${text}\\d*$`).test(row));
  for (const row of [
    'Social DNA',
    'Models',
    'Hive',
    'Questionconv://',
    'Review',
    'Coasys space',
    'Our layout',
    'Built in',
    'Signal types',
    'Connection types',
    'Task states',
    'Involvement',
    'Topics',
    'Blocks',
    'Policy',
    'Members can make anything.',
  ])
    if (!has(row)) problems.push(`no "${row}" row`);
  // A block is listed under Blocks, not among the vocabulary classes.
  if (!hasExactly('Task')) problems.push('no "Task" row under Blocks');
  // A class is a leaf; the old groups are gone; WE's plumbing is not a class of the space's; a flow put
  // away is not listed.
  for (const row of ['Like', 'In review', 'This space', 'Other apps', 'Workflows', 'Placement', 'Old process'])
    if (has(row)) problems.push(`a "${row}" row`);
  // Social DNA's rows, in order: Models, Flows, Templates, Built in, Policy.
  const dna = shown.findIndex((row) => /^Social DNA\d*$/.test(row));
  const order = ['Models', 'Flows', 'Templates', 'Built in', 'Policy'].map((t) =>
    shown.findIndex((row, i) => i > dna && new RegExp(`^${t}\\d*$`).test(row)),
  );
  if (order.some((i, n) => i < 0 || (n > 0 && i < order[n - 1])))
    problems.push(`Social DNA's rows are out of order: ${order.join(', ')}`);
  // Active flows at the top counts its two rows, each a record by name and its step, the latest first.
  if (!shown.includes('Active flows2')) problems.push('Active flows does not count the two running');
  const roof = shown.findIndex((row) => row.startsWith('Fix the roof'));
  const gate = shown.findIndex((row) => row.startsWith('Paint the gate'));
  if (roof < 0 || gate < 0) problems.push('the running records are not listed under Active flows');
  else if (roof > gate) problems.push('the running records are not latest first');
  if (roof >= 0 && !shown[roof].endsWith('Checking'))
    problems.push(`a running record does not show its step: ${shown[roof]}`);
  // One Flows row, the flows written inside Social DNA, counting them as Models counts its classes.
  const flows = shown.filter((row) => /^Flows\d*$/.test(row));
  if (flows.length !== 1) problems.push(`${flows.length} Flows rows, not one`);
  // A flow is a definition, so its own row carries no count, as a class's does not.
  if (!shown.includes('Review'))
    problems.push(`the flow written carries a count: ${shown.find((r) => r.startsWith('Review'))}`);
  if (shown.filter((row) => /^Templates\d*$/.test(row)).length !== 1) problems.push('Templates is not one row');
  await screenshot?.('coasys-tree-dna');
  return problems;
}
