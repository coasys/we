/**
 * Elevation follows the theme, and glow follows the tone.
 *
 * `shadow: 'md'` on a layout component painted nothing at all (the token was passed through as the
 * word `md`), and where shadows did paint they were black at fixed alphas whatever the theme said. A
 * flat theme must take a raised box's shadow away; a glow is the accent as light, so a teal-toned box
 * must glow teal and an untoned one in the accent.
 */
export const name = 'elevation and glow';
export const scenario = 'ds:elevation';
export const widths = [420];

export async function check({ partStyle }) {
  const problems = [];
  const shadow = (id) => partStyle(`#${id}`, 'box-shadow');

  const raised = await shadow('raised');
  if (!raised || raised === 'none') problems.push(`a raised box draws no shadow (${raised})`);

  const flat = await shadow('flat');
  // Strength 0 leaves a shadow with no alpha, which is no shadow.
  if (flat && flat !== 'none' && !/\/ 0\)|, 0\)|rgba\(0, 0, 0, 0\)|transparent/.test(flat)) {
    problems.push(`a flat theme still draws a shadow: ${flat}`);
  }

  const glow = await shadow('glow');
  const teal = await shadow('glow-teal');
  if (!glow || glow === 'none') problems.push('a glowing box draws nothing');
  if (glow === teal) problems.push('a teal-toned glow is the same colour as the accent one');
  // Teal: green and blue well above red, in whatever space the browser reports the colour.
  const [r, g, b] = (teal.match(/(?:srgb|rgba?\()\s*([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)/) ?? []).slice(1).map(Number);
  if (!(g > r + 0.2 * (g > 1 ? 255 : 1) && b > r)) problems.push(`the teal glow is not teal: ${teal}`);
  return problems;
}
