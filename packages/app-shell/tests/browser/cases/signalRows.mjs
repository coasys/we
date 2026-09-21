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
 */
export const name = 'signal names sit level';
export const scenario = 'signals:vocabulary';
export const widths = [420];

export async function check({ measureAll, measureText }) {
  const dividers = (await measureAll('we-divider')).filter((line) => line.w > 0);
  if (dividers.length < 2) return [`expected lines between the types, found ${dividers.length}`];

  // The name belonging to each line is the first one under it.
  const names = [];
  for (const label of ['Stars', 'Vote', 'Mood']) {
    const box = await measureText(label, 'we-text');
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
    return [`the names sit ${offsets.map((o) => `${o.label} ${o.gap}px`).join(', ')} below their lines`];
  }
  return [];
}
