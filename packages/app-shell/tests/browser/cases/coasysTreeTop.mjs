/**
 * The top of the Coasys tree under Glow, against d12.
 *
 * - The selected row carries a 3px mint bar on its leading edge, as Glow asks through the tree's
 *   `selected` variant, and the row you are not on carries none.
 * - The space's face is a rounded square while a person's stays a circle: the radius is the
 *   instance's, not the theme's avatar shape.
 * - A description clamps to two lines rather than running on.
 */
export const name = 'the top of the Coasys tree';
export const scenario = 'coasys:tree-top';
export const widths = [900];

/** An `oklch(L C H)` colour's hue, or NaN. */
const hue = (colour) => Number(/oklch\([\d.]+ [\d.]+ ([\d.]+)/.exec(colour ?? '')?.[1]);

export async function check({ measure, measurePart, measureParts, partStyle }) {
  const problems = [];
  const bar = (nth) => ({
    width: partStyle('we-tree-item', 'width', 'row::before', nth),
    color: partStyle('we-tree-item', 'background-color', 'row::before', nth),
  });

  const selected = bar(1);
  const other = bar(0);
  const [on, off] = await Promise.all([selected.width, other.width]);
  if (on !== '3px') problems.push(`the selected row's bar is ${on} wide, not 3px`);
  if (off && off !== 'auto' && off !== '0px') problems.push(`a row not selected has a ${off} bar`);
  // Glow's accent is mint (hue ~160). Read as a hue: the accent only resolves inside the themed node.
  const barColour = await selected.color;
  if (!(hue(barColour) > 140 && hue(barColour) < 175)) problems.push(`the bar is ${barColour}, not mint`);

  // A circle is any radius of at least half the face; a rounded square is less.
  const face = await measure('#space-face');
  const corner = async (sel) => {
    const r = await partStyle(sel, 'border-top-left-radius');
    return r?.endsWith('%') ? (parseFloat(r) / 100) * face.w : parseFloat(r);
  };
  const space = await corner('#space-face');
  const person = await corner('#person-face');
  if (!(space > 0 && space < face.w / 2))
    problems.push(`the space's face has ${space}px corners, not a rounded square's`);
  if (!(person >= face.w / 2)) problems.push(`a person's face lost its circle: ${person}px corners`);

  const purpose = await measurePart('#purpose', 'base');
  // `normal` is the font's own, about 1.2 of its size.
  const lineHeight = parseFloat(purpose.lineHeight) || parseFloat(purpose.fontSize) * 1.2;
  if (!(purpose.h <= lineHeight * 2 + 1)) problems.push(`the description is ${purpose.h}px tall, more than two lines`);
  if (!(purpose.h > lineHeight * 1.5))
    problems.push(`the description is ${purpose.h}px tall — clamped below two lines`);

  // Rows stand apart rather than touching, so two lit at once do not read as one block.
  const [first] = await measureParts('we-tree-item', 'row', 0);
  const [second] = await measureParts('we-tree-item', 'row', 1);
  const gap = second && first ? second.y - (first.y + first.h) : NaN;
  if (!(gap >= 3.5)) problems.push(`tree rows are ${gap}px apart — touching`);

  // Glow's rows have the sidebar's 8px vertical padding (d12 `.nav-item`), not the default 4px.
  const padding = await partStyle('we-tree-item', 'padding-top', 'row', 0);
  if (padding !== '8px') problems.push(`a tree row's padding is ${padding}, not Glow's 8px`);

  // A row with nothing under it has no caret.
  const caret = await partStyle('we-tree-item', 'visibility', 'caret', 2);
  if (caret !== 'hidden') problems.push(`an empty row's caret is ${caret}`);

  // A count is at least square, rather than a lozenge narrower than it is tall. A 1, the narrowest
  // digit, came out 20x24 at the end of a row.
  const count = await measure('#row-count');
  if (!(count.w >= count.h)) problems.push(`a one-digit count is ${count.w}x${count.h} — narrower than it is tall`);

  // A field's words, placeholder included, are body text, not a button's strong label.
  for (const pseudo of ['', '::placeholder']) {
    const weight = Number(await partStyle('we-input', 'font-weight', `input${pseudo}`));
    if (!(weight <= 500)) problems.push(`the search field${pseudo ? "'s placeholder" : ''} is set at ${weight}`);
  }

  // Glow sizes every eyebrow through its overline role, so a template draws one with no size of its own.
  const eyebrow = await measurePart('#eyebrow', 'base');
  if (eyebrow?.fontSize !== '14px') problems.push(`an eyebrow is ${eyebrow?.fontSize}, not Glow's 14px`);

  return problems;
}
