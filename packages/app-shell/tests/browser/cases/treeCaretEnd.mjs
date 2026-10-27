/**
 * A tree with its caret at the end, as the Coasys tree draws it — chosen from side-by-side renders
 * of the alternatives, and pinned here so it stays what was chosen.
 *
 * - The carets sit at the rows' ends, and a leaf has none.
 * - Each guide drops from the centre of its row's glyph, and a child's glyph starts half a lead to
 *   its right, so nothing ever sits in the indent at any depth.
 * - A lit row starts on its parent's guide, so its bar lands on the line, and it is square where the
 *   bar is while the other rows keep their rounding.
 *
 * `WE_BROWSER_SHOTS=<dir>` also writes a picture.
 */
export const name = 'a tree with its caret at the end';
export const scenario = 'tree:caret-end';
export const widths = [420];

const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance;

export async function check({ measureAll, measureParts, partStyle, evaluate, moveTo, screenshot }) {
  const problems = [];
  const items = await measureAll('we-tree-item');
  const nth = (label) => items.findIndex((b) => b.text.startsWith(label));
  const part = async (label, name) => (await measureParts('we-tree-item', name, nth(label)))[0];
  const icon = async (label) => {
    const icons = await measureAll('we-tree-item we-icon');
    // The row's own glyph is the first icon inside its item that sits on the row's line.
    const row = await part(label, 'row');
    return icons.find((b) => b.y >= row.y - 1 && b.y + b.h <= row.y + row.h + 1);
  };

  // Carets at the end: past the row's content, and none on a leaf.
  const designRow = await part('Design', 'row');
  const designCaret = await part('Design', 'caret');
  if (!(designCaret && designCaret.x > designRow.x + designRow.w / 2))
    problems.push(`a group's caret is at x=${designCaret?.x}, not at the end of its row`);
  const leafCaret = await part('Calls', 'caret');
  if (leafCaret && leafCaret.w > 0) problems.push(`a leaf draws a caret ${leafCaret.w}px wide`);

  // Each guide drops from its row's glyph centre, and a child's glyph starts to its right.
  for (const [parent, child] of [
    ['Channels', 'General'],
    ['Product', 'Design'],
    ['Design', 'Icons'],
  ]) {
    const glyph = await icon(parent);
    const [children] = await measureParts('we-tree-item', 'children', nth(parent));
    const left = Number.parseFloat(await partStyle('we-tree-item', 'left', 'children::before', nth(parent)));
    const guide = children.x + left + 0.5;
    if (!near(guide, glyph.x + glyph.w / 2))
      problems.push(`${parent}'s guide is at x=${guide}, not its glyph's centre`);
    const childGlyph = await icon(child);
    if (!(childGlyph.x > guide + 6))
      problems.push(`${child}'s glyph is at x=${childGlyph.x}, on its parent's guide at ${guide}`);
  }

  // The lit row starts on its parent's guide, so its 3px bar sits on the line.
  const designGlyph = await icon('Design');
  const lit = await part('Icons', 'row');
  if (!near(lit.x + 1.5, designGlyph.x + designGlyph.w / 2))
    problems.push(`the lit row starts at x=${lit.x}, not on Design's guide at ${designGlyph.x + designGlyph.w / 2}`);

  // Square where the bar is; every other row keeps its rounding.
  const litCorner = await partStyle('we-tree-item', 'border-top-left-radius', 'row', nth('Icons'));
  const otherCorner = await partStyle('we-tree-item', 'border-top-left-radius', 'row', nth('Type'));
  if (litCorner !== '0px') problems.push(`the lit row's leading corner is ${litCorner}, not square`);
  if (otherCorner === '0px') problems.push('a row that is not lit lost its rounding');

  // A hovered row takes the lit row's shape: square where the bar would be, round at its other end.
  // Tagged rather than found by text: an open row's text includes its children's, so the first item
  // holding "Type" is the one around it.
  await evaluate(() =>
    [...document.querySelectorAll('we-tree-item')]
      .find((item) => item.textContent.trim().startsWith('Type'))
      .setAttribute('data-case-target', ''),
  );
  await moveTo('[data-case-target]');
  const hoverLead = await partStyle('we-tree-item', 'border-top-left-radius', 'row', nth('Type'));
  const hoverEnd = await partStyle('we-tree-item', 'border-top-right-radius', 'row', nth('Type'));
  if (hoverLead !== '0px') problems.push(`a hovered row's leading corner is ${hoverLead}, not square like a lit one`);
  if (hoverEnd === '0px') problems.push('a hovered row lost the rounding at its trailing end');

  await screenshot?.('tree-caret-end');
  return problems;
}
