/**
 * Every section heading is the same row, whatever is in it.
 *
 * A heading with a control beside its name is a DIFFERENT TREE from one without: a button around
 * the whole row cannot contain a second button, so an `action` splits the heading into a name and a
 * count-with-caret with the control between them. Two shapes that have to read as one kind of row
 * is the thing a schema test cannot see — it can say both were built, not that they came out the
 * same height or that their names start in the same place.
 *
 * They did not. The People section in the inspector sat lower than the four around it.
 */
export const name = 'section headings agree';
export const scenario = 'panel:sections';
export const widths = [320];

export async function check({ measureText, measureAll }) {
  const problems = [];

  const names = [];
  for (const label of ['Connects', 'Connections', 'People']) {
    const box = await measureText(label, 'we-text');
    if (!box) return [`no heading called ${label}`];
    names.push({ label, box });
  }

  // The names line up on the left, whichever of the two trees they came out of.
  const lefts = new Set(names.map((n) => n.box.x));
  if (lefts.size !== 1) {
    problems.push(`the names start at ${names.map((n) => `${n.label} ${n.box.x}px`).join(', ')}`);
  }

  /*
    And every heading is the same height.

    Measured as the distance from one name to the next, which is the row plus the column's gap: the
    words are the same type in all three, so a taller row does not show up as a taller word — it
    shows up as the name sitting lower inside a row that centres it, which is exactly how the
    People section read before its picker was sized for a heading.
  */
  const tops = names.map((n) => n.box.y);
  const gaps = tops.slice(1).map((y, i) => y - tops[i]);
  if (new Set(gaps).size !== 1) {
    problems.push(`the headings are ${gaps.join('px and ')}px apart — one row is taller than another`);
  }

  // The row holding a control is the one that can grow: say so when it is the odd one out.
  const rows = await measureAll('we-button:not([slot="content"] *)');
  const heights = new Set(rows.filter((r) => r.h > 0).map((r) => r.h));
  if (heights.size > 2) {
    problems.push(`heading rows came out ${[...heights].join('px, ')}px tall`);
  }

  return problems;
}
