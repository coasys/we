/**
 * Every row of a rail is the same shape, wherever it sits and whatever it leads with.
 *
 * Three things were wrong with the Coasys rail, and none is visible without layout:
 *
 * - Closed, faces sat about 4.5px right of the rail's centre. The rows' padding was fixed, and
 *   suited only the kit's own 80px width; at 72px a 56px row overflowed the 47px it had, all to the
 *   right.
 * - Open, the two rows behind a menu ("Add a space", the person) were narrower than the rest: the
 *   menu wrapped them in a second, shrink-to-fit button.
 * - A group heading lit up with a background on hover like a row, though it only folds its group.
 */
export const name = 'a rail’s rows';
export const scenario = 'rail:app';
export const widths = [900];

const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Each row's face: an avatar, or a row icon (24px; the heading's caret is 16px). */
async function faces(measureAll) {
  const avatars = await measureAll('we-avatar');
  const icons = (await measureAll('we-icon')).filter((b) => b.w >= 20);
  return [...avatars, ...icons].map((b) => ({ ...b, cx: b.x + b.w / 2 }));
}

export async function check({ measureAll, measurePart, count, hover }) {
  const problems = [];
  // The rail is the first box under the host: the renderer's wrappers around it draw none.
  const rail = (await measureAll('#rail-host *')).find((b) => b.w > 0);
  if (!rail || rail.w !== 72) return [`no 72px rail (found ${rail?.w}px)`];

  // Closed: every face is centred on the rail, less its 1px border.
  const centre = rail.x + (rail.w - 1) / 2;
  const closed = await faces(measureAll);
  if (closed.length !== 5) problems.push(`expected 5 faces, found ${closed.length}`);
  for (const face of closed) {
    if (!near(face.cx, centre)) {
      problems.push(`a closed face is centred at ${face.cx}, and the rail at ${centre}`);
    }
  }

  // The menu's rows are triggers themselves, not a button inside another.
  const nested = await count('we-button we-button');
  if (nested) problems.push(`${nested} buttons sit inside another button`);

  // Open it.
  await hover('#rail-host > *');
  await sleep(450);

  // A face does not move while the rail opens; only its label arrives.
  const open = await faces(measureAll);
  closed.forEach((face, i) => {
    if (open[i] && !near(open[i].x, face.x))
      problems.push(`a face moved from x=${face.x} to x=${open[i].x} on opening`);
  });

  // Every row is as wide as the rail allows, menu rows included.
  const rows = await measureAll('we-button[size="lg"]');
  const widths = [...new Set(rows.map((r) => r.w))];
  if (rows.length !== 5) problems.push(`expected 5 rows, found ${rows.length}`);
  if (widths.length !== 1) problems.push(`rows are ${widths.join(', ')}px wide, not one width`);

  // And every label starts at the same x, whether its row leads with a face or a glyph.
  const labels = await measureAll('we-button[size="lg"] we-text');
  const starts = [...new Set(labels.map((l) => l.x))];
  if (labels.length !== 5) problems.push(`expected 5 labels, found ${labels.length}`);
  if (starts.length > 1 && Math.max(...starts) - Math.min(...starts) > 1) {
    problems.push(`labels start at ${starts.join(', ')}, not one x`);
  }

  // The group heading brightens on hover and draws no background.
  const heading = 'we-button[size="sm"]';
  const rest = await measurePart(heading, 'base');
  await hover(heading);
  await sleep(250);
  const lit = await measurePart(heading, 'base');
  if (!rest || !lit) return [...problems, 'no group heading'];
  if (lit.background !== rest.background) {
    problems.push(`the heading's background goes from ${rest.background} to ${lit.background} on hover`);
  }
  if (lit.color === rest.color) problems.push('the heading does not brighten on hover');

  return problems;
}
