/**
 * The Coasys mark and name on the sign-in screen and on the open rail sit on the same pixels.
 *
 * Signing in fades the sign-in screen away over the app, so the two are seen one after the other in
 * the same corner. Drawn apart they disagreed: a 22px mark 48px in on the sign-in screen against a
 * 28px mark 22px in on the rail, and no name on the rail at all.
 */
export const name = 'the Coasys mark and name, signed out and in';
export const scenario = 'coasys:lockup';
export const widths = [900];

export async function check({ measure, screenshot }) {
  const problems = [];
  const at = async (which, part) => {
    const [box, el] = await Promise.all([measure(`#${which}-box`), measure(`#${which}-${part}`)]);
    if (!box || !el) return null;
    return { x: el.x - box.x, y: el.y - box.y, w: el.w, h: el.h };
  };
  for (const part of ['mark', 'name']) {
    const [boot, rail] = await Promise.all([at('boot', part), at('rail', part)]);
    if (!boot) problems.push(`the sign-in screen draws no ${part}`);
    if (!rail) problems.push(`the open rail draws no ${part}`);
    if (!boot || !rail) continue;
    const said = (b) => `${b.w}×${b.h} at ${b.x},${b.y}`;
    if (said(boot) !== said(rail))
      problems.push(`the ${part} is ${said(boot)} signed out and ${said(rail)} on the rail`);
  }
  // The mark centred in the rail's closed width, as it has always been on the rail.
  const mark = await at('rail', 'mark');
  if (mark && (mark.w !== 28 || mark.x !== 22 || mark.y !== 22))
    problems.push(`the rail's mark is ${mark.w}px at ${mark.x},${mark.y}, not 28px centred in 72`);
  await screenshot('coasys-lockup');
  return problems;
}
