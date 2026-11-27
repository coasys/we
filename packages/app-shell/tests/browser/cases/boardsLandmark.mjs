/**
 * The Boards list finds the space's own board by its `board` landmark, read as a record.
 *
 * With the landmark, the board it names is marked as the space's (its icon) and nothing offers to
 * make one; without it, the list offers "Everything", which makes it. Both answers come from
 * a `SpaceLandmark` query the view binds, where they used to come from the store's map of names.
 */
export const name = 'the Boards list knows the space’s own board from its landmark';
export const scenario = 'boards:landmark';
export const widths = [720];

const read = (evaluate) =>
  evaluate(() => {
    const texts = [...document.querySelectorAll('we-text')].map((t) => t.textContent?.trim() ?? '');
    const iconBeside = (title) => {
      const text = [...document.querySelectorAll('we-text')].find((t) => t.textContent?.trim() === title);
      let box = text?.parentElement;
      while (box && !box.querySelector('we-icon')) box = box.parentElement;
      return box?.querySelector('we-icon')?.getAttribute('name') ?? box?.querySelector('we-icon')?.name ?? null;
    };
    return {
      offers: texts.includes('Everything'),
      spaceIcon: iconBeside('Riverside board'),
      otherIcon: iconBeside('Garden plans'),
      texts,
    };
  });

export async function check({ evaluate, call }) {
  const problems = [];
  await new Promise((resolve) => setTimeout(resolve, 300));
  const withLandmark = await read(evaluate);
  if (withLandmark.offers) problems.push('the list offers to make the space’s board when its landmark names one');
  if (withLandmark.spaceIcon !== 'squares-four')
    problems.push(`the landmarked board is not marked as the space's (icon ${withLandmark.spaceIcon})`);
  if (withLandmark.otherIcon !== 'kanban')
    problems.push(`another board is marked as the space's (${withLandmark.otherIcon})`);

  await call('mount', 'boards:no-landmark', 720);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const without = await read(evaluate);
  if (!without.offers) problems.push('with no landmark, the list does not offer to make the space’s board');
  if (without.spaceIcon === 'squares-four') problems.push('with no landmark, a board is still marked as the space’s');
  return problems;
}
