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

export async function check({ measure, measurePart, partStyle }) {
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

  return problems;
}
