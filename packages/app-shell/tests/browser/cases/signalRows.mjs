/**
 * Every signal type's name sits the same distance below the line above it.
 *
 * The controls are four different heights — a toggle is one glyph, a slider a track, a vote two
 * buttons and a score, a rating five glyphs: 24, 32, 40 and 48px as drawn. A row that CENTRES them
 * therefore puts each name at a different offset from its divider, so reading down the column the
 * headings stagger and the type with the tallest control looks as though it has been given extra
 * room above it.
 *
 * Only a rendered page can say this. The schema is one row shape for every type; what differs is
 * what the control resolves to at paint.
 *
 * The same case also holds the rows to ONE line each: what each type means moved behind an info
 * glyph, so an unused type is a name and a control and nothing else.
 */
export const name = 'signal names sit level';
export const scenario = 'signals:vocabulary';
export const widths = [420];

/*
  Not the copies inside a closed bubble.

  A type's name is drawn twice now — once on its row, and once as the heading of the tip explaining
  it — and the tip's copy is in the DOM at zero size the whole time. `querySelectorAll` cannot tell
  them apart, so without this the case would measure a 0x0 box and agree with itself.
*/
const VISIBLE = 'we-text:not([slot="content"] *)';

export async function check({ measureAll, measureText, measureControl }) {
  const problems = [];

  const dividers = (await measureAll('we-divider')).filter((line) => line.w > 0);
  if (dividers.length < 2) return [`expected lines between the types, found ${dividers.length}`];

  // The name belonging to each line is the first one under it.
  const names = [];
  for (const label of ['Stars', 'Vote', 'Mood']) {
    const box = await measureText(label, VISIBLE);
    if (box) names.push({ label, box });
  }
  if (names.length < 2) return [`expected to find the type names, found ${names.map((n) => n.label).join(', ')}`];

  const offsets = names
    .map(({ label, box }) => {
      const above = dividers.filter((line) => line.y < box.y).pop();
      return above ? { label, gap: box.y - above.y } : null;
    })
    .filter(Boolean);

  const sizes = new Set(offsets.map((o) => o.gap));
  if (sizes.size !== 1) {
    problems.push(`the names sit ${offsets.map((o) => `${o.label} ${o.gap}px`).join(', ')} below their lines`);
  }

  /*
    And a description is not on the row at all — it is behind the info glyph beside the name.

    It cost a line per type, on a panel where a type nobody has used should be one line and a type
    somebody has used should be two. Asserted by looking for the words: a tooltip's content sits in
    the DOM with the bubble closed, so this is specifically that they are not LAID OUT.
  */
  const description = await measureText('How the room feels, nought to a hundred.', VISIBLE);
  if (description && description.h > 0) {
    problems.push(`a type's description is taking ${description.h}px of the row`);
  }

  /*
    The name and its control start on the same line.

    The row is top-aligned, so "the same line" is the same TOP: a control shorter than a line of
    label — which every one of them is at the size a panel draws them — would otherwise hang from
    the top of the row while the words beside it sat centred in theirs, and the two read as slightly
    out of step all the way down the column.
  */
  for (const [label, control] of [
    ['Like', '.signal-control__toggle-row'],
    ['Vote', '.signal-control__vote'],
    ['Mood', '.signal-control__slider'],
  ]) {
    const name = await measureText(label, VISIBLE);
    const [cell] = (await measureAll(control)).filter((box) => box.h);
    if (!name || !cell) continue;
    if (name.y !== cell.y) {
      problems.push(`${label}'s control starts at ${cell.y}px and its name at ${name.y}px`);
    }
  }

  /*
    And the glyph explaining a type sits against its NAME, not against the control.

    The name used to grow into the space it was given, which pushed the tip to the far side of the
    row where it read as part of the control it had ended up beside.
  */
  const like = await measureText('Like', VISIBLE);
  const tip = await measureControl('What this signal means');
  if (like && tip) {
    const away = tip.x - (like.x + like.w);
    if (away < 0 || away > 16) problems.push(`the info glyph sits ${away}px from the end of the name`);
  }

  return problems;
}
